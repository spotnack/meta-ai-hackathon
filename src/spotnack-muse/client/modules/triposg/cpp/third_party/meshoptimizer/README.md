# Vendored meshoptimizer (MIT) — fetch required before building

`decimate.cpp` needs these 5 files from
[zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) at the pinned
version **v0.24**, placed in this directory:

- `meshoptimizer.h`
- `simplifier.cpp`
- `indexgenerator.cpp`
- `indexgenerator.h`
- `LICENSE.md` (keep it: MIT attribution)

Fetch (you run this):

```sh
cd src/spotnack-muse/client/modules/triposg/cpp/third_party/meshoptimizer
V=v0.24
for f in meshoptimizer.h simplifier.cpp indexgenerator.cpp indexgenerator.h; do
  curl -sSL -o "$f" "https://raw.githubusercontent.com/zeux/meshoptimizer/$V/src/$f"
done
curl -sSL -o LICENSE.md "https://raw.githubusercontent.com/zeux/meshoptimizer/$V/LICENSE.md"
ls -la
```

Only the simplifier + vertex compactor are compiled in (no codecs, no
quantization); the sources are ~1 MB total. If upstream moves files
between versions, keep the same 5-file set at whatever tag still builds
and update the pinned version here and in THIRD_PARTY_LICENSES.md.
