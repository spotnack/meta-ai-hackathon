# @spotnack/triposg — on-device TripoSG Expo module (Phase 3A + part B)

Local Expo module (portal-linked from `client/package.json`). Android
runs the full pipeline on the SM8750 NPU; iOS reports `unsupported`.

- `index.js` — JS API (`getStatus`, `verifyModels({full})`,
  `convert({...}) → jobId`, `cancel`, `release`, `onProgress/onDone/onError`,
  plus `downloadPreflight`, `getDownloadProgress`, `startDownload`,
  `pauseDownload`, `deleteModels`, `onDownloadProgress`).
- `android/` — Kotlin module + JNI + CMake. Needs the Gradle deps from
  Maven Central and the vendored meshoptimizer (see below).
  `TripoSGDownload.kt` is the resumable model downloader;
  `TripoSGDebugReceiver.kt` is the debuggable-only adb trigger (see below).
- `app.plugin.js` — config plugin (listed in `app.json`): drops the unused
  QNN backends from the APK (keeps HTP V79 + system libs; ~94 MB saved).
- `cpp/` — engine (`pipeline`, `preprocess`, `decimate`, `models`) plus
  the shared `ml/triposg-mobile/cpp` core via `add_subdirectory`.
- `ios/` — stub.
- `THIRD_PARTY_LICENSES.md` — license table.

Setup (you run this, once):

```sh
# 1. Vendor meshoptimizer (see cpp/third_party/meshoptimizer/README.md).
# 2. Link the module and fetch its Gradle deps:
cd src/spotnack-muse/client && yarn install
# 3. Sideload models (ml/triposg-mobile/bench/sideload_models.sh),
#    or set EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL and download in-app.
# 4. Prebuild + build + install.
```

`app.json` sets `useLegacyPackaging` (expo-build-properties) so the QNN
`.so` files extract to `nativeLibraryDir`, where the HTP loader needs
them. Never hand-edit `android/` or `ios/` — CNG generates those
(the receiver/service entries live in *this* module's
`AndroidManifest.xml`, which CNG merges).

## Background-safe conversions

The engine runs inside a `dataSync` foreground service
(`TripoSGService.kt`): ongoing notification (stage + percent, Cancel
action, tap opens the app) plus a partial wake lock. A conversion stops
only on the user's Cancel, on error, or if the OS kills the service —
backgrounding the app never stops it. `POST_NOTIFICATIONS` is requested
once before the first conversion; denied only hides the notification.

Notification cost matters: all notification work runs on a dedicated
`HandlerThread` (never the main thread — a 1 Hz notify there measured
~2.5 s per message on HyperOS and dragged a 5.3 min run to 11 min), one
reused `Notification.Builder`, and posts only on stage change or every
≥ 5 s with a changed percent. The worker thread sets
`THREAD_PRIORITY_DEFAULT` explicitly. HyperOS may still throttle
backgrounded apps beyond this — if background runs stay slow, that is
the OS, not the notification path.

One job record (`filesDir/triposg/job.json`, via `TripoSGJobs.kt`)
tracks id, status, outputs and the save context. Paths are captured
once as plain Files (never a re-resolved Context on a backgrounded
app). The worker writes fraction/label at most every 5 s and the
terminal status (done + outputs / failed + error / cancelled) the
moment it finishes, before the service stops — with a `TripoSG` logcat
line per terminal outcome. The hook reads it on mount
(`getPendingJob`): a live job reattaches to its events, a done job
completes its save, failed/interrupted report, cancelled clears
silently. The record is cleared after every in-session terminal
outcome (`clearJob`); outputs live in filesDir (not cache) so they
survive backgrounding.

Only validated saves: the engine writes `mesh.glb` /
`mesh.display.glb` to `.tmp` names and renames on success only
(`cpp/pipeline.cpp`; tmps are removed on failure/cancel), and JS saves
a done record only after both files pass a GLB header + length check
(`assertValidJobMeshes`). Interrupted/failed runs delete their outputs
and can never reach the library as a broken mesh.

## NPU memory: one merged session (7.1 GB, was 9 GB)

