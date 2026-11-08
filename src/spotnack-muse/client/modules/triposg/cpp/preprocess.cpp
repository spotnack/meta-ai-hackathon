// See preprocess.h.
#include "preprocess.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace triposg {
namespace {

// ImageNet mean/std used by both rembg u2net and the DINOv2 processor.
constexpr float kMean[3] = {0.485f, 0.456f, 0.406f};
constexpr float kStd[3] = {0.229f, 0.224f, 0.225f};
constexpr double kPi = 3.141592653589793;

// Pillow Resample.c port (uint8 fixed-point path, 13.0.0).
//
// Mirrors libImaging/Resample.c: horizontal pass then vertical pass,
// per band, planar. Per output pixel the coefficient window uses
// support = filterSupport * max(scale, 1) with center = in0 +
// (x + 0.5) * scale, weights normalized over the in-range taps;
// coefficients are int32 at PRECISION_BITS = 22, the accumulator
// carries a rounding offset and the result is arithmetically shifted
// and clipped to uint8. Kernel expressions below are Pillow's verbatim
// (bicubic a = -0.5, lanczos a = 3).
constexpr int kPrecisionBits = 22;
constexpr int64_t kPrecisionScale = int64_t(1) << kPrecisionBits;

double BicubicKernel(double x) {
  constexpr double a = -0.5;
  if (x < 0.0) x = -x;
  if (x < 1.0) return ((a + 2.0) * x - (a + 3.0)) * x * x + 1;
  if (x < 2.0) return (((x - 5) * x + 8) * x - 4) * a;
  return 0.0;
}

double SincKernel(double x) {
  if (x == 0.0) return 1.0;
  x = x * kPi;
  return std::sin(x) / x;
}

double LanczosKernel(double x) {
  if (-3.0 <= x && x < 3.0) return SincKernel(x) * SincKernel(x / 3);
  return 0.0;
}

inline uint8_t ClipU8(int v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return static_cast<uint8_t>(v);
}

// Fixed-point coefficients for one axis (full-image box, in0 = 0),
// mirroring precompute_coeffs line by line: C-cast rounding for the
// window, center-referenced taps ((x + xmin - center + 0.5) scaled by
// the hoisted reciprocal), normalization over kept taps, zero tail.
struct AxisCoefs {
  int ksize = 0;
  std::vector<int> xmin;   // first tap input index, per output
  std::vector<int> count;  // tap count, per output
  std::vector<int32_t> kk;  // outSize * ksize fixed-point coefficients
};

AxisCoefs ComputeAxisCoefs(int inSize, int outSize, double base_support,
                           double (*kernel)(double)) {
  AxisCoefs ac;
  const double scale = static_cast<double>(inSize) / outSize;
  double filterscale = scale;
  if (filterscale < 1.0) filterscale = 1.0;
  const double support = base_support * filterscale;
  ac.ksize = static_cast<int>(std::ceil(support)) * 2 + 1;
  ac.xmin.resize(outSize);
  ac.count.resize(outSize);
  ac.kk.assign(static_cast<size_t>(outSize) * ac.ksize, 0);
  const double inv_filterscale = 1.0 / filterscale;  // hoisted invariant
  std::vector<double> w(ac.ksize);
  for (int xx = 0; xx < outSize; ++xx) {
    const double center = (xx + 0.5) * scale;
    int xmin = static_cast<int>(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    int xmax = static_cast<int>(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;  // now a count
    ac.xmin[xx] = xmin;
    ac.count[xx] = xmax;
    double ww = 0.0;
    for (int x = 0; x < xmax; ++x) {
      w[x] = kernel((x + xmin - center + 0.5) * inv_filterscale);
      ww += w[x];
    }
    if (ww != 0.0) {
      for (int x = 0; x < xmax; ++x) w[x] /= ww;
    }
    for (int x = 0; x < xmax; ++x) {
      // normalize_coeffs_8bpc, literally (round half away from zero).
      const double v = w[x] * kPrecisionScale;
      ac.kk[static_cast<size_t>(xx) * ac.ksize + x] =
          v < 0 ? static_cast<int32_t>(-0.5 + v)
                : static_cast<int32_t>(0.5 + v);
    }
  }
  return ac;
}

// One separable pass over a plane (uint8 in/out), mirroring
// _ImagingResampleHorizontal/Vertical_8bpc: uint32 arithmetic (identical
// bits to the int wrap), the rounding offset, arithmetic shift, clip8.
void ResamplePlane(const uint8_t* src, int sw, int sh, uint8_t* dst, int dw,
                   int dh, double base_support, double (*kernel)(double)) {
  const AxisCoefs ax = ComputeAxisCoefs(sw, dw, base_support, kernel);
  std::vector<uint8_t> tmp(static_cast<size_t>(dw) * sh);
  for (int y = 0; y < sh; ++y) {
    for (int xx = 0; xx < dw; ++xx) {
      uint32_t ss = 1u << (kPrecisionBits - 1);  // rounding offset
      const int x0 = ax.xmin[xx];
      const int32_t* k = &ax.kk[static_cast<size_t>(xx) * ax.ksize];
      for (int x = 0; x < ax.count[xx]; ++x) {
        ss += static_cast<uint32_t>(src[y * sw + x0 + x]) *
              static_cast<uint32_t>(k[x]);
      }
      tmp[y * dw + xx] = ClipU8(static_cast<int32_t>(ss) >> kPrecisionBits);
    }
  }
  const AxisCoefs ay = ComputeAxisCoefs(sh, dh, base_support, kernel);
  for (int y = 0; y < dh; ++y) {
    for (int xx = 0; xx < dw; ++xx) {
      uint32_t ss = 1u << (kPrecisionBits - 1);
      const int y0 = ay.xmin[y];
      const int32_t* k = &ay.kk[static_cast<size_t>(y) * ay.ksize];
      for (int yy = 0; yy < ay.count[y]; ++yy) {
        ss += static_cast<uint32_t>(tmp[(y0 + yy) * dw + xx]) *
              static_cast<uint32_t>(k[yy]);
      }
      dst[y * dw + xx] = ClipU8(static_cast<int32_t>(ss) >> kPrecisionBits);
    }
  }
}

// Convert.c rgbA2rgba: RGBa = MULDIV255(RGB, A); alpha copied through.
void PremultiplyRgba(uint8_t* px, size_t n) {
  for (size_t i = 0; i < n; ++i, px += 4) {
    const unsigned a = px[3];
    for (int c = 0; c < 3; ++c) {
      const unsigned tmp = static_cast<unsigned>(px[c]) * a + 128;
      px[c] = static_cast<uint8_t>((((tmp) >> 8) + (tmp)) >> 8);
    }
  }
}

// Convert.c rgba2rgbA: alpha 255/0 passes through, else CLIP8((255*c)/a)
// with truncating integer division.
void UnpremultiplyRgba(uint8_t* px, size_t n) {
  for (size_t i = 0; i < n; ++i, px += 4) {
    const unsigned a = px[3];
    if (a == 255 || a == 0) continue;
    for (int c = 0; c < 3; ++c) {
      const unsigned v = 255u * static_cast<unsigned>(px[c]) / a;
      px[c] = static_cast<uint8_t>(v < 256 ? v : 255);
    }
  }
}

}  // namespace

void ResamplePillow(const uint8_t* src, int sw, int sh, int channels,
                    uint8_t* dst, int dw, int dh, PillowFilter filter,
                    bool premultiply_alpha) {
  const double support = filter == PillowFilter::kLanczos ? 3.0 : 2.0;
  double (*kernel)(double) =
      filter == PillowFilter::kLanczos ? LanczosKernel : BicubicKernel;
  // Image.resize reroutes RGBA through premultiplied RGBa; replicate it
  // on a copy so the caller's input is untouched.
  const bool pa = premultiply_alpha && channels == 4;
  std::vector<uint8_t> work;
  const uint8_t* in = src;
  if (pa) {
    work.assign(src, src + static_cast<size_t>(sw) * sh * channels);
    PremultiplyRgba(work.data(), static_cast<size_t>(sw) * sh);
    in = work.data();
  }
  std::vector<uint8_t> plane(static_cast<size_t>(sw) * sh);
  std::vector<uint8_t> plane_out(static_cast<size_t>(dw) * dh);
  for (int c = 0; c < channels; ++c) {
    for (int i = 0; i < sw * sh; ++i) plane[i] = in[i * channels + c];
    ResamplePlane(plane.data(), sw, sh, plane_out.data(), dw, dh, support,
                  kernel);
    for (int i = 0; i < dw * dh; ++i) dst[i * channels + c] = plane_out[i];
  }
  if (pa) UnpremultiplyRgba(dst, static_cast<size_t>(dw) * dh);
}

// OpenCV INTER_AREA port for 8-bit images, line by line from 4.11.0
// resize.cpp: computeResizeAreaTab (double bounds, 1e-3 epsilons, float
// alphas, cellWidth normalization) plus the ResizeArea_Invoker
// accumulation (float buf zeroed per source row, sum = beta*buf then
// += beta*buf, saturate_store with cvRound half-even + clamp). The
// cn-specific unrolled loops are value-identical to the generic
// per-channel accumulation, so one loop covers all channel counts.
// scales use 1/(dst/src), exactly like cv::resize.
struct AreaTab {
  int si = 0;  // source index (times channels)
  int di = 0;  // dest index (times channels)
  float alpha = 0;
};

int ComputeAreaTab(int ssize, int dsize, int cn, double scale,
                   std::vector<AreaTab>& tab) {
  tab.clear();
  for (int dx = 0; dx < dsize; ++dx) {
    const double fsx1 = dx * scale;
    const double fsx2 = fsx1 + scale;
    const double cellWidth = std::min(scale, static_cast<double>(ssize) - fsx1);
    int sx1 = static_cast<int>(std::ceil(fsx1));
    int sx2 = static_cast<int>(std::floor(fsx2));
    if (sx2 > ssize - 1) sx2 = ssize - 1;
    if (sx1 > sx2) sx1 = sx2;
    if (sx1 - fsx1 > 1e-3) {
      AreaTab e;
      e.di = dx * cn;
      e.si = (sx1 - 1) * cn;
      e.alpha = static_cast<float>((sx1 - fsx1) / cellWidth);
      tab.push_back(e);
    }
    for (int sx = sx1; sx < sx2; ++sx) {
      AreaTab e;
      e.di = dx * cn;
      e.si = sx * cn;
      e.alpha = static_cast<float>(1.0 / cellWidth);
      tab.push_back(e);
    }
    if (fsx2 - sx2 > 1e-3) {
      AreaTab e;
      e.di = dx * cn;
      e.si = sx2 * cn;
      const double w = std::min(std::min(fsx2 - sx2, 1.0), cellWidth);
      e.alpha = static_cast<float>(w / cellWidth);
      tab.push_back(e);
    }
  }
  return static_cast<int>(tab.size());
}

void ResizeAreaU8(const uint8_t* src, int sw, int sh, int channels,
                  uint8_t* dst, int dw, int dh) {
  const double scale_x = 1.0 / (static_cast<double>(dw) / sw);
  const double scale_y = 1.0 / (static_cast<double>(dh) / sh);
  std::vector<AreaTab> xtab, ytab;
  ComputeAreaTab(sw, dw, channels, scale_x, xtab);
  ComputeAreaTab(sh, dh, 1, scale_y, ytab);
  const int wn = dw * channels;
  std::vector<float> buf(wn), sum(wn, 0.0f);
  int prev_dy = ytab.empty() ? 0 : ytab[0].di;
  for (const AreaTab& ye : ytab) {
    const float beta = ye.alpha;
    const int dy = ye.di;
    const uint8_t* S = src + static_cast<size_t>(ye.si) * sw * channels;
    for (int i = 0; i < wn; ++i) buf[i] = 0.0f;
    for (const AreaTab& xe : xtab) {
      const int sxn = xe.si;
      const int dxn = xe.di;
      const float alpha = xe.alpha;
      for (int c = 0; c < channels; ++c) {
        buf[dxn + c] = buf[dxn + c] + S[sxn + c] * alpha;
      }
    }
    if (dy != prev_dy) {
      uint8_t* D = dst + static_cast<size_t>(prev_dy) * wn;
      for (int i = 0; i < wn; ++i)
        D[i] = ClipU8(static_cast<int>(std::nearbyintf(sum[i])));
      for (int i = 0; i < wn; ++i) sum[i] = beta * buf[i];
      prev_dy = dy;
    } else {
      for (int i = 0; i < wn; ++i) sum[i] += beta * buf[i];
    }
  }
  uint8_t* D = dst + static_cast<size_t>(prev_dy) * wn;
  for (int i = 0; i < wn; ++i)
    D[i] = ClipU8(static_cast<int>(std::nearbyintf(sum[i])));
}

namespace {

}  // namespace

bool HasValidAlpha(const RgbaImage& img) {
  // np.histogram(alpha, bins=20, range=(0, 256)): edges at k*12.8.
  long hist[20] = {0};
  const size_t n = static_cast<size_t>(img.w) * img.h;
  for (size_t i = 0; i < n; ++i) {
    int b = img.px[i * 4 + 3] * 20 / 256;
    hist[b < 19 ? b : 19]++;
  }
  const long need = static_cast<long>(n * 0.01);
  return hist[0] >= need && hist[19] >= need;
}

MaskStats AnalyzeMask(const uint8_t* alpha, int w, int h) {
  MaskStats st;
  if (alpha == nullptr || w < 1 || h < 1) return st;
  const size_t n = static_cast<size_t>(w) * h;
  long top = 0, bottom = 0, left = 0, right = 0, area = 0;
  for (int x = 0; x < w; ++x) {
    if (alpha[x]) ++top;
    if (alpha[(h - 1) * w + x]) ++bottom;
  }
  for (int y = 0; y < h; ++y) {
    if (alpha[y * w]) ++left;
    if (alpha[y * w + w - 1]) ++right;
  }
  for (size_t i = 0; i < n; ++i)
    if (alpha[i]) ++area;
  const float edges[4] = {
      static_cast<float>(top) / w, static_cast<float>(bottom) / w,
      static_cast<float>(left) / h, static_cast<float>(right) / h};
  st.border_touch = *std::max_element(edges, edges + 4);
  st.area_frac = static_cast<float>(area) / static_cast<float>(n);
  if (area == 0) return st;
  // 4-connected components over alpha>0 (iterative flood fill).
  std::vector<char> seen(n, 0);
  std::vector<int> stack;
  const long need = static_cast<long>(area * kMinComponentFrac) + 1;
  int big = 0;
  for (size_t s = 0; s < n; ++s) {
    if (!alpha[s] || seen[s]) continue;
    long size = 0;
    stack.clear();
    stack.push_back(static_cast<int>(s));
    seen[s] = 1;
    while (!stack.empty()) {
      const int cur = stack.back();
      stack.pop_back();
      ++size;
      const int x = cur % w, y = cur / w;
      const int nb[4][2] = {{x - 1, y}, {x + 1, y}, {x, y - 1}, {x, y + 1}};
      for (const auto& q : nb) {
        if (q[0] < 0 || q[0] >= w || q[1] < 0 || q[1] >= h) continue;
        const size_t m = static_cast<size_t>(q[1]) * w + q[0];
        if (alpha[m] && !seen[m]) {
          seen[m] = 1;
          stack.push_back(static_cast<int>(m));
        }
      }
    }
    if (size >= need) ++big;
  }
  st.big_components = big;
  return st;
}

RgbaImage Downscale2000(const RgbaImage& rgba) {
  // load_image 2000-px block: int() sizes, cv2 INTER_AREA, all channels.
  // std::max matches the height > width / else branch (equal takes the
  // width side at the same value).
  const int long_side = std::max(rgba.w, rgba.h);
  const double scale = 2000.0 / long_side;
  if (!(scale < 1)) return RgbaImage{rgba.w, rgba.h, rgba.px};
  const int nw = static_cast<int>(rgba.w * scale);
  const int nh = static_cast<int>(rgba.h * scale);
  RgbaImage out{nw, nh,
                std::vector<uint8_t>(static_cast<size_t>(nw) * nh * 4)};
  ResizeAreaU8(rgba.px.data(), rgba.w, rgba.h, 4, out.px.data(), nw, nh);
  return out;
}

RgbaImage RemoveBackgroundU2net(
    const uint8_t* rgb, int w, int h,
    void (*query_u2net_nchw)(const float* nchw, float* out, int out_n,
                             void* user),
    void* user) {
  // rembg 2.0.86 sessions/u2net.py predict + bg.py naive_cutout, exactly:
  // RGB -> LANCZOS 320 -> float64 /max -> (x-mean)/std -> float32 NCHW ->
  // u2net -> channel-0 min-max -> clip(0,1) -> *255 truncate (L mask) ->
  // LANCZOS back to source size -> composite over transparent black with
  // Pillow's integer BLEND (paste-with-mask), alpha = mask.
  constexpr int kNet = 320;
  std::vector<uint8_t> small(static_cast<size_t>(3) * kNet * kNet);
  ResamplePillow(rgb, w, h, 3, small.data(), kNet, kNet,
                 PillowFilter::kLanczos);
  double mx = 0.0;
  for (uint8_t v : small) mx = std::max(mx, static_cast<double>(v));
  if (mx < 1e-6) mx = 1e-6;  // max(np.max(im_ary), 1e-6), float64 math
  std::vector<float> nchw(static_cast<size_t>(3) * kNet * kNet);
  for (int c = 0; c < 3; ++c)
    for (int i = 0; i < kNet * kNet; ++i) {
      const double norm =
          (small[static_cast<size_t>(i) * 3 + c] / mx - kMean[c]) / kStd[c];
      nchw[static_cast<size_t>(c) * kNet * kNet + i] =
          static_cast<float>(norm);
    }
  std::vector<float> logits(kNet * kNet);
  query_u2net_nchw(nchw.data(), logits.data(), kNet * kNet, user);
  float lo = logits[0], hi = logits[0];
  for (float v : logits) {
    lo = std::min(lo, v);
    hi = std::max(hi, v);
  }
  const float span = hi - lo > 0 ? hi - lo : 1.0f;
  std::vector<uint8_t> mask320(kNet * kNet);
  for (int i = 0; i < kNet * kNet; ++i) {
    float m = (logits[i] - lo) / span;
    m = m < 0 ? 0 : (m > 1 ? 1 : m);  // .clip(0, 1)
    mask320[i] = static_cast<uint8_t>(m * 255.0f);  // truncation
  }
  std::vector<uint8_t> mask(static_cast<size_t>(w) * h);
  ResamplePillow(mask320.data(), kNet, kNet, 1, mask.data(), w, h,
                 PillowFilter::kLanczos);
  RgbaImage out{w, h, std::vector<uint8_t>(static_cast<size_t>(w) * h * 4)};
  CompositeCutout(rgb, mask.data(), w, h, out.px.data());
  return out;
}

// Pillow paste-with-L-mask compositing over transparent black (Paste.c
// paste_mask_L image32 branch): BLEND(a, out, in) per band with
// DIV255/SHIFTFORDIV255 unsigned integer math. The RGB source X byte is
// 255, so the alpha band reduces to the mask itself (BLEND(m, 0, 255)
// evaluates to m for every m); the primitives probe checks this against
// real PIL composite bit-exactly.
void CompositeCutout(const uint8_t* rgb, const uint8_t* mask, int w, int h,
                     uint8_t* rgba) {
  for (int i = 0; i < w * h; ++i) {
    const unsigned m = mask[i];
    for (int c = 0; c < 3; ++c) {
      const unsigned tmp = static_cast<unsigned>(rgb[i * 3 + c]) * m + 128u;
      rgba[i * 4 + c] = static_cast<uint8_t>((tmp + (tmp >> 8)) >> 8);
    }
    rgba[i * 4 + 3] = mask[i];
  }
}

RgbFloat PrepareImage(const RgbaImage& rgba, const float bg[3],
                      std::vector<uint8_t>& out_u8) {
  // load_image 2000-px path (cv2 INTER_AREA), then the alpha branch.
  const RgbaImage small = Downscale2000(rgba);
  const int w = small.w, h = small.h;
  const RgbaImage& im = small;
  // Alpha>0 bbox (the valid-alpha branch of load_image; bounds are
  // inclusive, hence +1 — np.where + x_max - x_min + 1).
  int x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (int y = 0; y < h; ++y)
    for (int x = 0; x < w; ++x)
      if (im.px[(y * w + x) * 4 + 3] > 0) {
        x0 = std::min(x0, x);
        y0 = std::min(y0, y);
        x1 = std::max(x1, x);
        y1 = std::max(y1, y);
      }
  if (x1 < x0 || y1 < y0) return RgbFloat{};  // np.all(alpha == 0)
  const int bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // Composite rgb*alpha + bg*(1-alpha), float.
  RgbFloat img{w, h, std::vector<float>(static_cast<size_t>(w) * h * 3)};
  for (int i = 0; i < w * h; ++i) {
    const float a = im.px[i * 4 + 3] / 255.0f;
    for (int c = 0; c < 3; ++c)
      img.px[i * 3 + c] = (im.px[i * 4 + c] / 255.0f) * a + bg[c] * (1 - a);
  }
  // Pad (F.pad order is W left/right, H top/bottom, value bg_gray).
  // The sides are padded independently — no squaring: int() truncation
  // leaves W and H one px apart when |bw-bh| is odd (the goldens show
  // 2161x2160, 1000x1001, 1968x1967 for exactly this reason).
  // double, like Python (w * padding_ratio, int() truncation).
  constexpr double kRatio = 0.1;
  int pad_l, pad_t;
  if (bw > bh) {
    pad_l = static_cast<int>(bw * kRatio);
    pad_t = static_cast<int>(pad_l + (bw - bh) / 2.0);
  } else {
    pad_t = static_cast<int>(bh * kRatio);
    pad_l = static_cast<int>(pad_t + (bh - bw) / 2.0);
  }
  const int out_w = bw + 2 * pad_l;
  const int out_h = bh + 2 * pad_t;
  RgbFloat out{out_w, out_h,
               std::vector<float>(static_cast<size_t>(out_w) * out_h * 3)};
  for (int y = 0; y < out_h; ++y)
    for (int x = 0; x < out_w; ++x) {
      const int sx = x0 - pad_l + x, sy = y0 - pad_t + y;
      for (int c = 0; c < 3; ++c) {
        float v = bg[0];  // F.pad constant value is bg_gray = bg_color[0].
        if (sx >= 0 && sx < w && sy >= 0 && sy < h)
          v = img.px[(sy * w + sx) * 3 + c];
        out.px[(y * out_w + x) * 3 + c] = v;
      }
    }
  out_u8.resize(static_cast<size_t>(out_w) * out_h * 3);
  for (size_t i = 0; i < out_u8.size(); ++i) {
    float v = out.px[i] * 255.0f;
    v = v < 0 ? 0 : (v > 255 ? 255 : v);
    out_u8[i] = static_cast<uint8_t>(v);  // truncation, like astype(uint8)
  }
  return out;
}

// transformers get_resize_output_image_size (int size = 256, shortest
// edge, int(size * long / short) truncation) plus center_crop offsets
// ((n - 224) // 2), exactly.
void Dinov2Geometry(int w, int h, int& nw, int& nh, int& ox, int& oy) {
  const int short_side = std::min(w, h);
  nw = static_cast<int>(256.0 * w / short_side);
  nh = static_cast<int>(256.0 * h / short_side);
  ox = (nw - 224) / 2;
  oy = (nh - 224) / 2;
}

std::vector<float> Dinov2PixelValues(const uint8_t* rgb, int w, int h) {
  // transformers BitImageProcessor (PIL path), exactly: BICUBIC uint8
  // resize, center crop 224, rescale via float64 then float32, float32
  // normalize. Nothing below assumes square.
  int nw = 0, nh = 0, ox = 0, oy = 0;
  Dinov2Geometry(w, h, nw, nh, ox, oy);
  std::vector<uint8_t> small(static_cast<size_t>(3) * nw * nh);
  ResamplePillow(rgb, w, h, 3, small.data(), nw, nh,
                 PillowFilter::kBicubic);
  constexpr int kCrop = 224;
  std::vector<float> out(static_cast<size_t>(3) * kCrop * kCrop);
  for (int c = 0; c < 3; ++c)
    for (int y = 0; y < kCrop; ++y)
      for (int x = 0; x < kCrop; ++x) {
        const uint8_t u = small[(static_cast<size_t>(y + oy) * nw + (x + ox)) *
                                    3 +
                                c];
        // rescale(): float64 multiply, then float32 (1/255 exactly).
        const float v =
            static_cast<float>(static_cast<double>(u) * (1.0 / 255.0));
        // normalize() in float32, elementwise (x - mean) / std.
        out[(static_cast<size_t>(c) * kCrop + y) * kCrop + x] =
            (v - kMean[c]) / kStd[c];
      }
  return out;
}

bool WriteNpyU8(const std::string& path, const std::vector<int64_t>& shape,
                const uint8_t* data) {
  std::string dims;
  for (size_t i = 0; i < shape.size(); ++i) {
    dims += std::to_string(shape[i]);
    if (i + 1 < shape.size() || shape.size() == 1) dims += ", ";
  }
  std::string header = "{'descr': '|u1', 'fortran_order': False, 'shape': (" +
      dims + "), }";
  size_t pad = 64 - ((10 + header.size() + 1) % 64);
  header += std::string(pad, ' ');
  header += '\n';
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) return false;
  std::fputc(0x93, f);
  std::fputs("NUMPY", f);
  std::fputc(1, f);
  std::fputc(0, f);
  uint16_t hl = static_cast<uint16_t>(header.size());
  std::fwrite(&hl, 2, 1, f);
  std::fputs(header.c_str(), f);
  size_t n = 1;
  for (int64_t d : shape) n *= static_cast<size_t>(d);
  bool ok = std::fwrite(data, 1, n, f) == n;
  std::fclose(f);
  return ok;
}

bool WriteNpyF32(const std::string& path, const std::vector<int64_t>& shape,
                 const float* data) {
  std::string dims;
  for (size_t i = 0; i < shape.size(); ++i) {
    dims += std::to_string(shape[i]);
    if (i + 1 < shape.size() || shape.size() == 1) dims += ", ";
  }
  std::string header = "{'descr': '<f4', 'fortran_order': False, 'shape': (" +
      dims + "), }";
  size_t pad = 64 - ((10 + header.size() + 1) % 64);
  header += std::string(pad, ' ');
  header += '\n';
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) return false;
  std::fputc(0x93, f);
  std::fputs("NUMPY", f);
  std::fputc(1, f);
  std::fputc(0, f);
  uint16_t hl = static_cast<uint16_t>(header.size());
  std::fwrite(&hl, 2, 1, f);
  std::fputs(header.c_str(), f);
  size_t n = 1;
  for (int64_t d : shape) n *= static_cast<size_t>(d);
  bool ok = std::fwrite(data, 4, n, f) == n;
  std::fclose(f);
  return ok;
}

