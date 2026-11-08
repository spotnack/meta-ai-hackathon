// Display-mesh decimation for Explore cards: simplify the ~1M-triangle
// extraction output to a target triangle count (default 100k) with
// meshoptimizer (MIT, vendored under cpp/third_party/meshoptimizer),
// then recompute area-weighted smooth normals. The decimated mesh goes
// through the same glTF writer as the full mesh, so orientation (+Y up,
// meters) and material are identical; only the triangle count differs.
#pragma once

#include <cstdint>
#include <vector>

namespace triposg {

struct DecimatedMesh {
  std::vector<float> positions;    // 3 * verts
  std::vector<float> normals;      // 3 * verts, unit length
  std::vector<uint32_t> indices;   // 3 * tris, tris <= target_tris
};

// Simplifies (positions, indices) to at most target_tris triangles.
// Returns false only on empty input.
bool DecimateMesh(const float* positions, size_t vert_count,
                  const uint32_t* indices, size_t tri_count,
                  size_t target_tris, DecimatedMesh& out);

}  // namespace triposg
