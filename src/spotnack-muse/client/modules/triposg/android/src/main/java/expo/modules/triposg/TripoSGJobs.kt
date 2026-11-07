package expo.modules.triposg

import android.util.Log
import org.json.JSONObject
import java.io.File

// Persisted conversion job (single-flight engine, one record file).
// The record lets the app return or relaunch mid-conversion: a running
// job reattaches to live events, a done job completes its save, and a
// running job with no live worker (process died) reports interrupted.
// Statuses: running | done | failed | cancelled | interrupted.
data class PersistedJob(
  val jobId: String,
  val status: String,
  val imageUri: String,
  val fileName: String?,
  val width: Int,
  val height: Int,
  val steps: Int,
  val fraction: Double,
  val label: String,
  val outDir: String,
  val meshUri: String?,
  val displayMeshUri: String?,
  val error: String?
)

object TripoSGJobs {
  const val STATUS_RUNNING = "running"
  const val STATUS_DONE = "done"
  const val STATUS_FAILED = "failed"
  const val STATUS_CANCELLED = "cancelled"
  const val STATUS_INTERRUPTED = "interrupted"

  private const val TAG = "TripoSG"
  private const val RECORD_NAME = "job.json"

  // True while a worker thread owns the C++ engine. Plain memory: after
  // a process death it is false again, which is exactly how a stale
  // "running" record is detected.
  @Volatile
  var workerAlive = false

  // Latest progress for the notification loop (memory only; the file
  // carries transitions + terminal states, never a progress stream).
  @Volatile
  var progressSnapshot: Pair<Double, String>? = null

  // Same, for the model download notification (fraction, "x of y").
  @Volatile
  var downloadSnapshot: Pair<Double, String>? = null

  private fun recordFile(appFiles: File): File =
    File(File(appFiles, "triposg"), RECORD_NAME)

  fun jobsDir(appFiles: File): File = File(File(appFiles, "triposg"), "jobs")

  // Paths are plain Files captured once: re-resolving a Context on a
  // backgrounded app is needless risk for a record that must land.
  fun write(appFiles: File, job: PersistedJob) {
    try {
      val file = recordFile(appFiles)
      file.parentFile?.mkdirs()
      val json = JSONObject()
        .put("jobId", job.jobId)
        .put("status", job.status)
        .put("imageUri", job.imageUri)
        .put("fileName", job.fileName)
        .put("width", job.width)
        .put("height", job.height)
        .put("steps", job.steps)
        .put("fraction", job.fraction)
        .put("label", job.label)
        .put("outDir", job.outDir)
        .put("meshUri", job.meshUri)
        .put("displayMeshUri", job.displayMeshUri)
        .put("error", job.error)
      file.writeText(json.toString())
    } catch (e: Exception) {
      Log.w(TAG, "job record write failed: ${e.message}")
    }
  }

  fun read(appFiles: File): PersistedJob? {
    return try {
      val file = recordFile(appFiles)
      if (!file.exists()) return null
      val json = JSONObject(file.readText())
      PersistedJob(
        jobId = json.optString("jobId"),
        status = json.optString("status"),
        imageUri = json.optString("imageUri"),
        fileName = json.optString("fileName", null)?.ifEmpty { null },
        width = json.optInt("width"),
        height = json.optInt("height"),
        steps = json.optInt("steps"),
        fraction = json.optDouble("fraction"),
        label = json.optString("label"),
        outDir = json.optString("outDir"),
        meshUri = json.optString("meshUri", null)?.ifEmpty { null },
        displayMeshUri = json.optString("displayMeshUri", null)?.ifEmpty { null },
        error = json.optString("error", null)?.ifEmpty { null }
      ).takeIf { it.jobId.isNotEmpty() && it.status.isNotEmpty() }
    } catch (e: Exception) {
      Log.w(TAG, "job record read failed: ${e.message}")
      null
    }
  }

  fun clear(appFiles: File) {
    try {
      recordFile(appFiles).delete()
    } catch (e: Exception) {
      Log.w(TAG, "job record clear failed: ${e.message}")
    }
  }
}
