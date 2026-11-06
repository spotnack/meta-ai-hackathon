// See glb_writer.h. Binary layout: 12-byte header, JSON chunk (padded
// with spaces to 4 bytes), BIN chunk with positions, normals, indices.
#include "glb_writer.h"

#include <cstdio>
#include <string>
#include <vector>

namespace triposg {

// Both targets (x64 laptop, arm64 phone) are little-endian, which GLB
// requires; fail loudly anywhere else.
static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__, "GLB needs LE");

bool WriteGlb(const GlbMesh& mesh, const std::string& path) {
  const size_t nv = mesh.positions.size() / 3;
  const size_t ni = mesh.indices.size();
  if (mesh.positions.size() != 3 * nv || mesh.normals.size() != 3 * nv ||
      ni % 3 != 0 || nv == 0 || ni == 0 || nv > 0xFFFFFFFFu) {
    return false;
  }
  float mn[3] = {mesh.positions[0], mesh.positions[1], mesh.positions[2]};
  float mx[3] = {mn[0], mn[1], mn[2]};
  for (size_t v = 0; v < nv; ++v)
    for (int a = 0; a < 3; ++a) {
      float x = mesh.positions[3 * v + a];
      if (x < mn[a]) mn[a] = x;
      if (x > mx[a]) mx[a] = x;
    }

  const size_t pos_bytes = 12 * nv, nrm_bytes = 12 * nv, idx_bytes = 4 * ni;
  char json[2048];
  int json_len = std::snprintf(
      json, sizeof(json),
      "{\"asset\":{\"version\":\"2.0\",\"generator\":\"triposg-mobile\"},"
      "\"scene\":0,\"scenes\":[{\"nodes\":[0]}],\"nodes\":[{\"mesh\":0}],"
      "\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0,"
      "\"NORMAL\":1},\"indices\":2,\"material\":0}]}],"
      "\"materials\":[{\"name\":\"triposg\",\"pbrMetallicRoughness\":{}}],"
      "\"accessors\":["
      "{\"bufferView\":0,\"componentType\":5126,\"count\":%zu,"
      "\"type\":\"VEC3\",\"min\":[%g,%g,%g],\"max\":[%g,%g,%g]},"
      "{\"bufferView\":1,\"componentType\":5126,\"count\":%zu,"
      "\"type\":\"VEC3\"},"
      "{\"bufferView\":2,\"componentType\":5125,\"count\":%zu,"
      "\"type\":\"SCALAR\"}],"
      "\"bufferViews\":["
      "{\"buffer\":0,\"byteOffset\":0,\"byteLength\":%zu,\"target\":34962},"
      "{\"buffer\":0,\"byteOffset\":%zu,\"byteLength\":%zu,\"target\":34962},"
      "{\"buffer\":0,\"byteOffset\":%zu,\"byteLength\":%zu,"
      "\"target\":34963}],"
      "\"buffers\":[{\"byteLength\":%zu}]}",
      nv, mn[0], mn[1], mn[2], mx[0], mx[1], mx[2], nv, ni, pos_bytes,
      pos_bytes, nrm_bytes, pos_bytes + nrm_bytes, idx_bytes,
      pos_bytes + nrm_bytes + idx_bytes);
  if (json_len <= 0 || static_cast<size_t>(json_len) >= sizeof(json)) {
    return false;
  }
  size_t json_pad = (4 - (json_len % 4)) % 4;
  uint32_t bin_len =
      static_cast<uint32_t>(pos_bytes + nrm_bytes + idx_bytes);
  uint32_t total =
      12 + 8 + static_cast<uint32_t>(json_len + json_pad) + 8 + bin_len;

  FILE* f = std::fopen(path.c_str(), "wb");
  if (f == nullptr) return false;
  auto put32 = [&](uint32_t v) {
    return std::fwrite(&v, 4, 1, f) == 1;
  };
  bool ok = put32(0x46546C67) && put32(2) && put32(total) &&
            put32(static_cast<uint32_t>(json_len + json_pad)) &&
            put32(0x4E4F534A) &&
            (std::fwrite(json, 1, json_len, f) == (size_t)json_len);
  for (size_t p = 0; ok && p < json_pad; ++p) ok = std::fputc(0x20, f) == 0x20;
  ok = ok && put32(bin_len) && put32(0x004E4942) &&
       (std::fwrite(mesh.positions.data(), 4, 3 * nv, f) == 3 * nv) &&
       (std::fwrite(mesh.normals.data(), 4, 3 * nv, f) == 3 * nv) &&
       (std::fwrite(mesh.indices.data(), 4, ni, f) == ni);
  std::fclose(f);
  return ok;
}

}  // namespace triposg
