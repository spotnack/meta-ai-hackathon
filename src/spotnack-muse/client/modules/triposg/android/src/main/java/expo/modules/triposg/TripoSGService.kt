package expo.modules.triposg

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log

// Foreground holder for conversions and the model download: keeps the
// process alive and visible while the user leaves the app (HyperOS LMK
// kills a backgrounded process mid-run otherwise, and cuts a background
// app's sockets: "Software caused connection abort" mid-download).
//
// Type is dataSync: the job is local file processing (photo in, GLB
// out), which the platform docs list under dataSync. shortService was
// rejected (its ~3 min timeout ANRs midway through a ~5 min run) and
// specialUse is for cases no other type covers. Runs are user-initiated
// from the foreground, so the Android 15 BOOT_COMPLETED restriction on
// dataSync does not apply.
//
// The service never runs the engine itself: TripoSGModule owns the
// worker thread and stops this service on every terminal outcome. The
// poll loop only repaints the notification from the shared snapshot and
// self-stops if the job file already says terminal (belt and braces for
// a missed stopService call). Cancel arrives as an action intent and is
// forwarded to the live module instance, if any.
//
// All notification work runs on a dedicated thread, throttled to stage
// changes or ≥ 5 s with a changed percent: a 1 Hz notify on the main
// Handler measured ~2.5 s per message on HyperOS and dragged a 5.3 min
// run to 11 min.
class TripoSGService : Service() {
  companion object {
    const val ACTION_CONVERT = "expo.modules.triposg.action.CONVERT"
    const val ACTION_CANCEL = "expo.modules.triposg.action.CANCEL"
    const val ACTION_DOWNLOAD = "expo.modules.triposg.action.DOWNLOAD"
    const val ACTION_PAUSE_DOWNLOAD = "expo.modules.triposg.action.PAUSE_DOWNLOAD"
    const val EXTRA_JOB_ID = "jobId"
    private const val TAG = "TripoSGService"
    private const val NOTIFICATION_ID = 1001
    private const val CHANNEL_ID = "triposg_conversions"
    private const val POLL_MS = 1000L
    private const val POST_MIN_MS = 5000L
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  // True while this service holds the model download, not a conversion.
  private var downloadMode = false
  private var currentJobId: String? = null
  private var foregroundStarted = false

  private lateinit var notifThread: HandlerThread
  private lateinit var notifHandler: Handler
  private var notifManager: NotificationManager? = null
  private var builder: Notification.Builder? = null

  private var lastLabel: String? = null
  private var lastPercent = -1
  private var lastPostMs = 0L

  private val poll = object : Runnable {
    override fun run() {
      tick()
      notifHandler.postDelayed(this, POLL_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    notifThread = HandlerThread("TripoSGNotif").apply { start() }
    notifHandler = Handler(notifThread.looper)
    notifManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      notifManager?.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID, "3D conversions", NotificationManager.IMPORTANCE_LOW
        )
      )
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_DOWNLOAD -> {
        downloadMode = true
        currentJobId = "download"
        lastLabel = null
        lastPercent = -1
        lastPostMs = 0L
        builder = newBuilder()
        post("Starting…", 0.0, force = true)
        acquireWakeLock()
        acquireWifiLock()
        notifHandler.removeCallbacks(poll)
        notifHandler.post(poll)
      }
      ACTION_PAUSE_DOWNLOAD -> {
        Log.i(TAG, "notification Pause for the model download")
        post("Pausing…", TripoSGJobs.downloadSnapshot?.first ?: 0.0, force = true)
        TripoSGActiveModule.module?.pauseModelDownload()
      }
      ACTION_CONVERT -> {
        downloadMode = false
        currentJobId = intent.getStringExtra(EXTRA_JOB_ID)
        lastLabel = null
        lastPercent = -1
        lastPostMs = 0L
        builder = newBuilder()
        post("Starting…", 0.0, force = true)
        acquireWakeLock()
        notifHandler.removeCallbacks(poll)
        notifHandler.post(poll)
      }
      ACTION_CANCEL -> {
        val jobId = intent.getStringExtra(EXTRA_JOB_ID) ?: ""
        Log.i(TAG, "notification Cancel for job $jobId")
        val snapshot = TripoSGJobs.progressSnapshot
        post("Cancelling…", snapshot?.first ?: 0.0, force = true)
        TripoSGActiveModule.module?.cancelConversion(jobId)
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    notifHandler.removeCallbacks(poll)
    releaseWakeLock()
    releaseWifiLock()
    try {
      notifThread.quitSafely()
    } catch (e: Exception) {
      Log.w(TAG, "notif thread quit failed: ${e.message}")
    }
    currentJobId = null
    foregroundStarted = false
    builder = null
    super.onDestroy()
  }

  private fun tick() {
    if (downloadMode) {
      // The module stops the service when the download ends.
      TripoSGJobs.downloadSnapshot?.let { post(it.second, it.first, force = false) }
      return
    }
    val snapshot = TripoSGJobs.progressSnapshot
    if (snapshot != null) {
      post(snapshot.second, snapshot.first, force = false)
    }
    // Self-stop if the record already reached a terminal state (e.g. the
    // module's stopService call never landed).
    try {
      val record = TripoSGJobs.read(filesDir)
      if (record != null && record.jobId == currentJobId &&
        record.status != TripoSGJobs.STATUS_RUNNING
      ) {
        Log.i(TAG, "job ${record.jobId} is ${record.status}; stopping")
        stopSelf()
      }
    } catch (e: Exception) {
      Log.w(TAG, "record poll failed: ${e.message}")
    }
  }

  private fun post(label: String, fraction: Double, force: Boolean) {
    val percent = (fraction * 100).toInt().coerceIn(0, 100)
    val now = SystemClock.elapsedRealtime()
    if (!force && label == lastLabel &&
      (now - lastPostMs < POST_MIN_MS || percent == lastPercent)
    ) {
      return
    }
    lastLabel = label
    lastPercent = percent
    lastPostMs = now
    val notification = buildNotification(label, percent)
    if (!foregroundStarted) {
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(
          NOTIFICATION_ID, notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
      } else {
        @Suppress("DEPRECATION")
        startForeground(NOTIFICATION_ID, notification)
      }
      foregroundStarted = true
      return
    }
    notifManager?.notify(NOTIFICATION_ID, notification)
  }

  private fun newBuilder(): Notification.Builder {
    // Convert: Cancel the job. Download: Pause it (Resume from the app).
    val stopIntent = Intent(this, TripoSGService::class.java)
      .setAction(if (downloadMode) ACTION_PAUSE_DOWNLOAD else ACTION_CANCEL)
      .putExtra(EXTRA_JOB_ID, currentJobId)
    val stopAction = PendingIntent.getService(
      this, 0, stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val openApp = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(
        this, 0, it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }
    val fresh = if (Build.VERSION.SDK_INT >= 26) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    fresh.setContentTitle(
      if (downloadMode) "Downloading TripoSG QNN model" else "Generating 3D model"
    )
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true)
      .addAction(
        if (downloadMode) android.R.drawable.ic_media_pause
        else android.R.drawable.ic_menu_close_clear_cancel,
        if (downloadMode) "Pause" else "Cancel",
        stopAction
      )
    if (openApp != null) fresh.setContentIntent(openApp)
    return fresh
  }

  private fun buildNotification(label: String, percent: Int): Notification {
    // One builder per job; only the text and progress move per post.
    val active = builder ?: newBuilder().also { builder = it }
    active.setContentText(label)
      .setProgress(100, percent, false)
    return active.build()
  }

  private fun acquireWakeLock() {
    try {
      val power = getSystemService(POWER_SERVICE) as PowerManager
      wakeLock =
        power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "TripoSG:convert")
          .apply {
            setReferenceCounted(false)
            acquire()
          }
    } catch (e: Exception) {
      Log.w(TAG, "wake lock acquire failed: ${e.message}")
    }
  }

  // Keeps Wi-Fi at full power with the screen off during the download.
  private fun acquireWifiLock() {
    try {
      val wifi = applicationContext.getSystemService(WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "TripoSG:download")
        .apply {
          setReferenceCounted(false)
          acquire()
        }
    } catch (e: Exception) {
      Log.w(TAG, "wifi lock acquire failed: ${e.message}")
    }
  }

  private fun releaseWifiLock() {
    try {
      if (wifiLock?.isHeld == true) wifiLock?.release()
    } catch (e: Exception) {
      Log.w(TAG, "wifi lock release failed: ${e.message}")
    }
    wifiLock = null
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) wakeLock?.release()
    } catch (e: Exception) {
      Log.w(TAG, "wake lock release failed: ${e.message}")
    }
    wakeLock = null
  }
}

// Live module instance for service callbacks (Cancel, Pause). Set on
// convert and on download;
// the object outlives JS reloads, so notification Cancel keeps working
// with dead JS — the engine thread and its terminal path do too.
internal object TripoSGActiveModule {
  @Volatile
  var module: TripoSGModule? = null
}
