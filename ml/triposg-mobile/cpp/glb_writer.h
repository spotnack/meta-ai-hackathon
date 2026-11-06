// Minimal glTF 2.0 binary writer (see glb_writer.cpp).
//
// Portable C++17, no third-party dependencies. Phase 3 reuses this
// unchanged inside the Expo module.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace triposg {

struct GlbMesh {
  std::vector<float> positions;    // 3 * verts
  std::vector<float> normals;      // 3 * verts
  std::vector<uint32_t> indices;   // 3 * tris
};

// Writes a valid .glb: positions + normals + uint32 indices, one mesh,
// one node/scene, one default PBR material. Returns false on I/O error.
// No axis transform is applied: the extractor already emits TripoSG
// coordinates (+Y up, meters, bounds around +/-1), which is exactly what
// the golden trimesh export path writes, so meshes line up with mesh.glb.
bool WriteGlb(const GlbMesh& mesh, const std::string& path);

}  // namespace triposg
