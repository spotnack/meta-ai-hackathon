// Octree SDF extraction in the style of TripoSG's flash extraction
// (triposg/inference_utils.py flash_extract_geometry at fc5c4099).
//
// Method: dense coarse grid, then per level keep only cells near the zero
// level set (6-neighbour sign change, plus an |sdf| band, both dilated)
// and re-query them at double resolution. Queries go through a
// QueryBackend so QNN, CPU or test stubs are pluggable; every query point
// is independent, so chunking never changes values.
//
// Portable C++17, no third-party dependencies. Phase 3 reuses this
// unchanged inside the Expo module.
#pragma once

#include <cstdint>
#include <vector>

namespace triposg {

// SDF query backend: fills out[i] for xyz[i] (SDF, positive outside /
// negative inside, matching the VAE decoder output convention).
// Extract always calls with exactly chunk_points points (the last call of
// a level is padded by repeating its last point; the padding values are
// discarded), so fixed-shape backends can assert the count.
class QueryBackend {
 public:
  virtual ~QueryBackend() = default;
  virtual void Query(const float* xyz, int n, float* out) = 0;
};

struct ExtractConfig {
  float bound = 1.005f;    // half-extent; bounds are [-bound, +bound]^3
  int d1 = 9;              // final octree depth (drives the schedule)
  int d0 = 6;              // coarse depth: leading levels below this drop
  int chunk_points = 8192;  // points per backend Query call (exact)
  float band = 0.95f;      // |sdf| band kept for refinement (golden value)
};

// Flash-style level schedule (cell counts per side), mirroring
// flash_extract_geometry's integer math: start R=2^d1, collect while
// R>=63, then level[0] = round(R0/4)*4-1 and level[k] = level[0]*2^k.
// Leading levels below the d0 equivalent are dropped (at least the last
// level is kept). d0=6, d1=9 reproduces the golden schedule 63,126,252,
// 504. Level 0 is always dense-queried, so any (d0,d1) is self-consistent.
std::vector<int> FlashLevels(int d0, int d1);

// Runs the full extraction. On success returns true with out_grid holding
// the final dense (R+1)^3 SDF grid in x-major order
// (idx = (i*(R+1)+j)*(R+1)+k) and out_res = R. Cells never queried hold
// quiet NaN; the marching-cubes caller skips NaN-touching cells, exactly
// like DiffDMC ignores the original -10000 sentinel region.
bool ExtractSdf(QueryBackend* backend, const ExtractConfig& cfg,
                std::vector<float>& out_grid, int& out_res);

}  // namespace triposg
