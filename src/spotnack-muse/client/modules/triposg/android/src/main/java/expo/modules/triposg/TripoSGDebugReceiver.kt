package expo.modules.triposg

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.SystemClock
import android.util.Log
import java.io.File

// Static JNI entry for the debug receiver (name-mangled JNI binds to
// the declaring class, so this cannot reuse TripoSGModule's methods).
// Same engine, fixed knobs; see jni_bridge.cpp.
object TripoSGDebug {
  init {
    try {
      System.loadLibrary("triposg_jni")
    } catch (e: UnsatisfiedLinkError) {
      Log.w(TAG, "triposg_jni missing: $e")
    }
  }

  external fun nativeDebugConvert(
    modelDir: String, backendPath: String, rgba: ByteArray,
    w: Int, h: Int, outDir: String, noisePath: String
  ): String?

  const val TAG = "TripoSGDebug"
}

// Host-side conversion trigger without UI (replaces dev-triposg.jsx):
//   adb push <photo> /sdcard/Download/triposg-test.png   # once
//   adb shell am broadcast -a expo.modules.triposg.DEBUG_CONVERT
//   # golden-noise grading: -e noise <device path to (1,2048,64) f32 .npy>
//   #   -e tag <subfolder of triposg/debug/>
// Follow `adb logcat -s TripoSGDebug` for progress; the GLBs land in the
// app cache dir triposg/debug/ (or triposg/debug/<tag>/ with -e tag;
// pull with `adb shell run-as <package> ls ...`, debuggable builds
// only). At DONE one TIMINGS line logs per-stage wall seconds for
// logcat parsing.
// Without -e noise the run uses seed 42, exactly as before.
//
// Release builds still contain the receiver, but onReceive returns
// immediately unless the app is debuggable, so it is harmless there.
class TripoSGDebugReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION = "expo.modules.triposg.DEBUG_CONVERT"
    const val EXTRA_IMAGE = "image"
    const val EXTRA_NOISE = "noise"
    const val EXTRA_TAG = "tag"
    const val DEFAULT_IMAGE = "file:///sdcard/Download/triposg-test.png"
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    if ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
      Log.w(TripoSGDebug.TAG, "ignoring debug convert: release build")
      return
    }
    // Do not hold the broadcast open: a conversion takes minutes and the
    // broadcast timeout would raise an ANR dialog (seen on device). The
    // thread keeps running in the (foreground, debuggable) app process.
    val image = intent.getStringExtra(EXTRA_IMAGE) ?: DEFAULT_IMAGE
    val noise = intent.getStringExtra(EXTRA_NOISE) ?: ""
    val tag = intent.getStringExtra(EXTRA_TAG) ?: ""
    Thread {
      try {
        run(context.applicationContext, image, noise, tag)
      } catch (e: Exception) {
        Log.e(TripoSGDebug.TAG, "debug convert failed", e)
      }
    }.start()
  }

  private fun run(context: Context, imageUri: String, noisePath: String, tag: String) {
    val t0 = SystemClock.elapsedRealtime()
    val root = File(context.getExternalFilesDir(null), "triposg")
    val dir = root.listFiles()?.sortedByDescending { it.name }
      ?.firstOrNull { File(it, "models_manifest.json").exists() }
      ?: throw IllegalStateException("no models sideloaded under $root")
    try {
      android.system.Os.setenv(
        "ADSP_LIBRARY_PATH", context.applicationInfo.nativeLibraryDir, true)
    } catch (e: Exception) {
      Log.w(TripoSGDebug.TAG, "ADSP_LIBRARY_PATH not set: $e")
    }
    val backend = File(context.applicationInfo.nativeLibraryDir, "libQnnHtp.so")
    Log.i(TripoSGDebug.TAG, "image=$imageUri models=${dir.absolutePath} noise=$noisePath tag=$tag")
    val (bytes, w, h) = decodeImageToRgba(context, imageUri)
    Log.i(TripoSGDebug.TAG, "decoded ${w}x$h")
    // Keep the tag inside triposg/debug/: strip anything path-shaped.
    val safeTag = tag.replace(Regex("[^A-Za-z0-9._-]"), "_")
    val outDir = File(context.cacheDir, "triposg/debug" +
      if (safeTag.isEmpty()) "" else "/$safeTag").apply { mkdirs() }
    val error = TripoSGDebug.nativeDebugConvert(
      dir.absolutePath, backend.absolutePath, bytes, w, h, outDir.absolutePath,
      noisePath)
    val secs = (SystemClock.elapsedRealtime() - t0) / 1000
    if (error == null) {
      Log.i(TripoSGDebug.TAG, "DONE in ${secs}s mesh=$outDir/mesh.glb display=$outDir/mesh.display.glb")
    } else {
      Log.e(TripoSGDebug.TAG, "ERROR after ${secs}s: $error")
    }
  }
}
