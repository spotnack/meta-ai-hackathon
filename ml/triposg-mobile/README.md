# triposg-mobile tooling

Dedicated home for TripoSG conversion, parity, and benchmark tooling. Kept at
the repo root (not under `client/`) so Metro never watches weights or logs.

- `audit/` — Phase 0 claim notes and source log (this checkpoint).
- `eval/` — fixed image set + manifest (Phase 1).
- `reference/` — golden tensors/meshes; large artifacts git-ignored, only
  manifest + hashes committed (Phase 1).
- `parity/` — parity harness + thresholds, set before optimizing (Phase 1).
- `conversion/` — per-runtime conversion scripts (Phase 2).
- `bench/` + `logs/` — on-device benchmark scripts and raw logs (Phase 2).

Rules: no file over 10 MB in git; weights, tensors, and large logs stay
git-ignored. One-command setup/run instructions land here in Phase 1.
Conversion deps get pinned in `src/spotnack-muse/environment.yml` or a
documented dedicated env file.
