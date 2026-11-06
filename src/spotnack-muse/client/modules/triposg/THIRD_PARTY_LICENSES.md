# Third-party licenses (TripoSG Expo module)

Everything the on-device pipeline ships or executes, with the terms
that govern redistribution. Model weights keep their upstream terms —
check before shipping; the app downloads them at runtime, it does not
bundle them.

| Component | Source / version | License | How it ships |
| --- | --- | --- | --- |
| ONNX Runtime (`onnxruntime-android-qnn:1.29.0`) | [Maven Central](https://central.sonatype.com/artifact/com.microsoft.onnxruntime/onnxruntime-android-qnn) / Microsoft | MIT | Gradle dependency; `libonnxruntime.so` in the APK |
| Qualcomm QNN runtime (`qnn-runtime:2.50.0`) | Maven Central / Qualcomm | Qualcomm proprietary (see the package's license file; redistributable under its terms for QNN-enabled apps — confirm for our listing) | Gradle dependency; `libQnnHtp*.so` in the APK |
| meshoptimizer (simplifier + vertex compactor) | [zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) at v0.24, vendored under `cpp/third_party/meshoptimizer/` | MIT (LICENSE.md kept in that dir) | Compiled into `libtriposg_jni.so` |
| rembg u2net weights + algorithm | [danielgatis/rembg](https://github.com/danielgatis/rembg) 2.0.86; u2net model by Xuebin Qin et al. | Apache-2.0 (code); u2net model free for research/commercial use per its release terms — confirm before shipping | Downloaded at runtime (`u2net.onnx`, sha-pinned in the manifest) |
| TripoSG weights + pipeline algorithm | [VAST-AI-Research/TripoSG](https://github.com/VAST-AI-Research/TripoSG) at fc5c4099 | MIT (code); weights retain upstream terms — check before shipping | Downloaded at runtime (never bundled) |
| DINOv2 encoder | [facebookresearch/dinov2](https://github.com/facebookresearch/dinov2) (vit-large distilled into the TripoSG checkpoint) | Apache-2.0 | Downloaded at runtime (`dinov2_encoder.onnx`) |
| Expo Modules API / React Native | Expo SDK 58 | MIT / MIT | App framework |

Full license texts: MIT and Apache-2.0 are standard; the vendored
meshoptimizer LICENSE.md is in-tree. The Qualcomm qnn-runtime license
rides with the Maven package — quote it in the Play listing review in
part B.
