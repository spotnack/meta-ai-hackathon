/*
Config plugin trimming the QNN runtime to the SM8750 target (Phase 3B)
plus an opt-in debuggable release flag (Phase 4).

The com.qualcomm.qti:qnn-runtime AAR ships backend libraries for every
Hexagon generation plus GPU/DSP fallbacks (~94 MB of .so the app never
loads: the AI Hub bins are HTP-only and QNN GPU finalization fails on
this SoC). This plugin appends a `packaging.jniLibs.excludes` block to the
app's build.gradle during prebuild, keeping only:
  libQnnHtp.so, libQnnHtpV79Skel.so, libQnnHtpV79Stub.so, libQnnSystem.so.
libQnnHtpPrepare.so is excluded too: all units are precompiled AI Hub
EPContext binaries, so nothing calls the prepare path — verified on device
2026-11-07 (a full conversion works without it; release APK 98 MB -> 63 MB).

TRIPOSG_DEBUGGABLE=1 in the prebuild environment additionally marks the
release build debuggable (needed for `run-as` inspection of job folders
and golden-noise parity runs). Off by default; never commit a build made
with it.

Idempotent: guarded by marker comments, so repeated prebuilds do not
duplicate the blocks. Listed in app.json plugins (local path).
*/

const {
  createRunOncePlugin,
  withAppBuildGradle,
} = require("expo/config-plugins");

const MARKER = "// triposg: keep HTP V79 + system libs only";

const EXCLUDED_JNILIBS = [
  // DSP backend (unused: HTP-only bins).
  "lib/arm64-v8a/libQnnDsp.so",
  "lib/arm64-v8a/libQnnDspV66Skel.so",
  "lib/arm64-v8a/libQnnDspV66Stub.so",
  // GPU backend (unused: QNN GPU finalization fails on SM8750).
  "lib/arm64-v8a/libQnnGpu.so",
  // Prepare path (unused: every unit is a precompiled AI Hub EPContext
  // binary; verified on device 2026-11-07, release APK 98 MB -> 63 MB).
  "lib/arm64-v8a/libQnnHtpPrepare.so",
  // Hexagon generations other than V79 (SM8750).
  "lib/arm64-v8a/libQnnHtpV68Skel.so",
  "lib/arm64-v8a/libQnnHtpV68Stub.so",
  "lib/arm64-v8a/libQnnHtpV69Skel.so",
  "lib/arm64-v8a/libQnnHtpV69Stub.so",
  "lib/arm64-v8a/libQnnHtpV73Skel.so",
  "lib/arm64-v8a/libQnnHtpV73Stub.so",
  "lib/arm64-v8a/libQnnHtpV75Skel.so",
  "lib/arm64-v8a/libQnnHtpV75Stub.so",
  "lib/arm64-v8a/libQnnHtpV81Skel.so",
  "lib/arm64-v8a/libQnnHtpV81Stub.so",
];

const withTripoSGPackaging = (config) =>
  withAppBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(MARKER)) return config;
    const excludes = EXCLUDED_JNILIBS.map((lib) => `            "${lib}",`).join(
      "\n",
    );
    config.modResults.contents += `
android {
    ${MARKER}
    packaging {
        jniLibs {
            excludes += [
${excludes}
            ]
        }
    }
}
`;
    return config;
  });

const DEBUGGABLE_MARKER = "// triposg: debuggable release (TRIPOSG_DEBUGGABLE=1)";

// Opt-in debuggable release for on-device inspection (`run-as` into job
// folders, golden-noise parity via the debug receiver). Only when
// TRIPOSG_DEBUGGABLE=1 is set in the prebuild environment; default builds
// are untouched. Appended as a second android block: Gradle merges repeat
// android blocks, and the marker keeps prebuilds idempotent.
const withTripoSGDebuggable = (config) =>
  withAppBuildGradle(config, (config) => {
    if (process.env.TRIPOSG_DEBUGGABLE !== "1") return config;
    if (config.modResults.contents.includes(DEBUGGABLE_MARKER)) return config;
    config.modResults.contents += `
android {
    ${DEBUGGABLE_MARKER}
    buildTypes {
        release {
            debuggable true
        }
    }
}
`;
    return config;
  });

module.exports = createRunOncePlugin(
  (config) => withTripoSGDebuggable(withTripoSGPackaging(config)),
  "triposg-packaging",
  "1.0.0",
);
