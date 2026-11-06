// Image front-end for the on-device TripoSG pipeline: background removal
// (rembg u2net algorithm), TripoSG prepare_image, DINOv2 pixel_values.
//
// Ports, in order:
//   - rembg 2.0.86 remove() with defaults: u2net session predict +
//     naive_cutout (no alpha matting, no post-process). The u2net ONNX
//     graph is the rembg release binary; only the pre/post math below is
//     ported: LANCZOS 320x320, float64 normalize-by-max then ImageNet
//     mean/std cast to float32, output channel 0, min-max, clip, *255
//     truncate, LANCZOS mask back-resize, BLEND composite over
//     transparent black (premultiplied RGB, alpha = mask).
//   - TripoSG scripts/image_process.py load_image/prepare_image at
//     fc5c4099, rmbg_net=None path (valid-alpha branch only): cv2
//     INTER_AREA 2000-px downscale, alpha>0 bbox, float32 composite over
//     bg_color, F.pad with bg_gray, (x*255) truncation.
//   - transformers BitImageProcessor from
//     pretrained_weights/feature_extractor_dinov2/preprocessor_config.json:
//     BICUBIC uint8 resize to shortest edge 256, center crop 224,
//     float64 rescale to float32, float32 normalize.
//
// Portable C++17, no third-party dependencies. Resampling ports Pillow's
// Resample.c uint8 fixed-point path (PRECISION_BITS = 22) and OpenCV's
// INTER_AREA box filter; exactness is graded bit-exactly by
// ml/triposg-mobile/cpp/test/check_preprocess.py.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace triposg {

// Pillow resample filters (libImaging names).
enum class PillowFilter { kLanczos, kBicubic };

// Bit-exact-intent port of Pillow's Resample.c uint8 path (horizontal
// then vertical, fixed-point, clipped). Planar per band; any sizes.
// When premultiply_alpha is true and channels == 4, replicates
// Image.resize on RGBA (Image.py): RGBA->RGBa premultiply (MULDIV255),
// straight resample of all four bands, RGBa->RGBA un-premultiply
// (truncating 255*c/a). From Convert.c rgbA2rgba / rgba2rgbA.
void ResamplePillow(const uint8_t* src, int sw, int sh, int channels,
                    uint8_t* dst, int dw, int dh, PillowFilter filter,
                    bool premultiply_alpha = false);

// Bit-exact-intent port of OpenCV INTER_AREA for 8-bit images.
void ResizeAreaU8(const uint8_t* src, int sw, int sh, int channels,
                  uint8_t* dst, int dw, int dh);

// Pillow paste-with-L-mask composite over transparent black (Paste.c
// paste_mask_L image32 branch). rgb is W*H RGB, mask W*H L, rgba W*H
// RGBA out.
void CompositeCutout(const uint8_t* rgb, const uint8_t* mask, int w, int h,
                     uint8_t* rgba);

// transformers resize-target size + center-crop offsets for a W*H
// canvas (shortest edge 256, crop 224).
void Dinov2Geometry(int w, int h, int& nw, int& nh, int& ox, int& oy);

// Row-major RGBA bytes.
struct RgbaImage {
  int w = 0;
  int h = 0;
  std::vector<uint8_t> px;  // 4*w*h
};

// Row-major float RGB in [0, 1].
struct RgbFloat {
  int w = 0;
  int h = 0;
  std::vector<float> px;  // 3*w*h
};

// TripoSG's is_valid_alpha rule (scripts/image_process.py): >= 1% of
// pixels in the lowest and highest of 20 histogram bins over [0, 256).
// Decides whether an input already has a usable alpha channel, in which
// case background removal is skipped (same rule the golden notebook used
// before calling rembg).
bool HasValidAlpha(const RgbaImage& img);

// cv2 INTER_AREA downscale to a 2000-px long side (copy if smaller).
// Port of the load_image block; operates on all 4 channels.
RgbaImage Downscale2000(const RgbaImage& rgba);

// rembg u2net background removal on ORT CPU. query_u2net_nchw is called
// once with the (1,3,320,320) NCHW input and must fill the session's
// single output (channel 0 = mask logits). Returns premultiplied RGBA
// (naive_cutout: BLEND with transparent black, alpha = mask).
RgbaImage RemoveBackgroundU2net(
    const uint8_t* rgb, int w, int h,
    void (*query_u2net_nchw)(const float* nchw, float* out, int out_n,
                             void* user),
    void* user);

// TripoSG prepare_image, valid-alpha branch (bg white, padding 0.1).
// Returns the float RGB canvas (out_w = bw + 2*pad_l, out_h = bh +
// 2*pad_t — NOT forced square: int() truncation leaves the sides one px
// apart when |bw-bh| is odd, exactly like F.pad); out_u8 is the (x*255)
// truncation matching prepared_input.png. Returns an empty image when
// the alpha channel is fully zero ("input image too small").
RgbFloat PrepareImage(const RgbaImage& rgba, const float bg[3],
                      std::vector<uint8_t>& out_u8);

// DINOv2 pixel_values (1,3,224,224) from the uint8 prepared canvas
// (any W,H: shortest edge -> 256, center crop 224).
// Takes bytes (not the float canvas) on purpose: the golden data flow is
// prepared_input.png -> BitImageProcessor, i.e. the processor always sees
// uint8 / 255, never the pre-truncation floats.
std::vector<float> Dinov2PixelValues(const uint8_t* rgb, int w, int h);

// Reads/writes C-order uint8 .npy (for the host parity test).
bool WriteNpyU8(const std::string& path, const std::vector<int64_t>& shape,
                const uint8_t* data);
bool ReadNpyU8(const std::string& path, std::vector<int64_t>& shape,
               std::vector<uint8_t>& data);
// Writes C-order float32 .npy (for the host parity test).
bool WriteNpyF32(const std::string& path, const std::vector<int64_t>& shape,
                 const float* data);

}  // namespace triposg
