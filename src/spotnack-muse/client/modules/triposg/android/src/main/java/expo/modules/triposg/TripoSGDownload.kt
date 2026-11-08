package expo.modules.triposg

import android.content.Context
import android.net.ConnectivityManager
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// One entry of models_manifest.json, passed from JS (which owns a
// generated copy of the manifest, so the native side never hardcodes
// file names, sizes or hashes).
data class ModelSpec(val path: String, val bytes: Long, val sha256: String)

// Resumable model-file downloader. Files land in <root>/<version>/,
// each via a temp "<path>.part" that is renamed after its SHA-256
// check, so a killed download never leaves a half-written model file.
// Restarting (or re-calling startDownload) resumes mid-file with HTTP
// Range when the server honors it, otherwise restarts that file.
class ModelDownloader(
  private val root: File,
  private val baseUrl: String,
  private val version: String,
  private val files: List<ModelSpec>
) {
  data class Progress(
    val downloadedBytes: Long,
    val totalBytes: Long,
    val file: String,
    val fileIndex: Int,
    val fileCount: Int
  )

  val totalBytes: Long = files.sumOf { it.bytes }
  private val dir = File(root, version)

  private fun fileOf(spec: ModelSpec) = File(dir, spec.path)
  private fun partOf(spec: ModelSpec) = File(dir, spec.path + ".part")

  // Bytes already on disk (finished files at full size + .part files).
  fun diskProgress(): Progress {
    var done = 0L
    for (spec in files) {
      val final = fileOf(spec)
      done += if (final.exists() && final.length() == spec.bytes) spec.bytes
      else partOf(spec).let { if (it.exists()) minOf(it.length(), spec.bytes) else 0L }
    }
    return Progress(done, totalBytes, "", 0, files.size)
  }

  // Null on success, "paused" when stop() fires, else an error message.
  fun run(stop: () -> Boolean, onProgress: (Progress) -> Unit): String? {
    dir.mkdirs()
    var done = diskProgress().downloadedBytes
    onProgress(Progress(done, totalBytes, "", 0, files.size))
    files.forEachIndexed { index, spec ->
      val final = fileOf(spec)
      if (final.exists() && final.length() == spec.bytes) {
        onProgress(Progress(done, totalBytes, spec.path, index, files.size))
        return@forEachIndexed
      }
      final.parentFile?.mkdirs()
      var attempt = 0
      while (true) {
        // Bytes this attempt adds; a retry resumes from the .part file.
        val before = done
        val problem = try {
          downloadOne(spec, stop) { chunk ->
            done += chunk
            onProgress(Progress(done, totalBytes, spec.path, index, files.size))
          }
        } catch (e: java.io.IOException) {
          // Connect / response errors (no network, DNS, reset).
          "$RETRY${spec.path}: ${e.message ?: "network error"}"
        }
        if (problem == null) break
        if (!problem.startsWith(RETRY)) return problem
        // Progress made since the last failure resets the budget.
        if (done > before) attempt = 0
        if (attempt >= RETRY_DELAYS_S.size) return problem.removePrefix(RETRY)
        Log.w("TripoSG", "download retry ${attempt + 1}: ${problem.removePrefix(RETRY)}")
        val waitUntil = System.currentTimeMillis() + RETRY_DELAYS_S[attempt] * 1000L
        attempt++
        while (System.currentTimeMillis() < waitUntil) {
          if (stop()) return "paused"
          Thread.sleep(250)
        }
        // Count from the disk again: a failed hash deletes its .part.
        done = diskProgress().downloadedBytes
      }
      if (stop()) return "paused"
    }
    writeManifest()
    return null
  }

  private fun downloadOne(
    spec: ModelSpec,
    stop: () -> Boolean,
    onChunk: (Long) -> Unit
  ): String? {
    val final = fileOf(spec)
    val part = partOf(spec)
    var resumeFrom = if (part.exists()) part.length() else 0L
    if (resumeFrom >= spec.bytes) resumeFrom = 0L
    val url = URL(baseUrl.trimEnd('/') + "/" + version + "/" + spec.path)
    var connection = openConnection(url, resumeFrom)
    // Server ignored Range: restart the file instead of appending.
    if (resumeFrom > 0 && connection.responseCode != HttpURLConnection.HTTP_PARTIAL) {
      part.delete()
      resumeFrom = 0L
      connection.disconnect()
      connection = openConnection(url, 0L)
    }
    if (connection.responseCode !in listOf(
        HttpURLConnection.HTTP_OK, HttpURLConnection.HTTP_PARTIAL
      )
    ) {
      val code = connection.responseCode
      connection.disconnect()
      // Server-side hiccups (429, 5xx) are worth another try.
      val retry = if (code == 429 || code >= 500) RETRY else ""
      return "${retry}http $code for ${spec.path}"
    }
    try {
      val append = connection.responseCode == HttpURLConnection.HTTP_PARTIAL
      RandomAccessFile(part, "rw").use { out ->
        if (append) out.seek(resumeFrom) else out.setLength(0L)
        val buffer = ByteArray(1 shl 16)
        var lastEmit = System.currentTimeMillis()
        var sinceEmit = 0L
        connection.inputStream.use { stream ->
          while (true) {
            if (stop()) return "paused"
            val read = stream.read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
            onChunk(read.toLong())
            sinceEmit += read
            val now = System.currentTimeMillis()
            if (now - lastEmit > 500 || sinceEmit > totalBytes / 100) {
              lastEmit = now
              sinceEmit = 0L
            }
          }
        }
      }
    } catch (e: java.io.IOException) {
      // A dropped connection mid-file: the .part keeps what arrived.
      connection.disconnect()
      return "$RETRY${spec.path}: ${e.message ?: "download failed"}"
    } catch (e: Exception) {
      connection.disconnect()
      return "${spec.path}: ${e.message ?: "download failed"}"
    } finally {
      connection.disconnect()
    }
    if (stop()) return "paused"
    if (part.length() != spec.bytes) {
      return "${spec.path}: size ${part.length()}, want ${spec.bytes}"
    }
    val digest = sha256Hex(part, stop) ?: return "paused"
    if (!digest.equals(spec.sha256, ignoreCase = true)) {
      part.delete()
      final.delete()
      return "${spec.path}: sha256 mismatch"
    }
    final.delete()
    if (!part.renameTo(final)) return "${spec.path}: rename failed"
    return null
  }

  private fun openConnection(url: URL, resumeFrom: Long): HttpURLConnection {
    val connection = url.openConnection() as HttpURLConnection
    connection.connectTimeout = 15000
    connection.readTimeout = 30000
    connection.instanceFollowRedirects = true
    if (resumeFrom > 0) connection.setRequestProperty("Range", "bytes=$resumeFrom-")
    return connection
  }

  private fun writeManifest() {
    val entries = files.joinToString(",") {
      "{\"path\":\"${it.path}\",\"bytes\":${it.bytes},\"sha256\":\"${it.sha256}\"}"
    }
    File(dir, "models_manifest.json").writeText(
      "{\"version\":\"$version\",\"files\":[$entries],\"total_bytes\":$totalBytes}\n"
    )
  }

  companion object {
    // Marks a transient failure that run() retries (resuming the .part).
    private const val RETRY = "retry:"
    // Waits between retries of one file, in seconds. Any new bytes reset
    // the count, so only a link that stays down this long (~2.5 min)
    // fails the download.
    private val RETRY_DELAYS_S = longArrayOf(2, 5, 10, 20, 30, 60)

    fun sha256Hex(file: File, stop: () -> Boolean = { false }): String? {
      return try {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(1 shl 20)
        file.inputStream().use { stream ->
          while (true) {
            if (stop()) return null
            val read = stream.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
          }
        }
        // Mask to 0xFF: "%02x" sign-extends negative bytes ("-1" ->
        // "ffffffff"), which would fail every hash with a high bit set.
        digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
      } catch (e: Exception) {
        Log.w("TripoSG", "sha256 failed: ${e.message}")
        null
      }
    }

    // Space + network answers for the download confirmation UI.
    fun preflight(context: Context, root: File, version: String, wantBytes: Long): Map<String, Any> {
      val dir = File(root, version)
      dir.mkdirs()
      val freeBytes = dir.usableSpace
      val connectivity =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      val metered = connectivity?.isActiveNetworkMetered ?: false
      return mapOf(
        "metered" to metered,
        "freeBytes" to freeBytes,
        "enoughSpace" to (freeBytes >= wantBytes)
      )
    }
  }
}
