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
| hjswed | mesh.glb | mesh | chamfer/diag=3.488e-03 F=0.999 IoU=0.9985 | PASS |

overall: PASS
