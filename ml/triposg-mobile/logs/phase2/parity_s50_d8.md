# Phase 1 parity report

params: samples=20000 tau=0.01 grid=64; ids_match=True
thresholds: chamfer/diag<=0.01 F>=0.9 IoU>=0.95
note: mesh.display.glb has no hash in report.json (presence only).
note: final_latents is report-only (diagnostic): shown as 'report', excluded from OVERALL; the mesh is the acceptance gate.

| id | sha | (a) chamfer/diag | (a) F@1% | (a) IoU | (a) gate | (b) chamfer/diag | (b) F@1% | (b) gate | gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hjswed | 10/10 | 3.508e-03 | 0.998 | 0.9984 | PASS | 3.497e-03 | 0.998 | PASS | PASS |
| iuvbww | 10/10 | 3.929e-03 | 0.993 | 0.9996 | PASS | 3.958e-03 | 0.993 | PASS | PASS |
| qwvfsd | 10/10 | 4.597e-03 | 0.972 | 0.9993 | PASS | 4.609e-03 | 0.974 | PASS | PASS |
| uegvsd | 10/10 | 3.706e-03 | 0.998 | 0.9993 | PASS | 3.716e-03 | 0.997 | PASS | PASS |
| yuyyuw | 10/10 | 4.092e-03 | 0.991 | 0.9986 | PASS | 4.098e-03 | 0.992 | PASS | PASS |

## Candidates

| id | file | check | detail | gate |
| --- | --- | --- | --- | --- |
| hjswed | final_latents.npy | tensor:final_latents | rel_l2=3.307e-01 cosine=0.9452459 (cosine=9.452e-01 violates min >=0.99; rel_l2=3.307e-01 violates max <=0.05) | report |
| hjswed | mesh.glb | mesh | chamfer/diag=4.723e-03 F=0.965 IoU=0.9556 | PASS |
| iuvbww | final_latents.npy | tensor:final_latents | rel_l2=2.487e-01 cosine=0.9690442 (cosine=9.690e-01 violates min >=0.99; rel_l2=2.487e-01 violates max <=0.05) | report |
| iuvbww | mesh.glb | mesh | chamfer/diag=4.427e-03 F=0.979 IoU=0.9849 | PASS |
| qwvfsd | final_latents.npy | tensor:final_latents | rel_l2=2.259e-01 cosine=0.9744532 (cosine=9.745e-01 violates min >=0.99; rel_l2=2.259e-01 violates max <=0.05) | report |
| qwvfsd | mesh.glb | mesh | chamfer/diag=5.283e-03 F=0.933 IoU=0.9699 | PASS |
| uegvsd | final_latents.npy | tensor:final_latents | rel_l2=1.808e-01 cosine=0.9836347 (cosine=9.836e-01 violates min >=0.99; rel_l2=1.808e-01 violates max <=0.05) | report |
| uegvsd | mesh.glb | mesh | chamfer/diag=4.089e-03 F=0.988 IoU=0.9825 | PASS |
| yuyyuw | final_latents.npy | tensor:final_latents | rel_l2=1.973e-01 cosine=0.9805117 (cosine=9.805e-01 violates min >=0.99; rel_l2=1.973e-01 violates max <=0.05) | report |
| yuyyuw | mesh.glb | mesh | chamfer/diag=4.449e-03 F=0.982 IoU=0.9835 | PASS |

overall: PASS
