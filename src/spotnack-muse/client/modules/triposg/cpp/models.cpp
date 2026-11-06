// See models.h.
#include "models.h"

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>

namespace triposg {
namespace {

// Minimal JSON reader: enough for the manifest shape we write (string
// fields, one files[] array of flat objects, integers). Not a general
// JSON parser; make_model_manifest.py owns the writer side.
struct Cursor {
  const char* p = nullptr;
  const char* end = nullptr;
  bool eof() const { return p >= end; }
  void skip_ws() {
    while (!eof() && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r'))
      ++p;
  }
  bool lit(char c) {
    skip_ws();
    if (!eof() && *p == c) {
      ++p;
      return true;
    }
    return false;
  }
  bool str(std::string& out) {
    skip_ws();
    if (eof() || *p != '"') return false;
    ++p;
    out.clear();
    while (!eof() && *p != '"') {
      if (*p == '\\' && p + 1 < end) {
        ++p;
        switch (*p) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          default: out += *p; break;
        }
        ++p;
      } else {
        out += *p++;
      }
    }
    if (eof()) return false;
    ++p;
    return true;
  }
  bool integer(long long& out) {
    skip_ws();
    if (eof() || (!std::isdigit(*p) && *p != '-')) return false;
    bool neg = false;
    if (*p == '-') {
      neg = true;
      ++p;
    }
    long long v = 0;
    while (!eof() && std::isdigit(*p)) v = v * 10 + (*p++ - '0');
    out = neg ? -v : v;
    return true;
  }
  // Skips one arbitrary JSON value.
  bool skip_value() {
    skip_ws();
    if (eof()) return false;
    if (*p == '"') {
      std::string s;
      return str(s);
    }
    if (*p == '{') {
      ++p;
      if (lit('}')) return true;
      while (true) {
        std::string k;
        if (!str(k) || !lit(':') || !skip_value()) return false;
        if (lit('}')) return true;
        if (!lit(',')) return false;
      }
    }
    if (*p == '[') {
      ++p;
      if (lit(']')) return true;
      while (true) {
        if (!skip_value()) return false;
        if (lit(']')) return true;
        if (!lit(',')) return false;
      }
    }
    long long v;
    if (integer(v)) return true;
    // true/false/null/double: skip to the next delimiter.
    while (!eof() && *p != ',' && *p != '}' && *p != ']') ++p;
    return true;
  }
};

// Public-domain-style SHA-256 (single file, no dependencies).
struct Sha256 {
  uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  uint64_t total = 0;
  uint8_t buf[64] = {0};
  size_t buffered = 0;
  static uint32_t Ror(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
  void Block(const uint8_t* p) {
    static const uint32_t k[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
        0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
        0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
    uint32_t w[64];
    for (int i = 0; i < 16; ++i)
      w[i] = (uint32_t(p[i * 4]) << 24) | (uint32_t(p[i * 4 + 1]) << 16) |
             (uint32_t(p[i * 4 + 2]) << 8) | uint32_t(p[i * 4 + 3]);
    for (int i = 16; i < 64; ++i) {
      uint32_t s0 = Ror(w[i - 15], 7) ^ Ror(w[i - 15], 18) ^ (w[i - 15] >> 3);
      uint32_t s1 = Ror(w[i - 2], 17) ^ Ror(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5],
             g = h[6], hh = h[7];
    for (int i = 0; i < 64; ++i) {
      uint32_t s1 = Ror(e, 6) ^ Ror(e, 11) ^ Ror(e, 25);
      uint32_t ch = (e & f) ^ (~e & g);
      uint32_t t1 = hh + s1 + ch + k[i] + w[i];
      uint32_t s0 = Ror(a, 2) ^ Ror(a, 13) ^ Ror(a, 22);
      uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
      uint32_t t2 = s0 + mj;
      hh = g;
      g = f;
      f = e;
      e = d + t1;
      d = c;
      c = b;
      b = a;
      a = t1 + t2;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }

 public:
  void Update(const uint8_t* p, size_t n, std::atomic<bool>* cancel,
              bool* cancelled) {
    total += n;
    while (n > 0) {
      if (cancel && cancel->load()) {
        if (cancelled) *cancelled = true;
        return;
      }
      size_t take = std::min(n, 64 - buffered);
      std::memcpy(buf + buffered, p, take);
      buffered += take;
      p += take;
      n -= take;
      if (buffered == 64) {
        Block(buf);
        buffered = 0;
      }
    }
  }
  std::string Finish() {
    uint64_t bits = total * 8;
    uint8_t pad = 0x80;
    Update(&pad, 1, nullptr, nullptr);
    uint8_t zero = 0;
    while (buffered != 56) Update(&zero, 1, nullptr, nullptr);
    uint8_t len[8];
    for (int i = 0; i < 8; ++i) len[i] = uint8_t(bits >> (56 - 8 * i));
    Update(len, 8, nullptr, nullptr);
    char hex[65];
    for (int i = 0; i < 8; ++i)
      std::snprintf(hex + i * 8, 9, "%08x", h[i]);
    return std::string(hex, 64);
  }
};

bool HashFile(const std::string& path, std::string& hex,
              std::atomic<bool>& cancel) {
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) return false;
  Sha256 sha;
  bool cancelled = false;
  uint8_t chunk[1 << 20];
  size_t n;
  while ((n = std::fread(chunk, 1, sizeof(chunk), f)) > 0) {
    sha.Update(chunk, n, &cancel, &cancelled);
    if (cancelled) break;
  }
  std::fclose(f);
  if (cancelled) return false;
  hex = sha.Finish();
  return true;
}

}  // namespace

bool LoadManifest(const std::string& dir, ModelManifest& manifest,
                  std::string& error) {
  const std::string path = dir + "/models_manifest.json";
  FILE* f = std::fopen(path.c_str(), "rb");
  if (!f) {
    error = "missing " + path;
    return false;
  }
  std::fseek(f, 0, SEEK_END);
  long size = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  std::string raw(size, '\0');
  if (std::fread(raw.data(), 1, raw.size(), f) != raw.size()) {
    std::fclose(f);
    error = "short read " + path;
    return false;
  }
  std::fclose(f);
  Cursor c{raw.data(), raw.data() + raw.size()};
  manifest = ModelManifest{};
  if (!c.lit('{')) {
    error = "bad manifest root";
    return false;
  }
  while (true) {
    if (c.lit('}')) break;
    std::string key;
    if (!c.str(key) || !c.lit(':')) {
      error = "bad manifest entry";
      return false;
    }
    if (key == "version") {
      if (!c.str(manifest.version)) {
        error = "bad version";
        return false;
      }
    } else if (key == "total_bytes") {
      if (!c.integer(manifest.total_bytes)) {
        error = "bad total_bytes";
        return false;
      }
    } else if (key == "files") {
      if (!c.lit('[')) {
        error = "bad files array";
        return false;
      }
      if (c.lit(']')) continue;
      while (true) {
        ModelFile mf;
        if (!c.lit('{')) {
          error = "bad file entry";
          return false;
        }
        while (true) {
          if (c.lit('}')) break;
          std::string fk;
          if (!c.str(fk) || !c.lit(':')) {
            error = "bad file field";
            return false;
          }
          if (fk == "path") {
            if (!c.str(mf.path)) {
              error = "bad file path";
              return false;
            }
          } else if (fk == "bytes") {
            if (!c.integer(mf.bytes)) {
              error = "bad file bytes";
              return false;
            }
          } else if (fk == "sha256") {
            if (!c.str(mf.sha256)) {
              error = "bad file sha256";
              return false;
            }
          } else if (!c.skip_value()) {
            error = "bad file field value";
            return false;
          }
          if (c.lit('}')) break;
          if (!c.lit(',')) {
            error = "bad file entry separator";
            return false;
          }
        }
        if (mf.path.empty() || mf.bytes <= 0 || mf.sha256.empty()) {
          error = "incomplete file entry";
          return false;
        }
        manifest.files.push_back(mf);
        if (c.lit(']')) break;
        if (!c.lit(',')) {
          error = "bad files separator";
          return false;
        }
      }
    } else if (!c.skip_value()) {
      error = "bad manifest value";
      return false;
    }
    if (c.lit('}')) break;
    if (!c.lit(',')) {
      error = "bad manifest separator";
      return false;
    }
  }
  if (manifest.files.empty()) {
    error = "manifest lists no files";
    return false;
  }
  return true;
}

bool VerifyModels(const std::string& dir, const ModelManifest& manifest,
                  bool full_hash,
                  const std::function<void(int, int, const std::string&)>&
                      progress,
                  std::atomic<bool>& cancel, std::string& error) {
  const int total = static_cast<int>(manifest.files.size());
  for (int i = 0; i < total; ++i) {
    if (cancel.load()) {
      error = "cancelled";
      return false;
    }
    const ModelFile& mf = manifest.files[i];
    const std::string full = dir + "/" + mf.path;
    if (progress) progress(i, total, mf.path);
    struct stat st;
    if (::stat(full.c_str(), &st) != 0) {
      error = "missing " + mf.path;
      return false;
    }
    if (st.st_size != mf.bytes) {
      char msg[256];
      std::snprintf(msg, sizeof(msg),
                    "size mismatch %s: got %lld want %lld", mf.path.c_str(),
                    static_cast<long long>(st.st_size), mf.bytes);
      error = msg;
      return false;
    }
    if (full_hash) {
      std::string hex;
      if (!HashFile(full, hex, cancel)) {
        error = cancel.load() ? "cancelled" : "unreadable " + mf.path;
        return false;
      }
      if (hex != mf.sha256) {
        error = "sha256 mismatch " + mf.path;
        return false;
      }
    }
  }
  if (progress) progress(total, total, "");
  return true;
}

}  // namespace triposg