Every QNN context pins its own spill-fill scratch buffer (99 MiB per
early block, 73 MiB late, 65 MiB tail — 1.8 GiB for 23 sessions while
only one unit runs). `bench/merge_chain.py` merges the 23 FP32 units
into one ONNX model (`dit_chain.onnx`: 23 EPContext nodes sharing a
single spill-fill buffer via `max_size` = 100 MiB, I/O names rewritten
in the context-bin headers) without recompiling. The engine
(`cpp/pipeline.cpp`) creates ONE QNN session from
`<model_dir>/dit_chain.onnx` when present — same options as
`MakeSession` (burst, no spinning, intra-op 1, arena off) — runs each
row as a single `Run` fetching `noise_pred` only, and drops the onnx +
23 bins from the file cache after creation. Model dirs without
`dit_chain.onnx` keep the 23-session fallback. Measured: peak DMA-BUF
9.0 GB → **7.14 GB**, row pass 2.07 s → ~1.6 s, bit-identical output,
~6.8 s session create. w8a16 was rejected (only ~0.5 GB saved: runlist
133 MB + ~210 MB spill-fill per block, 15% slower) and FP16 pins the
same 245 MB weights per block — see `docs/ai_pipeline.md`.

Only one stage's sessions exist at a time: transformer (released after
sampling) → VAE, created after sampling since `vae_post` alone pins a
413 MB bin (post released after kv, query after extraction, both before
polygonize/decimate). Nothing stays resident between runs. Cancel lands
between steps (~1.6 s per merged row pass).

## Troubleshooting (measured on Xiaomi 15 Ultra, HyperOS)

- `QNN_DEVICE_ERROR_INVALID_CONFIG` at device create in the app (shell
  binaries unaffected): the app process must declare
  `<uses-native-library android:name="libcdsprpc.so"
  android:required="false"/>` (present in this module's manifest) —
  QNN HTP reaches the NPU through FastRPC.
- Preflight RAM uses `/proc/meminfo` MemAvailable with a 3 GB floor
  (`cpp/pipeline.cpp`): `sysinfo().freeram` (MemFree, ~200 MB on a
  16 GB Android phone) fails the check unconditionally.
- `glb_writer` prints accessor min/max with `%.17g`
  (`ml/triposg-mobile/cpp/glb_writer.cpp`): `%g` trips the Khronos
  validator (ACCESSOR_MIN/MAX_MISMATCH); `%.17g` validates 0 errors.
- Sideload lands in `/sdcard/Android/data/<package>/files/triposg/`
  with `chmod -R a+rX` (see `bench/sideload_models.sh`); `run-as`
  cannot see `/storage/emulated` (no app mount namespace), so verify
  external-dir access from the app itself (`getStatus` logs the root
  listing and size-check result under tag `TripoSG`).
- Opening Explore mid-conversion killed the app (`JavascriptException:
  GL is currently not available`, same process as the foreground
  service): the DiT pins ~9 GB of DMA-BUF, and expo-gl throws
  `ERR_GL_NOT_AVAILABLE` from its surface-create event handler when a
  card's GL context cannot be created — outside any error boundary, so
  fatal in release. Fixed app-side, not here: the guard in
  `explore-card/gl-availability.js` reports that exact error non-fatally
  (everything else still crashes loudly), failed viewers show their
  static fallback, cards render static thumbnails while a conversion
  runs (`useConversionRunning`, persisted-job backed), and at most 2
  cards hold a live-GL lease (`gl-view-lease.js`). If it ever recurs,
  check `adb logcat` for the `3D view unavailable (non-fatal)` warning
  line: present means the guard caught it (look at leases/pressure),
  absent means a different error went fatal.

## Host-side conversion without UI

`src/app/dev-triposg.jsx` is gone. With models sideloaded and a photo on
shared storage:

```sh
adb push <photo.png> /sdcard/Download/triposg-test.png
# once: open the app's photo picker so shared-storage reads are allowed
adb shell am broadcast -a expo.modules.triposg.DEBUG_CONVERT
# optional: -e image file:///sdcard/Download/other.png
adb logcat -s TripoSGDebug
```

Fixed knobs (50 steps, guidance 7.0, seed 42, d0 6 / d1 8, 100k display
tris); GLBs land in the app cache `triposg/debug/`. The receiver no-ops
unless the app is debuggable, so release builds are unaffected.
