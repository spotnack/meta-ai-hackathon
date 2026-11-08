# Third-party licenses (TripoSG Expo module)

Everything the on-device pipeline ships or executes, with the terms
that govern redistribution. Model files are never bundled in the APK: the
app downloads them from Hugging Face (`spotnack/triposg-sm8750-qnn`, with
LICENSE, LICENSE-u2net and NOTICE alongside) or they are sideloaded, and
the app reads them from its external files dir.

| Component | Source / version | License | How it ships |
| --- | --- | --- | --- |
| ONNX Runtime (`onnxruntime-android-qnn:1.29.0`) | [Maven Central](https://central.sonatype.com/artifact/com.microsoft.onnxruntime/onnxruntime-android-qnn) / Microsoft | MIT (verified in the cached POM) | Gradle dependency; `libonnxruntime.so` + `libonnxruntime4j_jni.so` in the APK |
| Qualcomm QNN runtime (`qnn-runtime:2.50.0`) | Maven Central / Qualcomm | QTI AI Stack License (`LICENSE.pdf` inside the AAR; POM names it "Qualcomm AI Hub Model License"): object-code distribution only as incorporated in our app, no reverse engineering, keep proprietary notices, no high-risk uses | Gradle dependency; `libQnnHtp[.so,_HtpPrepare,_V79Skel,_V79Stub]` + `libQnnSystem.so` in the APK (other backends excluded by `app.plugin.js`) |
| meshoptimizer (simplifier + vertex compactor) | [zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) at v0.24, vendored under `cpp/third_party/meshoptimizer/` | MIT (LICENSE.md kept in that dir) | Compiled into `libtriposg_jni.so` |
| rembg u2net weights + algorithm | [danielgatis/rembg](https://github.com/danielgatis/rembg) 2.0.86 (MIT); u2net model by Xuebin Qin et al. | Apache-2.0 (verified in the upstream U-2-Net `LICENSE`) | Downloaded or sideloaded (`u2net.onnx`, sha-pinned in the manifest) |
| TripoSG weights + pipeline algorithm | [VAST-AI-Research/TripoSG](https://github.com/VAST-AI-Research/TripoSG) at fc5c4099; weights from `VAST-AI/TripoSG` | MIT (code `LICENSE`; weights `license: mit` on the model card). AI Hub compiled bins inherit it per Qualcomm's AI Hub FAQ | Downloaded from Hugging Face or sideloaded (never bundled) |
| DINOv2 encoder | [facebookresearch/dinov2](https://github.com/facebookresearch/dinov2) (architecture; weights arrived inside the TripoSG release) | Apache-2.0 for the architecture (verified upstream); the shipped weights file is covered by the TripoSG MIT release — no Meta code or weights run in the app | Downloaded or sideloaded (`dinov2_encoder.onnx`) |
| Expo Modules API / React Native | Expo SDK 58 | MIT / MIT | App framework |

Full license texts: MIT and Apache-2.0 are standard; the vendored
meshoptimizer LICENSE.md is in-tree. The Qualcomm qnn-runtime license
rides with the Maven package — quote it in the Play listing review in
part B. OSS attributions bundled in the AAR's `NOTICE.txt` are
preserved here by reference.
