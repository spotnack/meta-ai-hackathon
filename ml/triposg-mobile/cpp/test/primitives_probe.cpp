// CLI exercising the exact-port primitives on raw .npy uint8 input.
// Each op calls the real module code (same preprocess.cpp the device
// builds), so check_primitives.py grades the shipped code paths:
//
//   probe resize lanczos|bicubic IN.npy OUT.npy DW DH
//     IN (H,W,C) u8 -> ResamplePillow -> OUT (DH,DW,C) u8.
//     C==4 replicates Image.resize on RGBA (premultiplied-alpha round
//     trip), matching what the checker compares against.
//   probe composite SRC.npy MASK.npy OUT.npy
//     SRC (H,W,3) RGB + MASK (H,W) L -> OUT (H,W,4) RGBA
//   probe area IN.npy OUT.npy DW DH
//     IN (H,W,C) u8 -> ResizeAreaU8 -> OUT (DH,DW,C) u8
//   probe dinosize W H
//     prints "NW NH OX OY" (no files)
//   probe prepare CUTOUT.npy OUT.npy
//     (H,W,4) RGBA cutout -> PrepareImage (white bg) -> (H',W',3) u8
//   probe dinopixels PREPARED.npy OUT.npy
//     (H,W,3) u8 canvas -> Dinov2PixelValues -> float32 (1,3,224,224)
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

#include "preprocess.h"

