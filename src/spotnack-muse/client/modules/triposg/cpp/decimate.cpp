// See decimate.h.
#include "decimate.h"

#include <cmath>
#include <cstring>

#include "meshoptimizer.h"

namespace triposg {

bool DecimateMesh(const float* positions, size_t vert_count,
                  const uint32_t* indices, size_t tri_count,
                  size_t target_tris, DecimatedMesh& out) {
  if (vert_count == 0 || tri_count == 0) return false;
  const size_t index_count = tri_count * 3;
  std::vector<uint32_t> simplified(index_count);
  float error = 0.0f;
  // Target 3x the triangle budget in indices; 1e-2 error cap in world
  // units (the mesh spans ~2 units, so ~0.5% of the extent).
  size_t out_count = meshopt_simplify(
      simplified.data(), indices, index_count, positions, vert_count,
      sizeof(float) * 3, target_tris * 3, 1e-2f, 0, &error);
  simplified.resize(out_count);
  // Compact: remap to the vertices the simplified index buffer uses.
  std::vector<uint32_t> remap(vert_count, UINT32_MAX);
  std::vector<float> verts;
  verts.reserve(vert_count * 3);
  uint32_t next = 0;
  for (size_t i = 0; i < out_count; ++i) {
    uint32_t v = simplified[i];
    if (remap[v] == UINT32_MAX) {
      remap[v] = next++;
      verts.push_back(positions[v * 3 + 0]);
      verts.push_back(positions[v * 3 + 1]);
      verts.push_back(positions[v * 3 + 2]);
    }
    simplified[i] = remap[v];
  }
  // Area-weighted smooth normals.
  std::vector<float> normals(verts.size(), 0.0f);
  for (size_t t = 0; t < out_count; t += 3) {
    const uint32_t a = simplified[t], b = simplified[t + 1],
                   c = simplified[t + 2];
    const float* pa = &verts[a * 3];
    const float* pb = &verts[b * 3];
    const float* pc = &verts[c * 3];
    const float ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
    const float vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
    float nx = uy * vz - uz * vy, ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx;
    normals[a * 3 + 0] += nx;
    normals[a * 3 + 1] += ny;
    normals[a * 3 + 2] += nz;
    normals[b * 3 + 0] += nx;
    normals[b * 3 + 1] += ny;
    normals[b * 3 + 2] += nz;
    normals[c * 3 + 0] += nx;
    normals[c * 3 + 1] += ny;
    normals[c * 3 + 2] += nz;
  }
  for (size_t i = 0; i < normals.size(); i += 3) {
    float l = std::sqrt(normals[i] * normals[i] + normals[i + 1] * normals[i + 1] +
                        normals[i + 2] * normals[i + 2]);
    if (l > 0) {
      normals[i] /= l;
      normals[i + 1] /= l;
      normals[i + 2] /= l;
    } else {
      normals[i + 1] = 1.0f;  // degenerate: fall back to +Y
    }
  }
  out.positions = std::move(verts);
  out.normals = std::move(normals);
  out.indices = std::move(simplified);
  return true;
}

}  // namespace triposg
