package expo.modules.triposg

import android.Manifest
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.system.Os
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

// Custom exception for image decoding failures.
class ImageDecodeException(message: String) : Exception(message)

// EXIF-aware image decode shared by the module and the debug receiver:
// content/file URI -> (ARGB_8888 bytes, width, height).
internal fun decodeImageToRgba(ctx: Context, uri: String): Triple<ByteArray, Int, Int> {
  val parsed = Uri.parse(uri) ?: throw ImageDecodeException("bad image URI")
  var orientation = ExifInterface.ORIENTATION_NORMAL
  try {
    ctx.contentResolver.openInputStream(parsed)?.use { stream ->
      orientation = ExifInterface(stream).getAttributeInt(
        ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
    }
  } catch (e: Exception) {
    // Orientation unknown: proceed unrotated.
  }
  val opts = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
  val bitmap = ctx.contentResolver.openInputStream(parsed)?.use { stream ->
    BitmapFactory.decodeStream(stream, null, opts)
  } ?: throw ImageDecodeException("could not decode image (need JPEG/PNG/HEIC)")
  val rotated = when (orientation) {
    ExifInterface.ORIENTATION_ROTATE_90,
    ExifInterface.ORIENTATION_ROTATE_180,
    ExifInterface.ORIENTATION_ROTATE_270 -> {
      val degrees = when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        else -> 270f
      }
      val matrix = Matrix().apply { postRotate(degrees) }
      Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
    ExifInterface.ORIENTATION_FLIP_HORIZONTAL,
    ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
      val matrix = Matrix().apply {
        if (orientation == ExifInterface.ORIENTATION_FLIP_HORIZONTAL) preScale(-1f, 1f)
        else preScale(1f, -1f)
      }
      Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
    else -> bitmap
  }
  val bytes = ByteBuffer.allocate(rotated.width * rotated.height * 4)
  rotated.copyPixelsToBuffer(bytes)
  if (rotated !== bitmap) bitmap.recycle()
  return Triple(bytes.array(), rotated.width, rotated.height)
}

// Runs one conversion per jobId on a single background thread (the C++
// engine is single-flight). Progress/completion arrive as module events
// so the JS adapter can stay a thin port implementation (part B).
class TripoSGModule : Module() {
  companion object {
    init {
      System.loadLibrary("triposg_jni")
    }
  }

  private val executor = Executors.newSingleThreadExecutor()
  private data class Job(val id: String, var done: Boolean = false, var stopRequested: Boolean = false)
  private val jobs = ConcurrentHashMap<String, Job>()
  // The C++ engine is single-flight: convert and full-verify both take
  // this around their native call (convert jobs additionally queue on
  // the executor, so a second convert waits its turn and finds it free).
  private val engineBusy = java.util.concurrent.atomic.AtomicBoolean(false)

  private external fun nativeConfigure(modelDir: String, backendPath: String): String?
  private external fun nativeConvert(
    rgba: ByteArray, w: Int, h: Int, steps: Int, guidance: Double,
    d0: Int, d1: Int, seed: Long, targetTris: Int, noisePath: String,
    outDir: String, progressCb: ProgressCallback
  ): String?
  private external fun nativeCancel()
  private external fun nativeRelease()
  private external fun nativeVerifySizes(modelDir: String): String
  private external fun nativeVerifyFull(modelDir: String, progressCb: ProgressCallback): String?

  // Live record for throttled job.json progress writes (worker thread
  // only; single-flight engine, so no locking). Cleared on terminal.
  private var activeRecord: PersistedJob? = null
  private var activeJobFilesDir: File? = null
  private var lastRecordWriteMs = 0L

  // Called from C++ (see jni_bridge.cpp) on the worker thread.
  inner class ProgressCallback {
    @Suppress("unused")
    fun onProgress(fraction: Double, label: String) {
      TripoSGJobs.progressSnapshot = Pair(fraction, label)
      // Persist fraction/label at most every 5 s: a relaunch mid-run
      // resumes from real progress instead of 0% "Starting…".
      val record = activeRecord
      val filesDir = activeJobFilesDir
      if (record != null && filesDir != null) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastRecordWriteMs >= 5000L) {
          lastRecordWriteMs = now
          val updated = record.copy(fraction = fraction, label = label)
          activeRecord = updated
          TripoSGJobs.write(filesDir, updated)
        }
      }
      val holder = currentJob.get()
      if (holder != null) {
        sendEvent("onProgress", mapOf(
          "jobId" to holder,
          "fraction" to fraction,
          "label" to label
        ))
      }
    }
  }
  private val currentJob = ThreadLocal<String?>()

  private fun modelRoot(): File {
    val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
    return File(ctx.getExternalFilesDir(null), "triposg")
  }

  private fun manifestVersion(dir: File): String? {
    val manifest = File(dir, "models_manifest.json")
    if (!manifest.exists()) return null
    return try {
      JSONObject(manifest.readText()).optString("version", null)?.ifEmpty { null }
    } catch (e: Exception) {
      null
    }
  }

  private fun nativeLibraryDir(): String {
    val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
    return ctx.applicationInfo.nativeLibraryDir
  }

  private fun jobToMap(record: PersistedJob): Map<String, Any?> {
    return mapOf(
      "jobId" to record.jobId,
      "status" to record.status,
      "imageUri" to record.imageUri,
      "fileName" to record.fileName,
      "width" to record.width,
      "height" to record.height,
      "steps" to record.steps,
      "fraction" to record.fraction,
      "label" to record.label,
      "outDir" to record.outDir,
      "meshUri" to record.meshUri,
      "displayMeshUri" to record.displayMeshUri,
      "error" to record.error
    )
  }

  private var trimCallbacks: ComponentCallbacks2? = null

  // True while a conversion owns the engine (download-only traffic does
  // not count: it never holds NPU sessions).
  private fun convertActive(): Boolean {
    if (TripoSGJobs.workerAlive) return true
    return jobs.keys.any { it != "download" }
  }

  // Drops IDLE resident NPU sessions under memory pressure (see
  // docs/ai_pipeline.md "Phase 3: lifecycle"). Never while a conversion
  // runs — the foreground service owns those sessions until terminal.
  // Registered once against the application context, so it lives with
  // the process.
  private fun ensureTrimWatcher() {
    if (trimCallbacks != null) return
    val app = appContext.reactContext?.applicationContext ?: return
    trimCallbacks = object : ComponentCallbacks2 {
      override fun onConfigurationChanged(config: Configuration) {}
      override fun onLowMemory() {
        if (convertActive()) return
        try {
          nativeRelease()
        } catch (e: Exception) {
          // Best effort from a memory callback.
        }
      }
      override fun onTrimMemory(level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) {
          if (convertActive()) return
          try {
            nativeRelease()
          } catch (e: Exception) {
            // Best effort from a memory callback.
          }
        }
      }
    }
    app.registerComponentCallbacks(trimCallbacks)
  }

  // Android 13+: ask once for the conversion notification. Fire-and-forget
  // (no result handling): a denied permission only hides the
  // notification, the foreground service still runs.
  private fun ensureNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33) return
    val ctx = appContext.reactContext ?: return
    if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    try {
      appContext.currentActivity?.requestPermissions(
        arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001
      )
    } catch (e: Exception) {
      // No activity (or race): conversion proceeds without the banner.
    }
  }

  private fun startConverterService(jobId: String) {
    val ctx = appContext.reactContext ?: return
    val intent = Intent(ctx, TripoSGService::class.java)
      .setAction(TripoSGService.ACTION_CONVERT)
      .putExtra(TripoSGService.EXTRA_JOB_ID, jobId)
    if (Build.VERSION.SDK_INT >= 26) {
      ctx.startForegroundService(intent)
    } else {
      ctx.startService(intent)
    }
  }

  private fun stopConverterService() {
    try {
      val ctx = appContext.reactContext ?: return
      ctx.stopService(Intent(ctx, TripoSGService::class.java))
    } catch (e: Exception) {
      // The service self-stops off the terminal job record as backup.
    }
  }

  @Suppress("unchecked_cast")
  private fun specsFrom(options: Map<String, Any?>): List<ModelSpec> {
    val rawFiles = options["files"] as? List<Map<String, Any?>>
      ?: throw IllegalArgumentException("needs files [{path, bytes, sha256}]")
    return rawFiles.map {
      ModelSpec(
        it["path"] as? String ?: throw IllegalArgumentException("file needs path"),
        (it["bytes"] as? Number)?.toLong()
          ?: throw IllegalArgumentException("file needs bytes"),
        it["sha256"] as? String ?: throw IllegalArgumentException("file needs sha256")
      )
    }
  }

  private fun newestModelDir(): File? {
    val root = modelRoot()
    return root.listFiles()?.sortedByDescending { it.name }
      ?.firstOrNull { File(it, "models_manifest.json").exists() }
  }

  private fun dirWithPartials(): File? {
    val root = modelRoot()
    return root.listFiles()?.filter { it.isDirectory }?.firstOrNull { dir ->
      dir.walkTopDown().maxDepth(3).any { it.isFile && it.name.endsWith(".part") }
    }
  }

  // SoC + HTP-library preflight. Full backend proof happens at the first
  // session create; this only gates the clear-cut unsupported cases.
  private fun preflight(): Pair<Boolean, String> {
    if (Build.VERSION.SDK_INT < 29) {
      return Pair(false, "needs Android 10+")
    }
    val soc = if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL ?: "" else ""
    if (soc.isNotEmpty() && !soc.contains("SM8750", ignoreCase = true)) {
      return Pair(false, "needs Snapdragon 8 Elite (SM8750); this device reports $soc")
    }
    val htp = File(nativeLibraryDir(), "libQnnHtp.so")
    if (!htp.exists()) {
      return Pair(false, "QNN HTP runtime missing (libQnnHtp.so not packaged)")
    }
    return Pair(true, if (soc.isEmpty()) "SoC model unknown; HTP library present" else "SM8750 + HTP ready")
  }

  private fun ensureAdspPath() {
    try {
      Os.setenv("ADSP_LIBRARY_PATH", nativeLibraryDir(), true)
    } catch (e: Exception) {
      // Non-fatal: the HTP loader falls back to its bundled paths.
    }
  }

  private fun decodeToRgba(uri: String): Triple<ByteArray, Int, Int> {
    val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
    return decodeImageToRgba(ctx, uri)
  }

  // Entry point for the notification Cancel action (via
  // TripoSGActiveModule) as well as JS cancel(jobId).
  internal fun cancelConversion(jobId: String): Boolean {
    val job = jobs[jobId] ?: return false
    job.stopRequested = true
    nativeCancel()
    return true
  }

  override fun definition() = ModuleDefinition {
    Name("TripoSG")

    Events("onProgress", "onDone", "onError", "onDownloadProgress")

    AsyncFunction("getStatus") {
      val (supported, reason) = preflight()
      val root = modelRoot()
      var modelDir: String? = null
      var modelVersion: String? = null
      var modelsVerified: Boolean? = null
      // Pick the newest version dir that holds a manifest.
      val entries = root.listFiles()
      android.util.Log.i("TripoSG", "getStatus root=${root.absolutePath} exists=${root.exists()} canRead=${root.canRead()} entries=${entries?.map { it.name }}")
      entries?.sortedByDescending { it.name }?.forEach { dir ->
        if (modelDir == null && File(dir, "models_manifest.json").exists()) {
          modelDir = dir.absolutePath
          modelVersion = manifestVersion(dir)
          val sizeError = nativeVerifySizes(dir.absolutePath)
          modelsVerified = sizeError.isEmpty()
          android.util.Log.i("TripoSG", "getStatus dir=${dir.name} version=$modelVersion sizeCheck=${if (sizeError.isEmpty()) "ok" else sizeError}")
        }
      }
      mapOf(
        "supported" to supported,
        "reason" to reason,
        "modelDir" to modelDir,
        "modelVersion" to modelVersion,
        "modelsVerified" to modelsVerified
      )
    }

    AsyncFunction("verifyModels") { options: Map<String, Any?> ->
      val full = options["full"] as? Boolean ?: false
      val (supported, reason) = preflight()
      if (!supported) throw IllegalStateException("unsupported: $reason")
      val root = modelRoot()
      val dir = root.listFiles()?.sortedByDescending { it.name }
        ?.firstOrNull { File(it, "models_manifest.json").exists() }
        ?: throw IllegalStateException("no models downloaded")
      ensureAdspPath()
      if (!full) {
        val problem = nativeVerifySizes(dir.absolutePath)
        return@AsyncFunction mapOf("ok" to problem.isEmpty(), "problem" to (problem.ifEmpty { null }))
      }
      if (!engineBusy.compareAndSet(false, true)) {
        throw IllegalStateException("a conversion is running")
      }
      val jobId = "verify"
      currentJob.set(jobId)
      try {
        val error = nativeVerifyFull(dir.absolutePath, ProgressCallback())
        if (error == null) return@AsyncFunction mapOf("ok" to true, "problem" to null)
        if (error == "cancelled") return@AsyncFunction mapOf("ok" to false, "problem" to "cancelled")
        return@AsyncFunction mapOf("ok" to false, "problem" to error)
      } finally {
        currentJob.remove()
        engineBusy.set(false)
      }
    }

    AsyncFunction("convert") { options: Map<String, Any?> ->
      val (supported, reason) = preflight()
      if (!supported) throw IllegalStateException("unsupported: $reason")
      val imageUri = options["imageUri"] as? String
        ?: throw IllegalArgumentException("convert needs imageUri")
      val root = modelRoot()
      val dir = root.listFiles()?.sortedByDescending { it.name }
        ?.firstOrNull { File(it, "models_manifest.json").exists() }
        ?: throw IllegalStateException("no models downloaded")
      val quick = nativeVerifySizes(dir.absolutePath)
      if (quick.isNotEmpty()) throw IllegalStateException("models incomplete: $quick")
      ensureAdspPath()
      ensureTrimWatcher()
      val configError = nativeConfigure(
        dir.absolutePath, File(nativeLibraryDir(), "libQnnHtp.so").absolutePath)
      if (configError != null) throw IllegalStateException(configError)

      val (bytes, w, h) = decodeToRgba(imageUri)
      val jobId = UUID.randomUUID().toString()
      jobs[jobId] = Job(jobId)
      val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
      // filesDir (not cacheDir): outputs must survive backgrounding and a
      // relaunch that completes the save.
      val outDir = File(TripoSGJobs.jobsDir(ctx.filesDir), jobId).apply { mkdirs() }
      val steps = (options["steps"] as? Number)?.toInt() ?: 50
      val guidance = (options["guidance"] as? Number)?.toDouble() ?: 7.0
      val seed = (options["seed"] as? Number)?.toLong() ?: 0L
      @Suppress("unchecked_cast")
      val depth = options["depth"] as? Map<String, Any?>
      val d0 = (depth?.get("d0") as? Number)?.toInt() ?: 6
      val d1 = (depth?.get("d1") as? Number)?.toInt() ?: 8
      val targetTris = (options["targetTris"] as? Number)?.toInt() ?: 100000
      // The hook needs these to finish the save after a relaunch.
      val fileName = options["fileName"] as? String
      val imageW = (options["imageWidth"] as? Number)?.toInt() ?: w
      val imageH = (options["imageHeight"] as? Number)?.toInt() ?: h

      // Register for notification-Cancel before any throw below can leak.
      TripoSGActiveModule.module = this@TripoSGModule
      TripoSGJobs.workerAlive = false
      TripoSGJobs.progressSnapshot = Pair(0.0, "Starting…")
      // Plain path, captured once: the record must land even when the
      // app is backgrounded and the react context has gone stale.
      val appFilesDir = ctx.filesDir
      val running = PersistedJob(
        jobId = jobId, status = TripoSGJobs.STATUS_RUNNING,
        imageUri = imageUri, fileName = fileName,
        width = imageW, height = imageH, steps = steps,
        fraction = 0.0, label = "Starting…",
        outDir = outDir.absolutePath,
        meshUri = null, displayMeshUri = null, error = null
      )
      activeRecord = running
      activeJobFilesDir = appFilesDir
      lastRecordWriteMs = SystemClock.elapsedRealtime()
      TripoSGJobs.write(appFilesDir, running)
      ensureNotificationPermission()
      startConverterService(jobId)

      // Terminal write first, then service stop, then events: the record
      // is the source of truth a relaunch resumes from, so it must land
      // before anything else tears down.
      val finish = { terminal: PersistedJob, event: Map<String, Any?> ->
        TripoSGJobs.workerAlive = false
        TripoSGJobs.progressSnapshot = null
        activeRecord = null
        activeJobFilesDir = null
        TripoSGJobs.write(appFilesDir, terminal)
        Log.i("TripoSG", "job $jobId finished: ${terminal.status}")
        stopConverterService()
        sendEvent(if (terminal.status == TripoSGJobs.STATUS_DONE) "onDone" else "onError", event)
      }
      val fail = { code: String, message: String ->
        outDir.deleteRecursively()
        jobs.remove(jobId)
        currentJob.remove()
        finish(
          PersistedJob(jobId, TripoSGJobs.STATUS_FAILED, imageUri, fileName,
            imageW, imageH, steps, 0.0, "", outDir.absolutePath,
            null, null, message),
          mapOf("jobId" to jobId, "code" to code, "message" to message)
        )
      }
      executor.execute {
        // Explicit foreground-default priority: a backgrounded app must
        // not run its NPU-feeding thread at background priority.
        // (Held with the partial wake lock from TripoSGService; HyperOS
        // may still throttle background apps — see the module README.)
        Process.setThreadPriority(Process.THREAD_PRIORITY_DEFAULT)
        currentJob.set(jobId)
        if (jobs[jobId]?.stopRequested == true) {
          jobs.remove(jobId)
          currentJob.remove()
          outDir.deleteRecursively()
          finish(
            PersistedJob(jobId, TripoSGJobs.STATUS_CANCELLED, imageUri,
              fileName, imageW, imageH, steps, 0.0, "",
              outDir.absolutePath, null, null, null),
            mapOf("jobId" to jobId, "code" to "cancelled",
              "message" to "conversion was stopped")
          )
          return@execute
        }
        if (!engineBusy.compareAndSet(false, true)) {
          jobs.remove(jobId)
          currentJob.remove()
          outDir.deleteRecursively()
          finish(
            PersistedJob(jobId, TripoSGJobs.STATUS_FAILED, imageUri,
              fileName, imageW, imageH, steps, 0.0, "",
              outDir.absolutePath, null, null, "another job is using the engine"),
            mapOf("jobId" to jobId, "code" to "busy",
              "message" to "another job is using the engine")
          )
          return@execute
        }
        TripoSGJobs.workerAlive = true
        try {
          // ProgressCallback (the JNI-visible entry) mirrors every event
          // into the snapshot the notification loop paints.
          val error = nativeConvert(bytes, w, h, steps, guidance, d0, d1,
            seed, targetTris, "", outDir.absolutePath, ProgressCallback())
          jobs[jobId]?.done = true
          if (error == null) {
            val meshUri = File(outDir, "mesh.glb").toURI().toString()
            val displayMeshUri = File(outDir, "mesh.display.glb").toURI().toString()
            jobs.remove(jobId)
            currentJob.remove()
            finish(
              PersistedJob(jobId, TripoSGJobs.STATUS_DONE, imageUri,
                fileName, imageW, imageH, steps, 1.0, "Done",
                outDir.absolutePath, meshUri, displayMeshUri, null),
              mapOf("jobId" to jobId, "meshUri" to meshUri,
                "displayMeshUri" to displayMeshUri)
            )
          } else if (error == "cancelled") {
            jobs.remove(jobId)
            currentJob.remove()
            outDir.deleteRecursively()
            finish(
              PersistedJob(jobId, TripoSGJobs.STATUS_CANCELLED, imageUri,
                fileName, imageW, imageH, steps, 0.0, "",
                outDir.absolutePath, null, null, null),
              mapOf("jobId" to jobId, "code" to "cancelled",
                "message" to "conversion was stopped")
            )
          } else {
            fail("failed", error)
          }
        } catch (e: Exception) {
          fail("failed", e.message ?: "convert failed")
        } finally {
          jobs.remove(jobId)
          currentJob.remove()
          TripoSGJobs.workerAlive = false
          engineBusy.set(false)
        }
      }
      return@AsyncFunction jobId
    }

    AsyncFunction("cancel") { jobId: String ->
      // The download worker polls its own flag; never touch the C++
      // engine here (a conversion may be using it).
      if (jobId == "download") {
        val job = jobs[jobId]
        if (job != null) {
          job.stopRequested = true
          return@AsyncFunction true
        }
        return@AsyncFunction false
      }
      if (jobId == "verify") {
        nativeCancel()
        return@AsyncFunction true
      }
      return@AsyncFunction cancelConversion(jobId)
    }

    // The persisted job for hook resume (return or relaunch). A "running"
    // record with no live worker means the process died mid-run: its
    // leftovers are deleted and it reports "interrupted", so the UI can
    // offer a retry instead of a ghost progress bar. Null when idle.
    AsyncFunction("getPendingJob") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val appFilesDir = ctx.filesDir
      val record = TripoSGJobs.read(appFilesDir) ?: return@AsyncFunction null
      if (record.status == TripoSGJobs.STATUS_RUNNING && !TripoSGJobs.workerAlive) {
        // Interrupted runs never save: outputs are deleted here, and the
        // hook only completes saves from validated done records.
        try {
          File(record.outDir).deleteRecursively()
        } catch (e: Exception) {
          // Best effort; the hook clears the record next.
        }
        val interrupted = record.copy(
          status = TripoSGJobs.STATUS_INTERRUPTED,
          error = "The app closed during the conversion."
        )
        TripoSGJobs.write(appFilesDir, interrupted)
        return@AsyncFunction jobToMap(interrupted)
      }
      return@AsyncFunction jobToMap(record)
    }

    AsyncFunction("clearJob") { jobId: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      val appFilesDir = ctx.filesDir
      val record = TripoSGJobs.read(appFilesDir)
      if (record == null || record.jobId != jobId) return@AsyncFunction false
      if (record.status == TripoSGJobs.STATUS_RUNNING && TripoSGJobs.workerAlive) {
        return@AsyncFunction false
      }
      try {
        if (record.status != TripoSGJobs.STATUS_DONE) {
          File(record.outDir).deleteRecursively()
        }
      } catch (e: Exception) {
        // Best effort; the record is what matters.
      }
      TripoSGJobs.clear(appFilesDir)
      return@AsyncFunction true
    }

    AsyncFunction("release") {
      nativeRelease()
      return@AsyncFunction true
    }

    // Space + network answers for the download confirmation UI. The
    // caller passes the not-yet-downloaded bytes (total minus
    // getDownloadProgress), so a resume only checks its remainder.
    AsyncFunction("downloadPreflight") { options: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
      val remaining = (options["remainingBytes"] as? Number)?.toLong() ?: 0L
      val version = options["version"] as? String ?: ""
      ModelDownloader.preflight(ctx, modelRoot(), version, remaining)
    }

    // Bytes already on disk for this version (finished + .part files),
    // so the UI can show paused/resumable state after a restart.
    AsyncFunction("getDownloadProgress") { options: Map<String, Any?> ->
      val version = options["version"] as? String ?: ""
      val progress =
        ModelDownloader(modelRoot(), "", version, specsFrom(options)).diskProgress()
      mapOf(
        "downloadedBytes" to progress.downloadedBytes,
        "totalBytes" to progress.totalBytes
      )
    }

    // Downloads every missing file with per-file resume, SHA-256 and
    // rename-after-verify. Resolves {status, problem}: "completed" /
    // "paused" (pauseDownload, cancel("download"), or a restart in
    // between — re-call to resume) / "failed". Progress arrives as
    // onDownloadProgress events, throttled to ~2 Hz.
    AsyncFunction("startDownload") { options: Map<String, Any?> ->
      val (supported, reason) = preflight()
      if (!supported) throw IllegalStateException("unsupported: $reason")
      val baseUrl = options["baseUrl"] as? String
        ?: throw IllegalArgumentException("startDownload needs baseUrl")
      val version = options["version"] as? String
        ?: throw IllegalArgumentException("startDownload needs version")
      val files = specsFrom(options)
      ensureTrimWatcher()
      val jobId = "download"
      if (jobs.putIfAbsent(jobId, Job(jobId)) != null) {
        throw IllegalStateException("a download is already running")
      }
      currentJob.set(jobId)
      var lastEmitMs = 0L
      try {
        val worker = ModelDownloader(modelRoot(), baseUrl, version, files)
        val at = worker.diskProgress()
        val target = File(modelRoot(), version).apply { mkdirs() }
        val remaining = at.totalBytes - at.downloadedBytes
        if (target.usableSpace < remaining) {
          return@AsyncFunction mapOf(
            "status" to "failed",
            "problem" to "not enough free space: need $remaining bytes")
        }
        val error = worker.run(
          stop = { jobs[jobId]?.stopRequested == true },
          onProgress = { progress ->
            val now = System.currentTimeMillis()
            if (now - lastEmitMs > 500 ||
              progress.downloadedBytes >= progress.totalBytes
            ) {
              lastEmitMs = now
              sendEvent("onDownloadProgress", mapOf(
                "downloadedBytes" to progress.downloadedBytes,
                "totalBytes" to progress.totalBytes,
                "file" to progress.file,
                "fileIndex" to progress.fileIndex,
                "fileCount" to progress.fileCount
              ))
            }
          })
        return@AsyncFunction when {
          error == null -> mapOf("status" to "completed", "problem" to null)
          error == "paused" -> mapOf("status" to "paused", "problem" to null)
          else -> mapOf("status" to "failed", "problem" to error)
        }
      } finally {
        jobs.remove(jobId)
        currentJob.remove()
      }
    }

    AsyncFunction("pauseDownload") {
      val job = jobs["download"]
      if (job != null) {
        job.stopRequested = true
        return@AsyncFunction true
      }
      return@AsyncFunction false
    }

    // Deletes the installed (or partially downloaded) model dir.
    AsyncFunction("deleteModels") { options: Map<String, Any?> ->
      val requested = options["version"] as? String
      val dir = when {
        requested != null -> File(modelRoot(), requested).takeIf { it.isDirectory }
        else -> newestModelDir() ?: dirWithPartials()
      } ?: return@AsyncFunction mapOf("ok" to false)
      if (jobs.containsKey("download")) {
        return@AsyncFunction mapOf("ok" to false)
      }
      dir.deleteRecursively()
      return@AsyncFunction mapOf("ok" to true)
    }
  }
}