namespace {

int Fail(const std::string& msg) {
  std::fprintf(stderr, "probe: %s\n", msg.c_str());
  return 1;
}

bool ReadU8(const std::string& path, std::vector<int64_t>& shape,
            std::vector<uint8_t>& data) {
  if (!triposg::ReadNpyU8(path, shape, data)) {
    std::fprintf(stderr, "probe: cannot read %s\n", path.c_str());
    return false;
  }
  return true;
}

int OpResize(int argc, char** argv) {
  // probe resize FILTER IN OUT DW DH
  if (argc != 7) return Fail("usage: probe resize lanczos|bicubic IN OUT DW DH");
  std::string filter = argv[2];
  triposg::PillowFilter f;
  if (filter == "lanczos") {
    f = triposg::PillowFilter::kLanczos;
  } else if (filter == "bicubic") {
    f = triposg::PillowFilter::kBicubic;
  } else {
    return Fail("unknown filter " + filter);
  }
  std::vector<int64_t> shape;
  std::vector<uint8_t> data;
  if (!ReadU8(argv[3], shape, data)) return 1;
  if (shape.size() != 3) return Fail("resize needs (H,W,C) input");
  const int sh = static_cast<int>(shape[0]), sw = static_cast<int>(shape[1]);
  const int ch = static_cast<int>(shape[2]);
  const int dw = std::atoi(argv[5]), dh = std::atoi(argv[6]);
  std::vector<uint8_t> out(static_cast<size_t>(dw) * dh * ch);
  triposg::ResamplePillow(data.data(), sw, sh, ch, out.data(), dw, dh, f,
                          ch == 4);
  if (!triposg::WriteNpyU8(argv[4], {dh, dw, ch}, out.data()))
    return Fail("cannot write output");
  return 0;
}

int OpComposite(int argc, char** argv) {
  // probe composite SRC.npy MASK.npy OUT.npy
  if (argc != 5) return Fail("usage: probe composite SRC MASK OUT");
  std::vector<int64_t> sshape, mshape;
  std::vector<uint8_t> sdata, mdata;
  if (!ReadU8(argv[2], sshape, sdata) || !ReadU8(argv[3], mshape, mdata))
    return 1;
  if (sshape.size() != 3 || sshape[2] != 3) return Fail("SRC must be (H,W,3)");
  if (mshape.size() != 2 || mshape[0] != sshape[0] || mshape[1] != sshape[1])
    return Fail("MASK must be (H,W) matching SRC");
  const int w = static_cast<int>(sshape[1]), h = static_cast<int>(sshape[0]);
  std::vector<uint8_t> out(static_cast<size_t>(w) * h * 4);
  triposg::CompositeCutout(sdata.data(), mdata.data(), w, h, out.data());
  if (!triposg::WriteNpyU8(argv[4], {h, w, 4}, out.data()))
    return Fail("cannot write output");
  return 0;
}

int OpArea(int argc, char** argv) {
  // probe area IN OUT DW DH
  if (argc != 6) return Fail("usage: probe area IN OUT DW DH");
  std::vector<int64_t> shape;
  std::vector<uint8_t> data;
  if (!ReadU8(argv[2], shape, data)) return 1;
  if (shape.size() != 3) return Fail("area needs (H,W,C) input");
  const int sh = static_cast<int>(shape[0]), sw = static_cast<int>(shape[1]);
  const int ch = static_cast<int>(shape[2]);
  const int dw = std::atoi(argv[4]), dh = std::atoi(argv[5]);
  std::vector<uint8_t> out(static_cast<size_t>(dw) * dh * ch);
  triposg::ResizeAreaU8(data.data(), sw, sh, ch, out.data(), dw, dh);
  if (!triposg::WriteNpyU8(argv[3], {dh, dw, ch}, out.data()))
    return Fail("cannot write output");
  return 0;
}

int OpDinosize(int argc, char** argv) {
  // probe dinosize W H -> prints "NW NH OX OY"
  if (argc != 4) return Fail("usage: probe dinosize W H");
  int nw = 0, nh = 0, ox = 0, oy = 0;
  triposg::Dinov2Geometry(std::atoi(argv[2]), std::atoi(argv[3]), nw, nh, ox,
                          oy);
  std::printf("%d %d %d %d\n", nw, nh, ox, oy);
  return 0;
}

int OpPrepare(int argc, char** argv) {
  // probe prepare CUTOUT.npy OUT.npy (white bg, like both flows)
  if (argc != 4) return Fail("usage: probe prepare CUTOUT OUT");
  std::vector<int64_t> shape;
  std::vector<uint8_t> data;
  if (!ReadU8(argv[2], shape, data)) return 1;
  if (shape.size() != 3 || shape[2] != 4)
    return Fail("CUTOUT must be (H,W,4)");
  triposg::RgbaImage cutout{static_cast<int>(shape[1]),
                            static_cast<int>(shape[0]), std::move(data)};
  const float kWhite[3] = {1.0f, 1.0f, 1.0f};
  std::vector<uint8_t> out_u8;
  triposg::RgbFloat out = triposg::PrepareImage(cutout, kWhite, out_u8);
  if (out.px.empty()) return Fail("empty canvas");
  if (!triposg::WriteNpyU8(argv[3], {out.h, out.w, 3}, out_u8.data()))
    return Fail("cannot write output");
  return 0;
}

int OpDinoPixels(int argc, char** argv) {
  // probe dinopixels PREPARED.npy OUT.npy -> float32 (1,3,224,224)
  if (argc != 4) return Fail("usage: probe dinopixels PREPARED OUT");
  std::vector<int64_t> shape;
  std::vector<uint8_t> data;
  if (!ReadU8(argv[2], shape, data)) return 1;
  if (shape.size() != 3 || shape[2] != 3)
    return Fail("PREPARED must be (H,W,3)");
  std::vector<float> pv = triposg::Dinov2PixelValues(
      data.data(), static_cast<int>(shape[1]), static_cast<int>(shape[0]));
  if (!triposg::WriteNpyF32(argv[3], {1, 3, 224, 224}, pv.data()))
    return Fail("cannot write output");
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr,
                 "usage: probe resize|composite|area|dinosize|prepare|"
                 "dinopixels ...\n");
    return 1;
  }
  std::string op = argv[1];
  // Shift so argv[2] is the first op arg in every handler.
  if (op == "resize") return OpResize(argc, argv);
  if (op == "composite") return OpComposite(argc, argv);
  if (op == "area") return OpArea(argc, argv);
  if (op == "dinosize") return OpDinosize(argc, argv);
  if (op == "prepare") return OpPrepare(argc, argv);
  if (op == "dinopixels") return OpDinoPixels(argc, argv);
  std::fprintf(stderr, "probe: unknown op %s\n", op.c_str());
  return 1;
}
