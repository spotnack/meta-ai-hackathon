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
| hjswed | mesh.display.glb | mesh | chamfer/diag=4.009e-03 F=0.987 IoU=0.9737 | PASS |
| hjswed | mesh.glb | mesh | chamfer/diag=4.027e-03 F=0.987 IoU=0.9741 | PASS |
| iuvbww | mesh.display.glb | mesh | chamfer/diag=5.520e-03 F=0.917 IoU=0.9677 | PASS |
| iuvbww | mesh.glb | mesh | chamfer/diag=5.533e-03 F=0.917 IoU=0.9675 | PASS |
| qwvfsd | mesh.display.glb | mesh | chamfer/diag=5.523e-03 F=0.922 IoU=0.9582 | PASS |
| qwvfsd | mesh.glb | mesh | chamfer/diag=5.486e-03 F=0.923 IoU=0.9583 | PASS |
| uegvsd | mesh.display.glb | mesh | chamfer/diag=4.611e-03 F=0.963 IoU=0.9720 | PASS |
| uegvsd | mesh.glb | mesh | chamfer/diag=4.588e-03 F=0.965 IoU=0.9722 | PASS |
| yuyyuw | mesh.display.glb | mesh | chamfer/diag=5.238e-03 F=0.928 IoU=0.9615 | PASS |
| yuyyuw | mesh.glb | mesh | chamfer/diag=5.234e-03 F=0.929 IoU=0.9617 | PASS |

overall: PASS
