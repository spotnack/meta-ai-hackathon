/*
Config plugin trimming the QNN runtime to the SM8750 target (Phase 3B).

The com.qualcomm.qti:qnn-runtime AAR ships backend libraries for every
Hexagon generation plus GPU/DSP fallbacks (~94 MB of .so the app never
loads: the AI Hub bins are HTP-only and QNN GPU finalization fails on
this SoC). This plugin appends a `packaging.jniLibs.excludes` block to the
app's build.gradle during prebuild, keeping only:
  libQnnHtp.so, libQnnHtpPrepare.so (kept: EPContext loading may need it),
  libQnnHtpV79Skel.so, libQnnHtpV79Stub.so, libQnnSystem.so.

Idempotent: guarded by a marker comment, so repeated prebuilds do not
duplicate the block. Listed in app.json plugins (local path).
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

module.exports = createRunOncePlugin(
  withTripoSGPackaging,
  "triposg-packaging",
  "1.0.0",
);
