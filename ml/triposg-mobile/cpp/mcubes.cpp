// See mcubes.h.
#include "mcubes.h"

#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace triposg {
namespace {

// Cube corners in (x, y, z) index offsets.
constexpr int kCorners[8][3] = {{0, 0, 0}, {1, 0, 0}, {1, 1, 0}, {0, 1, 0},
                                {0, 0, 1}, {1, 0, 1}, {1, 1, 1}, {0, 1, 1}};

// Uniform 6-tetrahedra decomposition (body diagonal c0-c6 plus one
// non-incident cube edge each). Identical in every cube, hence shared
// faces always receive the same diagonal: crack-free by construction.
constexpr int kTets[6][4] = {{0, 6, 1, 2}, {0, 6, 2, 3}, {0, 6, 4, 5},
                             {0, 6, 7, 4}, {0, 6, 1, 5}, {0, 6, 3, 7}};

// The 6 edges of a tet, as (from, to) tet-local corner slots.
constexpr int kTetEdges[6][2] = {{0, 1}, {0, 2}, {0, 3},
                                 {1, 2}, {1, 3}, {2, 3}};

struct Vec {
  float x, y, z;
};

Vec operator-(const Vec& a, const Vec& b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec Cross(const Vec& a, const Vec& b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z,
          a.x * b.y - a.y * b.x};
}

float Dot(const Vec& a, const Vec& b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

}  // namespace

McubesResult Polygonize(const float* grid, int res, const McubesConfig& cfg) {
  McubesResult out;
  const int n = res + 1;
  auto at = [&](int i, int j, int k) -> float {
    return grid[(static_cast<size_t>(i) * n + j) * n + k];
  };
  auto id = [&](int i, int j, int k) -> uint32_t {
    return static_cast<uint32_t>((static_cast<size_t>(i) * n + j) * n + k);
  };

  std::unordered_map<uint64_t, uint32_t> vert_of;
  vert_of.reserve(1 << 20);
  std::vector<uint32_t> tris;
  tris.reserve(1 << 20);

  // Crossing point on the grid edge (a -> b) with values va, vb.
  auto cross_vert = [&](uint32_t a, uint32_t b, float va, float vb,
                        const Vec& pa, const Vec& pb) -> uint32_t {
    uint64_t key =
        (static_cast<uint64_t>(a < b ? a : b) << 32) | (a < b ? b : a);
    auto it = vert_of.find(key);
    if (it != vert_of.end()) return it->second;
    float denom = vb - va;
    float t = (denom != 0.0f) ? (cfg.iso - va) / denom : 0.5f;
    Vec p = {pa.x + t * (pb.x - pa.x), pa.y + t * (pb.y - pa.y),
             pa.z + t * (pb.z - pa.z)};
    uint32_t v = static_cast<uint32_t>(out.positions.size() / 3);
    out.positions.push_back(p.x);
    out.positions.push_back(p.y);
    out.positions.push_back(p.z);
    vert_of[key] = v;
    return v;
  };

  // Emit one triangle, oriented so its normal points away from ref
  // (a point strictly on the inside of the surface patch).
  auto emit = [&](uint32_t a, uint32_t b, uint32_t c, const Vec& ref) {
    if (a == b || b == c || c == a) return;  // degenerate: skip, no hole
    Vec pa = {out.positions[3 * a], out.positions[3 * a + 1],
              out.positions[3 * a + 2]};
    Vec pb = {out.positions[3 * b], out.positions[3 * b + 1],
              out.positions[3 * b + 2]};
    Vec pc = {out.positions[3 * c], out.positions[3 * c + 1],
              out.positions[3 * c + 2]};
    Vec nrm = Cross(pb - pa, pc - pa);
    Vec mid = {(pa.x + pb.x + pc.x) / 3, (pa.y + pb.y + pc.y) / 3,
               (pa.z + pb.z + pc.z) / 3};
    Vec away = {mid.x - ref.x, mid.y - ref.y, mid.z - ref.z};
    if (Dot(nrm, away) < 0) {
      tris.push_back(a);
      tris.push_back(c);
      tris.push_back(b);
    } else {
      tris.push_back(a);
      tris.push_back(b);
      tris.push_back(c);
    }
  };

  Vec wp[8];  // scratch
  for (int i = 0; i < res; ++i)
    for (int j = 0; j < res; ++j)
      for (int k = 0; k < res; ++k) {
        uint32_t cid[8];
        float cv[8];
        bool ok = true;
        for (int c = 0; c < 8; ++c) {
          int ii = i + kCorners[c][0], jj = j + kCorners[c][1],
              kk = k + kCorners[c][2];
          float v = at(ii, jj, kk);
          if (!(v == v)) {
            ok = false;
            break;
          }
          cid[c] = id(ii, jj, kk);
          cv[c] = v;
          wp[c] = {cfg.ox + ii * cfg.spacing, cfg.oy + jj * cfg.spacing,
                   cfg.oz + kk * cfg.spacing};
        }
        if (!ok) continue;  // NaN fringe: DiffDMC skips these cells too
        for (const auto& tet : kTets) {
          uint32_t tcid[4];
          float tcv[4];
          Vec tp[4];
          for (int s = 0; s < 4; ++s) {
            tcid[s] = cid[tet[s]];
            tcv[s] = cv[tet[s]];
            tp[s] = wp[tet[s]];
          }
          int inside[4], outside[4], ni = 0, no = 0;
          for (int s = 0; s < 4; ++s) {
            if (tcv[s] < cfg.iso)
              inside[ni++] = s;
            else
              outside[no++] = s;
          }
          if (ni == 0 || ni == 4) continue;
          // Crossing vertex on each tet edge joining opposite sides.
          uint32_t ex[6];
          for (int e = 0; e < 6; ++e) {
            int a = kTetEdges[e][0], b = kTetEdges[e][1];
            bool show = (tcv[a] < cfg.iso) != (tcv[b] < cfg.iso);
            ex[e] = show ? cross_vert(tcid[a], tcid[b], tcv[a], tcv[b],
                                      tp[a], tp[b])
                         : 0;
          }
          auto edge_id = [&](int a, int b) -> int {
            for (int e = 0; e < 6; ++e)
              if ((kTetEdges[e][0] == a && kTetEdges[e][1] == b) ||
                  (kTetEdges[e][0] == b && kTetEdges[e][1] == a))
                return e;
            return -1;
          };
          Vec ref = {0, 0, 0};
          for (int s = 0; s < ni; ++s) {
            ref.x += tp[inside[s]].x;
            ref.y += tp[inside[s]].y;
            ref.z += tp[inside[s]].z;
          }
          ref.x /= ni;
          ref.y /= ni;
          ref.z /= ni;
          if (ni == 1 || ni == 3) {
            // Single triangle: the 3 edges incident to the odd corner.
            int m = (ni == 1) ? inside[0] : outside[0];
            int others[3], q = 0;
            for (int s = 0; s < 4; ++s)
              if (s != m) others[q++] = s;
            uint32_t v0 = ex[edge_id(m, others[0])];
            uint32_t v1 = ex[edge_id(m, others[1])];
            uint32_t v2 = ex[edge_id(m, others[2])];
            emit(v0, v1, v2, ref);
          } else {
            // Quad: cycle a-c, a-d, b-d, b-c around the two inside (a,b).
            int a = inside[0], b = inside[1];
            int c = outside[0], d = outside[1];
            uint32_t pac = ex[edge_id(a, c)], pad = ex[edge_id(a, d)];
            uint32_t pbd = ex[edge_id(b, d)], pbc = ex[edge_id(b, c)];
            emit(pac, pad, pbd, ref);
            emit(pac, pbd, pbc, ref);
          }
        }
      }

  out.indices.swap(tris);
  const size_t nv = out.positions.size() / 3;
  out.normals.assign(3 * nv, 0.0f);
  for (size_t t = 0; t < out.indices.size(); t += 3) {
    uint32_t a = out.indices[t], b = out.indices[t + 1], c = out.indices[t + 2];
    Vec pa = {out.positions[3 * a], out.positions[3 * a + 1],
              out.positions[3 * a + 2]};
    Vec pb = {out.positions[3 * b], out.positions[3 * b + 1],
              out.positions[3 * b + 2]};
    Vec pc = {out.positions[3 * c], out.positions[3 * c + 1],
              out.positions[3 * c + 2]};
    Vec nrm = Cross(pb - pa, pc - pa);
    out.normals[3 * a] += nrm.x;
    out.normals[3 * a + 1] += nrm.y;
    out.normals[3 * a + 2] += nrm.z;
    out.normals[3 * b] += nrm.x;
    out.normals[3 * b + 1] += nrm.y;
    out.normals[3 * b + 2] += nrm.z;
    out.normals[3 * c] += nrm.x;
    out.normals[3 * c + 1] += nrm.y;
    out.normals[3 * c + 2] += nrm.z;
  }
  for (size_t v = 0; v < nv; ++v) {
    Vec nrm = {out.normals[3 * v], out.normals[3 * v + 1],
               out.normals[3 * v + 2]};
    float len = std::sqrt(Dot(nrm, nrm));
    if (len > 1e-12f) {
      out.normals[3 * v] = nrm.x / len;
      out.normals[3 * v + 1] = nrm.y / len;
      out.normals[3 * v + 2] = nrm.z / len;
    }
  }

  // Signed volume (positive for outward-facing closed meshes); flip the
  // winding if it comes out negative so normals match the convention.
  double vol = 0.0;
  for (size_t t = 0; t < out.indices.size(); t += 3) {
    uint32_t a = out.indices[t], b = out.indices[t + 1], c = out.indices[t + 2];
    Vec pa = {out.positions[3 * a], out.positions[3 * a + 1],
              out.positions[3 * a + 2]};
    Vec pb = {out.positions[3 * b], out.positions[3 * b + 1],
              out.positions[3 * b + 2]};
    Vec pc = {out.positions[3 * c], out.positions[3 * c + 1],
              out.positions[3 * c + 2]};
    vol += (pa.x * (pb.y * pc.z - pb.z * pc.y) -
            pa.y * (pb.x * pc.z - pb.z * pc.x) +
            pa.z * (pb.x * pc.y - pb.y * pc.x)) /
           6.0;
  }
  if (vol < 0) {
    for (size_t t = 0; t < out.indices.size(); t += 3) {
      uint32_t tmp = out.indices[t + 1];
      out.indices[t + 1] = out.indices[t + 2];
      out.indices[t + 2] = tmp;
    }
    // Recompute the normals cleanly for the flipped winding.
    out.normals.assign(3 * nv, 0.0f);
    for (size_t t = 0; t < out.indices.size(); t += 3) {
      uint32_t a = out.indices[t], b = out.indices[t + 1],
               c = out.indices[t + 2];
      Vec pa = {out.positions[3 * a], out.positions[3 * a + 1],
                out.positions[3 * a + 2]};
      Vec pb = {out.positions[3 * b], out.positions[3 * b + 1],
                out.positions[3 * b + 2]};
      Vec pc = {out.positions[3 * c], out.positions[3 * c + 1],
                out.positions[3 * c + 2]};
      Vec nrm = Cross(pb - pa, pc - pa);
      out.normals[3 * a] += nrm.x;
      out.normals[3 * a + 1] += nrm.y;
      out.normals[3 * a + 2] += nrm.z;
      out.normals[3 * b] += nrm.x;
      out.normals[3 * b + 1] += nrm.y;
      out.normals[3 * b + 2] += nrm.z;
      out.normals[3 * c] += nrm.x;
      out.normals[3 * c + 1] += nrm.y;
      out.normals[3 * c + 2] += nrm.z;
    }
    for (size_t v = 0; v < nv; ++v) {
      Vec nrm = {out.normals[3 * v], out.normals[3 * v + 1],
                 out.normals[3 * v + 2]};
      float len = std::sqrt(Dot(nrm, nrm));
      if (len > 1e-12f) {
        out.normals[3 * v] = nrm.x / len;
        out.normals[3 * v + 1] = nrm.y / len;
        out.normals[3 * v + 2] = nrm.z / len;
      }
    }
    vol = -vol;
  }
  out.signed_volume = vol;

  // Closedness: every undirected edge used by exactly 2 triangles.
  std::unordered_map<uint64_t, int> edge_use;
  edge_use.reserve(out.indices.size());
  for (size_t t = 0; t < out.indices.size(); t += 3) {
    for (int e = 0; e < 3; ++e) {
      uint32_t a = out.indices[t + e], b = out.indices[t + (e + 1) % 3];
      uint64_t key =
          (static_cast<uint64_t>(a < b ? a : b) << 32) | (a < b ? b : a);
      ++edge_use[key];
    }
  }
  out.closed = true;
  for (const auto& kv : edge_use)
    if (kv.second != 2) {
      out.closed = false;
      break;
    }
  return out;
}

}  // namespace triposg
