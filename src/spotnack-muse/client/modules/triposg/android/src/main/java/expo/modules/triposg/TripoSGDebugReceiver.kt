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
    w: Int, h: Int, outDir: String
  ): String?

  const val TAG = "TripoSGDebug"
}

// Host-side conversion trigger without UI (replaces dev-triposg.jsx):
//   adb push <photo> /sdcard/Download/triposg-test.png   # once
//   adb shell am broadcast -a expo.modules.triposg.DEBUG_CONVERT
// Follow `adb logcat -s TripoSGDebug` for progress; the GLBs land in the
// app cache dir triposg/debug/ (pull with `adb shell run-as
// <package> ls ...`, debuggable builds only).
//
// Release builds still contain the receiver, but onReceive returns
// immediately unless the app is debuggable, so it is harmless there.
class TripoSGDebugReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION = "expo.modules.triposg.DEBUG_CONVERT"
    const val EXTRA_IMAGE = "image"
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
    Thread {
      try {
        run(context.applicationContext, image)
      } catch (e: Exception) {
        Log.e(TripoSGDebug.TAG, "debug convert failed", e)
      }
    }.start()
  }

  private fun run(context: Context, imageUri: String) {
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
    Log.i(TripoSGDebug.TAG, "image=$imageUri models=${dir.absolutePath}")
    val (bytes, w, h) = decodeImageToRgba(context, imageUri)
    Log.i(TripoSGDebug.TAG, "decoded ${w}x$h")
    val outDir = File(context.cacheDir, "triposg/debug").apply { mkdirs() }
    val error = TripoSGDebug.nativeDebugConvert(
      dir.absolutePath, backend.absolutePath, bytes, w, h, outDir.absolutePath)
    val secs = (SystemClock.elapsedRealtime() - t0) / 1000
    if (error == null) {
      Log.i(TripoSGDebug.TAG, "DONE in ${secs}s mesh=$outDir/mesh.glb display=$outDir/mesh.display.glb")
    } else {
      Log.e(TripoSGDebug.TAG, "ERROR after ${secs}s: $error")
    }
  }
}
