// See extract.h. Ports flash_extract_geometry's refinement loop with
// the same integer schedule, band, dilation counts and scatter/gather
// order; only the backend (exact query math) and the final mesher differ.
#include "extract.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <vector>

namespace triposg {
namespace {

// Unknown cells hold quiet NaN. Valid() mirrors the python validity test
// (val > -9000, which is false for NaN), so the -10000 sentinel region
// behaves identically without a magic constant in the grid.
inline bool Valid(float v) { return v == v && v > -9000.0f; }

inline float SignF(float v) { return v > 0.0f ? 1.0f : (v < 0.0f ? -1.0f : 0.0f); }

size_t Idx(int i, int j, int k, int n) {
  return (static_cast<size_t>(i) * n + j) * n + k;
}

// One 3x3x3 binary dilation pass (26-neighbourhood + self).
void DilateOnce(const std::vector<char>& src, std::vector<char>& dst, int n) {
  for (int i = 0; i < n; ++i)
    for (int j = 0; j < n; ++j)
      for (int k = 0; k < n; ++k) {
        char hit = 0;
        for (int di = -1; di <= 1 && !hit; ++di) {
          int ii = i + di;
          if (ii < 0 || ii >= n) continue;
          for (int dj = -1; dj <= 1 && !hit; ++dj) {
            int jj = j + dj;
            if (jj < 0 || jj >= n) continue;
            for (int dk = -1; dk <= 1; ++dk) {
              int kk = k + dk;
              if (kk < 0 || kk >= n) continue;
              if (src[Idx(ii, jj, kk, n)]) {
                hit = 1;
                break;
              }
            }
          }
        }
        dst[Idx(i, j, k, n)] = hit;
      }
}

void Dilate(std::vector<char>& mask, int n, int passes) {
  std::vector<char> tmp(mask.size());
  for (int p = 0; p < passes; ++p) {
    DilateOnce(mask, tmp, n);
    mask.swap(tmp);
  }
}

// Near-surface mask ported from extract_near_surface_volume_fn: a valid
// cell whose 6-neighbourhood (replicate-clamped, invalid neighbours
// replaced by the centre value) disagrees in sign. Unknown cells are 0.
void NearSurfaceMask(const std::vector<float>& grid, std::vector<char>& mask,
                     int n) {
  static const int kOff[6][3] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
                                 {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
  for (int i = 0; i < n; ++i)
    for (int j = 0; j < n; ++j)
      for (int k = 0; k < n; ++k) {
        float v = grid[Idx(i, j, k, n)];
        if (!Valid(v)) {
          mask[Idx(i, j, k, n)] = 0;
          continue;
        }
        float s = SignF(v);
        char hit = 0;
        for (const auto& o : kOff) {
          int ii = std::min(std::max(i + o[0], 0), n - 1);
          int jj = std::min(std::max(j + o[1], 0), n - 1);
          int kk = std::min(std::max(k + o[2], 0), n - 1);
          float nv = grid[Idx(ii, jj, kk, n)];
          if (!Valid(nv)) nv = v;
          if (SignF(nv) != s) {
            hit = 1;
            break;
          }
        }
        mask[Idx(i, j, k, n)] = hit;
      }
}

// Query n_pts points through the backend in exact chunk_points calls
// (last call padded by repeating its last point).
bool QueryChunked(QueryBackend* backend, const std::vector<float>& points,
                  int n_pts, int chunk, std::vector<float>& out) {
  out.resize(n_pts);
  std::vector<float> in_buf(static_cast<size_t>(chunk) * 3);
  std::vector<float> out_buf(chunk);
  int done = 0;
  while (done < n_pts) {
    int take = std::min(chunk, n_pts - done);
    for (int t = 0; t < chunk; ++t) {
      int s = done + (t < take ? t : take - 1);
      in_buf[3 * t] = points[3 * s];
      in_buf[3 * t + 1] = points[3 * s + 1];
      in_buf[3 * t + 2] = points[3 * s + 2];
    }
    backend->Query(in_buf.data(), chunk, out_buf.data());
    for (int t = 0; t < take; ++t) out[done + t] = out_buf[t];
    done += take;
  }
  return true;
}

}  // namespace

std::vector<int> FlashLevels(int d0, int d1) {
  int r = 1 << d1;
  std::vector<int> rs;
  if (r < 63) rs.push_back(r);
  while (r >= 63) {
    rs.push_back(r);
    r /= 2;
  }
  std::reverse(rs.begin(), rs.end());
  int c0 = (rs[0] / 4) * 4 - 1;
  std::vector<int> levels;
  for (size_t k = 0; k < rs.size(); ++k) levels.push_back(c0 * (1 << k));
  int thresh = ((1 << d0) / 4) * 4 - 1;
  while (levels.size() > 1 && levels[0] < thresh) levels.erase(levels.begin());
  return levels;
}

bool ExtractSdf(QueryBackend* backend, const ExtractConfig& cfg,
                std::vector<float>& out_grid, int& out_res) {
  if (backend == nullptr || cfg.chunk_points < 1) return false;
  const std::vector<int> levels = FlashLevels(cfg.d0, cfg.d1);
  if (levels.empty()) return false;
  const float lo = -cfg.bound, hi = cfg.bound;
  const double span_d = static_cast<double>(hi) - lo;
  const int chunk = cfg.chunk_points;

  std::vector<float> grid;
  int cur_n = 0;  // points per side of the current grid

  for (size_t li = 0; li < levels.size(); ++li) {
    const int res = levels[li];
    const int n = res + 1;
    const bool last = (li + 1 == levels.size());
    if (li == 0) {
      // Dense coarse grid: linspace points in x-major order.
      const float step = static_cast<float>(span_d / res);
      std::vector<float> points;
      points.reserve(static_cast<size_t>(n) * n * n * 3);
      for (int i = 0; i < n; ++i) {
        float x = lo + i * step;
        for (int j = 0; j < n; ++j) {
          float y = lo + j * step;
          for (int k = 0; k < n; ++k) {
            points.push_back(x);
            points.push_back(y);
            points.push_back(lo + k * step);
          }
        }
      }
      std::vector<float> values;
      QueryChunked(backend, points, n * n * n, chunk, values);
      grid.assign(values.begin(), values.end());
      cur_n = n;
    } else {
      // Refine: near-surface + band mask on the current grid...
      std::vector<char> mask(static_cast<size_t>(cur_n) * cur_n * cur_n, 0);
      NearSurfaceMask(grid, mask, cur_n);
      for (size_t t = 0; t < mask.size(); ++t)
        if (!mask[t] && Valid(grid[t]) && std::fabs(grid[t]) < cfg.band)
          mask[t] = 1;
      const int expand = last ? 0 : 1;
      for (int p = 0; p < expand; ++p) {
        Dilate(mask, cur_n, 1);
        Dilate(mask, cur_n, 1);
      }
      // ...scatter to even coords of the fine grid, dilate there...
      std::vector<char> fine_idx(static_cast<size_t>(n) * n * n, 0);
      for (int i = 0; i < cur_n; ++i)
        for (int j = 0; j < cur_n; ++j)
          for (int k = 0; k < cur_n; ++k)
            if (mask[Idx(i, j, k, cur_n)]) fine_idx[Idx(2 * i, 2 * j, 2 * k, n)] = 1;
      Dilate(fine_idx, n, 2 - expand);
      // ...query the marked fine points, everything else stays NaN.
      std::vector<int> coords;
      coords.reserve(1024);
      for (size_t t = 0; t < fine_idx.size(); ++t)
        if (fine_idx[t]) coords.push_back(static_cast<int>(t));
      const float res_f =
          static_cast<float>(span_d / static_cast<double>(res));
      std::vector<float> points;
      points.reserve(coords.size() * 3);
      for (int t : coords) {
        int i = t / (n * n), j = (t / n) % n, k = t % n;
        points.push_back(i * res_f + lo);
        points.push_back(j * res_f + lo);
        points.push_back(k * res_f + lo);
      }
      std::vector<float> values;
      QueryChunked(backend, points, static_cast<int>(coords.size()), chunk,
                   values);
      const float kNaN = std::numeric_limits<float>::quiet_NaN();
      std::vector<float> fine(static_cast<size_t>(n) * n * n, kNaN);
      for (size_t t = 0; t < coords.size(); ++t) fine[coords[t]] = values[t];
      grid.swap(fine);
      cur_n = n;
    }
  }

  out_grid.swap(grid);
  out_res = levels.back();
  return true;
}

}  // namespace triposg