bool ReadNpyU8(const std::string& path, std::vector<int64_t>& shape,
               std::vector<uint8_t>& data) {
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  std::fseek(f, 0, SEEK_END);
  long size = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  std::vector<char> raw(size);
  if (std::fread(raw.data(), 1, raw.size(), f) != raw.size()) {
    std::fclose(f);
    return false;
  }
  std::fclose(f);
  if (raw.size() < 10 || std::memcmp(raw.data(), "\x93NUMPY", 6) != 0)
    return false;
  uint16_t hl;
  std::memcpy(&hl, raw.data() + 8, 2);
  std::string header(raw.data() + 10, hl);
  if (header.find("'descr': '|u1'") == std::string::npos ||
      header.find("'fortran_order': True") != std::string::npos)
    return false;
  shape.clear();
  size_t l = header.find('('), r = header.find(')');
  std::string dims = header.substr(l + 1, r - l - 1);
  size_t pos = 0;
  while (pos < dims.size()) {
    size_t comma = dims.find(',', pos);
    std::string tok = dims.substr(pos, comma - pos);
    if (!tok.empty() && tok.find_first_not_of(" \t") != std::string::npos)
      shape.push_back(std::stoll(tok));
    if (comma == std::string::npos) break;
    pos = comma + 1;
  }
  size_t off = 10 + hl, n = 1;
  for (int64_t d : shape) n *= static_cast<size_t>(d);
  if (raw.size() < off + n) return false;
  data.resize(n);
  std::memcpy(data.data(), raw.data() + off, n);
  return true;
}

}  // namespace triposg
