# Phase 1 parity report

params: samples=20000 tau=0.01 grid=64; ids_match=True
thresholds: chamfer/diag<=0.01 F>=0.9 IoU>=0.95
note: mesh.display.glb has no hash in report.json (presence only).

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
| hjswed | final_latents.npy | tensor:final_latents | rel_l2=2.939e-01 cosine=0.9561776 (cosine=9.562e-01 violates min >=0.99; rel_l2=2.939e-01 violates max <=0.05) | FAIL |
| hjswed | mesh.glb | mesh | chamfer/diag=4.265e-03 F=0.978 IoU=0.9662 | PASS |
| iuvbww | final_latents.npy | tensor:final_latents | rel_l2=3.362e-01 cosine=0.9425631 (cosine=9.426e-01 violates min >=0.99; rel_l2=3.362e-01 violates max <=0.05) | FAIL |
| iuvbww | mesh.glb | mesh | chamfer/diag=6.078e-03 F=0.893 IoU=0.9596 (F=0.893 below 0.9) | FAIL |
| qwvfsd | final_latents.npy | tensor:final_latents | rel_l2=3.179e-01 cosine=0.9487016 (cosine=9.487e-01 violates min >=0.99; rel_l2=3.179e-01 violates max <=0.05) | FAIL |
| qwvfsd | mesh.glb | mesh | chamfer/diag=5.701e-03 F=0.910 IoU=0.9475 (IoU=0.9475 below 0.95) | FAIL |
| uegvsd | final_latents.npy | tensor:final_latents | rel_l2=3.288e-01 cosine=0.9450781 (cosine=9.451e-01 violates min >=0.99; rel_l2=3.288e-01 violates max <=0.05) | FAIL |
| uegvsd | mesh.glb | mesh | chamfer/diag=6.355e-03 F=0.848 IoU=0.8793 (F=0.848 below 0.9; IoU=0.8793 below 0.95) | FAIL |
| yuyyuw | final_latents.npy | tensor:final_latents | rel_l2=2.507e-01 cosine=0.9681712 (cosine=9.682e-01 violates min >=0.99; rel_l2=2.507e-01 violates max <=0.05) | FAIL |
| yuyyuw | mesh.glb | mesh | chamfer/diag=4.704e-03 F=0.978 IoU=0.9771 | PASS |

overall: FAIL
