// Isosurface meshing for the sparse SDF grid (see mcubes.cpp).
//
// Portable C++17, no third-party dependencies. Phase 3 reuses this
// unchanged inside the Expo module.
#pragma once

#include <cstdint>
#include <vector>

namespace triposg {

struct McubesResult {
  std::vector<float> positions;    // 3 * verts, world coords
  std::vector<float> normals;      // 3 * verts, area-weighted, unit length
  std::vector<uint32_t> indices;   // 3 * tris
  bool closed = false;             // every edge used by exactly 2 triangles
  double signed_volume = 0.0;      // > 0 for outward-facing closed meshes
};

struct McubesConfig {
  float iso = 0.0f;      // matches the golden DiffDMC call (level 0)
  float spacing = 1.0f;  // world units per grid index: bbox_size / 2^d1
  float ox = 0.0f;       // world origin (bbox_min), likewise oy/oz
  float oy = 0.0f;
  float oz = 0.0f;
};

// Polygonize the dense (R+1)^3 x-major SDF grid (idx=(i*N+j)*N+k).
//
// Method: marching tetrahedra with the uniform 6-fold decomposition of
// every cube. This is a deliberate choice over classic marching cubes:
// the 256-case triangle table is ~2000 hand-transcribed integers with no
// local way to verify each entry, while the tetrahedral decomposition is
// crack-free by construction (every cube split identically, so shared
// faces always agree) and needs no tables at all. Surface vertices sit at
// the same linearly-interpolated zero-crossings as marching cubes on all
// 12 cube edges; triangulation differs only on face/body diagonals, which
// the parity thresholds (Chamfer, F-score, IoU) absorb.
//
// Cubes touching a non-finite corner are skipped (the NaN band fringe),
// degenerate triangles are dropped, and output winding is forced outward
// by signed volume, so normals match the golden convention.
McubesResult Polygonize(const float* grid, int res, const McubesConfig& cfg);

}  // namespace triposg
