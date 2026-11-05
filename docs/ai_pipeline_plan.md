# AI Pipeline Plan — On-Device TripoSG Image-to-3D

## Goal

Replace the simulated image-to-3D adapter with real on-device TripoSG inference (`ai_pipeline_prompt.md`), keeping the existing Home → Convert → Explore → Stage-3D flow, offline-after-download behavior, and hexagonal port contract intact.

## Non-goals for this plan

- No cloud inference, no model swap/distillation/retraining without written evidence + maintainer approval.
- No changes to auth, storage layout, viewer UX, or server API beyond what the pipeline needs.
- This planning turn creates/edits only this file; no code, installs, or model downloads.

## Phase 0 — Audit and feasibility (checkpoint)

What: read the TripoSG repo, configs, and weights from source; confirm/correct every claim in `ai_pipeline_prompt.md` §4 (1.5B params, 2048 latent tokens, DINOv2-class encoder, background-removal model, VAE → SDF/occupancy → mesh, sampling steps/guidance/CFG batch, 8 GB VRAM note); licenses + redistribution; memory/storage budget vs. real per-app caps on the target tier; proposed minimum tier + named physical test devices; go/no-go with required optimizations.

Files you will create or change:

- Create: audit content inside `docs/ai_pipeline.md` (§Audit only).
- Create: `ml/triposg-mobile/README.md` (tooling folder stub + ignore rules so weights/logs stay out of git and out of Metro's watch tree).
- Create: `ml/triposg-mobile/audit/` notes/scripts/logs backing each measured/documented/unverified claim.
- Change: this plan file (`docs/ai_pipeline_plan.md`) only to record the go/no-go outcome if it changes sequencing.
- Change (tiny, if needed): `docs/architecture.md` file tree for the new `ml/triposg-mobile/` folder.

Validation: every 1.5B/2048/encoder/background-removal/VAE/steps/VRAM claim traces to a TripoSG file+line, paper section, or committed script+log; license table complete; `black --check`, `flake8` pass on any Python added.

Checkpoint: commit audit, then stop and wait for maintainer review before Phase 1 (per prompt §4).

## Phase 1 — Desktop reference and golden data

What: run official TripoSG PyTorch FP32 on a fixed 5-image license-compatible eval set (fixed seeds; reduced from 20 on 2026-11-06 — the eval set size only bounds parity confidence, it does not change on-device model speed or output quality); save golden tensors at each component boundary + final meshes; write the parity harness (max abs/relative error per component; Chamfer, F-score@stated-threshold, volume IoU vs. reference mesh; rendered views); set and justify acceptance thresholds before optimizing.

Files you will create or change:

- Create: `ml/triposg-mobile/eval/` image set + manifest (sources, licenses, seeds).
- Create: `ml/triposg-mobile/reference/` run script + golden tensors/meshes (git-ignored large artifacts; only manifest + hashes committed).
- Create: `ml/triposg-mobile/parity/` harness + thresholds doc.
- Create: `ml/triposg-mobile/logs/phase1/` raw logs.
- Change: `ml/triposg-mobile/README.md` (one-command setup/run).
- Change: `src/spotnack-muse/environment.yml` (pin any new conversion deps) or a documented dedicated env file.
- Change: `docs/ai_pipeline.md` (reference + parity method).

Validation: one documented command reproduces reference + parity; thresholds fixed before any optimization; `black`, `flake8` pass.

## Phase 2 — Runtime evaluation (checkpoint)

What: evaluate LiteRT (`litert-torch`), ONNX Runtime Mobile (+ Core ML EP on iOS / vendor EPs on Android), Core ML (`coremltools`) + Android counterpart, custom C++ kernels (attention@2048, SDF queries, mesh extraction), and ExecuTorch on equal terms against actual TripoSG components. Fill the per-component matrix (background removal, image encoder, one transformer step, VAE/SDF decode, mesh extraction × runtime: converts? runs? parity error, latency, peak RAM) and the summary table (conversion, transformer/full-pipeline support, CPU/GPU/NPU, FP16/INT8/INT4-weight-only, parity, end-to-end latency, load time, peak RAM, storage, binary size, iOS/Android integration, complexity, license). Report knob trade-offs (steps, guidance on/off, per-component precision, extraction resolution/hierarchical, decimation target). Recommend one hybrid configuration.

Files you will create or change:

- Create: `ml/triposg-mobile/conversion/` per-runtime conversion scripts.
- Create: `ml/triposg-mobile/bench/` on-device benchmark scripts + `ml/triposg-mobile/logs/phase2/` raw logs (device, OS, SoC, RAM, runtime version, precision, steps, commit hash; 2 warm-ups + ≥5 runs, median+p90, thermal state, `phys_footprint`/`VmHWM`/`dumpsys meminfo`).
- Create: `ml/triposg-mobile/eval/matrix.md` + `summary.md` (measured / documented(link) / not-supported(evidence) / not-evaluated(reason); no estimates as measurements).
- Change: `docs/ai_pipeline.md` (decision + evidence).
- Change: `docs/architecture.md` file tree for new tooling files.

Validation: release builds on the named physical devices (simulators/emulators functional-only, never perf); tables fully filled with committed scripts+logs.

Checkpoint: commit evaluation + recommended config, then stop and wait for review before Phase 3 (per prompt §6).

## Phase 3 — Native implementation

What: shared C++ core (orchestration, rectified-flow loop + guidance, pre/post, mesh extraction, GLB writer, backend interface); local Expo module (Swift/Kotlin via Expo Modules API: `convert→jobId`, `cancel`, progress events, model-management calls; background threads; cooperative cancel between steps + inside decode loops); memory safety (preflight check, sequential load/unload, mmap where supported, background cancel-or-pause, no half-written files); new JS adapter + new model-management port/adapter; minimal Home-card download/delete UI.

Files you will create or change:

- Create: `src/spotnack-muse/client/modules/triposg/` local Expo module (native code, CMake/podspec, config plugin; never `ios/`/`android/` — CNG generates those).
- Create: `src/spotnack-muse/client/modules/triposg/cpp/` shared core + backend shims.
- Create: `src/spotnack-muse/client/src/features/image-to-3d/infrastructure/triposg-image-to-3d.adapter.js` (wraps module; `signal→cancel`; `file://` GLB under `Paths.cache`; `generator=triposg@<checkpoint>+<runtime>-<precision>`; EXIF orientation; HEIC/JPEG/PNG).
- Create: `src/spotnack-muse/client/src/features/image-to-3d/domain/model-management.port.js` + `infrastructure/model-management.adapter.js` (manifest, resumable checksum-verified download, free-space + cellular warning, restart-resume, upgrade/corrupt/delete).
- Change: `src/spotnack-muse/client/src/features/image-to-3d/presentation/components/image-to-3d-card/` (download progress/delete UI in existing style).
- Change: `src/spotnack-muse/client/app.json` (module plugin), `src/spotnack-muse/client/package.json` (scripts/deps via `npx expo install`), `src/spotnack-muse/client/src/config/api.js` (new `EXPO_PUBLIC_*` weight base URL following existing pattern).
- Change: `docs/ai_pipeline.md` (arch + model management), `docs/architecture.md` (every new file), `ml/triposg-mobile/README.md` (native build steps).

Validation: `yarn lint`, `npx tsc --noEmit` (from `client/`), `black --check .`, `flake8 .`; every GLB passes Khronos glTF Validator (standard glTF, +Y up, meters, valid normals, indexed triangles, sensible default material; no Draco/meshopt unless decoders bundled); cancel verified per-stage bound; no temp files or native leaks.

## Phase 4 — Integration and polish

What: swap adapter in the hook (keep placeholder for model-less dev + documented switch); real stage labels weighted by measured durations; local-`file://` GLB loading verified on both platforms (fix via `expo-file-system` bytes + `GLTFLoader.parse` if `useGLTF(uri)` fails); full flow test (§8 steps 1–6) incl. per-user isolation; triangle-budget default from measured multi-card frame times; README diagram fix.

Files you will create or change:

- Change: `src/spotnack-muse/client/src/features/image-to-3d/application/use-image-to-3d-conversion.hook.js` (one-line swap; placeholder stays).
- Change: `src/spotnack-muse/client/src/features/explore/presentation/components/explore-card/glb-model-viewer.component.jsx` only if local-file loading fix is needed.
- Change: `README.md` (add missing `assets/ai_pipeline.png` or fix the link) + `assets/` diagram.
- Change: `docs/ai_pipeline.md` (final config, benchmarks + methodology, limitations, licenses), `docs/architecture.md` (final tree).
- No other product files.

Validation (definition of done, `ai_pipeline_prompt.md` §10): airplane-mode conversion on the named iPhone + Android produces valid on-device TripoSG GLBs; outputs pass Phase 1 parity; Stop lands ≤1 sampling step (or documented per-stage bound) with no leftovers; below-tier devices get a clear preflight message with zero OOM kills; CI green or each failure explained; matrix + summary fully filled with scripts+logs committed.

## Open questions / decisions I need from you

1. Test devices: which physical iPhone + Android phone (model, OS, SoC, RAM) are available for Phases 2–4? (Simulators/emulators can't supply perf numbers.)
2. Minimum supported tier + minimum iOS/Android versions, and may I add iOS entitlements (e.g. increased memory limit) if the budget requires it?
3. Weight hosting: where do converted weights live (URL + `EXPO_PUBLIC_*` base), who approves/pays, and may weights be redistributed from our host (license check in Phase 0)?
4. Background behavior: when the app backgrounds mid-conversion — cancel or pause/resume?
5. iOS weight storage: Documents (excluded from iCloud backup, natively) vs. Caches (OS-purgeable) — which do you prefer?
6. Latency/quality knobs: target end-to-end latency and triangle budget for multi-card Explore, or should I propose both from measurements in Phase 2?
7. Placeholder switching: keep the dev switch as an env flag, and keep Jest's currently-failing (no tests) step as-is until real tests land?
8. Commit hygiene: confirm the 10 MB commit cap holds for all phases (manifests + hashes in git; weights/tensors/logs-large git-ignored) and who reviews the Phase 0 and Phase 2 checkpoints?
