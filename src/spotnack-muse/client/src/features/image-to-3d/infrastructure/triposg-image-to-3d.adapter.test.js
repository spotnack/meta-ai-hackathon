import { Platform } from "react-native";

import {
  ImageTo3dCancelledError,
  ImageTo3dUnavailableError,
} from "../domain/image-to-3d-conversion.entity";
import {
  attachToTripoSGJob,
  copyCompletedDisplayMesh,
  triposgImageTo3dAdapter,
} from "./triposg-image-to-3d.adapter";

jest.mock(
  "@spotnack/triposg",
  () => {
    const subscription = () => ({ remove: jest.fn() });
    return {
      addDoneListener: jest.fn().mockImplementation(subscription),
      addErrorListener: jest.fn().mockImplementation(subscription),
      addProgressListener: jest.fn().mockImplementation(subscription),
      cancel: jest.fn(),
      clearJob: jest.fn().mockResolvedValue(true),
      convert: jest.fn(),
      getStatus: jest.fn(),
    };
  },
  { virtual: true },
);

jest.mock("expo-file-system", () => {
  const copied = [];
  const deleted = [];
  const cannedBytes = new Map();
  /** In-memory stand-in for expo-file-system Directory. */
  class FakeDirectory {
    /**
     * Records the cache subdirectory.
     * @param {object} parent - Parent directory (Paths.cache).
     * @param {string} name - Subdirectory name.
     */
    constructor(parent, name) {
      this.parent = parent;
      this.name = name;
    }

    /**
     * Always present in tests.
     * @returns {boolean} True.
     */
    get exists() {
      return true;
    }

    /** No-op in tests. */
    create() {}
  }
  /** In-memory stand-in for expo-file-system File, recording copies. */
  class FakeFile {
    /**
     * Wraps either a URI string or a (directory, name) pair.
     * @param {string|object} first - URI or parent directory.
     * @param {string} [second] - File name when first is a directory.
     */
    constructor(first, second) {
      this.uri =
        second === undefined
          ? first
          : `file:///cache/${first.name}/${second}`;
      this.exists = true;
    }

    /**
     * Records the copy instead of writing.
     * @param {object} dest - Destination file.
     * @returns {Promise<void>} Immediately resolved.
     */
    async copy(dest) {
      copied.push([this.uri, dest.uri]);
    }

    /** Records the deletion. */
    delete() {
      deleted.push(this.uri);
    }

    /**
     * Returns canned bytes, or rejects like a missing file.
     * @returns {Promise<ArrayBuffer>} The canned content.
     */
    async arrayBuffer() {
      if (!cannedBytes.has(this.uri)) {
        throw new Error("file does not exist");
      }
      return cannedBytes.get(this.uri).buffer.slice(0);
    }

    /**
     * Opens a read handle over the canned bytes, or throws like a missing file.
     * @returns {{size: number, readBytes: function(number): Promise<Uint8Array>, close: function(): void}} Handle.
     */
    open() {
      if (!cannedBytes.has(this.uri)) {
        throw new Error("file does not exist");
      }
      const bytes = cannedBytes.get(this.uri);
      let offset = 0;
      return {
        size: bytes.length,
        async readBytes(length) {
          const chunk = bytes.slice(offset, offset + length);
          offset += chunk.length;
          return chunk;
        },
        close() {},
      };
    }
  }
  return {
    Directory: FakeDirectory,
    File: FakeFile,
    FileMode: { ReadOnly: "r" },
    Paths: { cache: { name: "cache" } },
    __copied: copied,
    __deleted: deleted,
    __cannedBytes: cannedBytes,
  };
});

jest.mock("expo-crypto", () => ({
  randomUUID: () => "test-uuid",
}));

const loadNative = () => require("@spotnack/triposg");
const loadFs = () => require("expo-file-system");

const DISPLAY_URI = "file:///native/mesh.display.glb";
const FULL_URI = "file:///native/mesh.glb";

// Minimal byte-valid GLB: magic + version 2 + self-consistent length.
const validGlb = (length = 20) => {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, length, true);
  if (length >= 20) {
    view.setUint32(12, 0, true);
    view.setUint32(16, 0x4e4f534a, true);
  }
  return bytes;
};

const canMeshes = (
  displayUri = DISPLAY_URI,
  fullUri = FULL_URI,
  displayBytes = validGlb(),
  fullBytes = validGlb(24),
) => {
  loadFs().__cannedBytes.set(displayUri, displayBytes);
  loadFs().__cannedBytes.set(fullUri, fullBytes);
};

const listenersOf = (kind) =>
  loadNative()[kind].mock.calls.map(([fn]) => fn);

// The adapter subscribes after awaiting getStatus + convert; wait until
// the subscriptions exist before emitting native events.
const waitForSubscriptions = async () => {
  for (let i = 0; i < 100 && listenersOf("addDoneListener").length === 0; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const nativeThrow = (fn, err) => loadNative()[fn].mockRejectedValue(err);
const nativeResolve = (fn, value) => loadNative()[fn].mockResolvedValue(value);

beforeEach(() => {
  jest.clearAllMocks();
  loadFs().__copied.length = 0;
  loadFs().__deleted.length = 0;
  loadFs().__cannedBytes.clear();
  canMeshes();
  Platform.OS = "android";
});

const readyStatus = () =>
  nativeResolve("getStatus", {
    supported: true,
    reason: "SM8750 + HTP ready",
    modelDir: "/models/v1",
    modelVersion: "v1",
    modelsVerified: true,
  });

const convertRequest = (overrides = {}) => ({
  image: { uri: "file:///photo.jpg", width: 800, height: 800 },
  ...overrides,
});

describe("triposg-image-to-3d.adapter", () => {
  test("maps native stage labels and the sampling step counter", async () => {
    readyStatus();
    nativeResolve("convert", "job-1");
    const seen = [];
    const pending = triposgImageTo3dAdapter.convertImageTo3d(
      convertRequest({ onProgress: (p) => seen.push(p) }),
    );
    await waitForSubscriptions();
    listenersOf("addProgressListener").forEach((fn) =>
      fn({ jobId: "other", fraction: 0.5, label: "Generating geometry" }),
    );
    expect(seen).toEqual([]);
    listenersOf("addProgressListener").forEach((fn) => {
      fn({ jobId: "job-1", fraction: 0.005, label: "Isolating subject" });
      fn({ jobId: "job-1", fraction: 0.5, label: "Generating geometry" });
      fn({ jobId: "job-1", fraction: 0.96, label: "Extracting mesh" });
      fn({ jobId: "job-1", fraction: 0.998, label: "Writing model" });
    });
    expect(seen.map((p) => p.label)).toEqual([
      "Removing background",
      "Generating shape (step 26/50)",
      "Building mesh",
      "Simplifying",
    ]);
    listenersOf("addDoneListener").forEach((fn) =>
      fn({ jobId: "job-1", displayMeshUri: DISPLAY_URI, meshUri: FULL_URI }),
    );
    await pending;
  });

  test("copies the display mesh into the cache and reports the generator", async () => {
    readyStatus();
    nativeResolve("convert", "job-1");
    const pending = triposgImageTo3dAdapter.convertImageTo3d(convertRequest());
    await waitForSubscriptions();
    listenersOf("addDoneListener").forEach((fn) =>
      fn({ jobId: "job-1", displayMeshUri: DISPLAY_URI, meshUri: FULL_URI }),
    );
    const result = await pending;
    expect(loadFs().__copied).toEqual([
      ["file:///native/mesh.display.glb", "file:///cache/image-to-3d/test-uuid.glb"],
    ]);
    expect(result).toEqual({
      model: { uri: "file:///cache/image-to-3d/test-uuid.glb", format: "glb" },
      generator: "triposg@2c1c516d+qnn-htp-fp16",
    });
  });

  test("abort cancels the native job and rejects cancelled", async () => {
    readyStatus();
    nativeResolve("convert", "job-1");
    const controller = new AbortController();
    const pending = triposgImageTo3dAdapter.convertImageTo3d(
      convertRequest({ signal: controller.signal }),
    );
    await waitForSubscriptions();
    controller.abort();
    listenersOf("addErrorListener").forEach((fn) =>
      fn({ jobId: "job-1", code: "cancelled", message: "stopped" }),
    );
    await expect(pending).rejects.toBeInstanceOf(ImageTo3dCancelledError);
    expect(loadNative().cancel).toHaveBeenCalledWith("job-1");
  });

  test("a pre-aborted signal never starts a job", async () => {
    readyStatus();
    const controller = new AbortController();
    controller.abort();
    await expect(
      triposgImageTo3dAdapter.convertImageTo3d(
        convertRequest({ signal: controller.signal }),
      ),
    ).rejects.toBeInstanceOf(ImageTo3dCancelledError);
    expect(loadNative().convert).not.toHaveBeenCalled();
  });

  test("native failure rejects with the native message", async () => {
    readyStatus();
    nativeResolve("convert", "job-1");
    const pending = triposgImageTo3dAdapter.convertImageTo3d(convertRequest());
    await waitForSubscriptions();
    listenersOf("addErrorListener").forEach((fn) =>
      fn({ jobId: "job-1", code: "failed", message: "HTP session failed" }),
    );
    await expect(pending).rejects.toThrow("HTP session failed");
  });

  test("unsupported device rejects unavailable/unsupported", async () => {
    nativeResolve("getStatus", {
      supported: false,
      reason: "needs Snapdragon 8 Elite (SM8750)",
      modelDir: null,
      modelVersion: null,
      modelsVerified: null,
    });
    const err = await triposgImageTo3dAdapter
      .convertImageTo3d(convertRequest())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ImageTo3dUnavailableError);
    expect(err.code).toBe("unsupported");
    expect(loadNative().convert).not.toHaveBeenCalled();
  });

  test("missing models reject unavailable/models-missing", async () => {
    nativeResolve("getStatus", {
      supported: true,
      reason: "ready",
      modelDir: null,
      modelVersion: null,
      modelsVerified: false,
    });
    const err = await triposgImageTo3dAdapter
      .convertImageTo3d(convertRequest())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ImageTo3dUnavailableError);
    expect(err.code).toBe("models-missing");
    expect(loadNative().convert).not.toHaveBeenCalled();
  });

  test("a lost delete race at convert maps to models-missing", async () => {
    readyStatus();
    nativeThrow("convert", new Error("models incomplete: head/model.bin"));
    const err = await triposgImageTo3dAdapter
      .convertImageTo3d(convertRequest())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ImageTo3dUnavailableError);
    expect(err.code).toBe("models-missing");
  });

  test("non-Android rejects unavailable without touching native", async () => {
    Platform.OS = "ios";
    const err = await triposgImageTo3dAdapter
      .convertImageTo3d(convertRequest())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ImageTo3dUnavailableError);
    expect(err.code).toBe("unsupported");
    expect(loadNative().getStatus).not.toHaveBeenCalled();
  });

  test("convert persists the save context for a relaunch", async () => {
    readyStatus();
    nativeResolve("convert", "job-1");
    const pending = triposgImageTo3dAdapter.convertImageTo3d(
      convertRequest({
        image: {
          uri: "file:///photo.jpg",
          width: 800,
          height: 600,
          fileName: "photo.jpg",
        },
      }),
    );
    await waitForSubscriptions();
    listenersOf("addDoneListener").forEach((fn) =>
      fn({ jobId: "job-1", displayMeshUri: DISPLAY_URI, meshUri: FULL_URI }),
    );
    await pending;
    expect(loadNative().convert).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUri: "file:///photo.jpg",
        fileName: "photo.jpg",
        imageWidth: 800,
        imageHeight: 600,
      }),
    );
  });

  test("a finished job clears its persisted record", async () => {
    readyStatus();
    nativeResolve("convert", "job-1");
    const pending = triposgImageTo3dAdapter.convertImageTo3d(convertRequest());
    await waitForSubscriptions();
    listenersOf("addDoneListener").forEach((fn) =>
      fn({ jobId: "job-1", displayMeshUri: DISPLAY_URI, meshUri: FULL_URI }),
    );
    await pending;
    expect(loadNative().clearJob).toHaveBeenCalledWith("job-1");
  });

  test("attachToTripoSGJob follows a running job without starting one", async () => {
    const seen = [];
    const pending = attachToTripoSGJob({
      jobId: "job-9",
      steps: 50,
      onProgress: (p) => seen.push(p),
      signal: null,
    });
    await waitForSubscriptions();
    expect(loadNative().convert).not.toHaveBeenCalled();
    listenersOf("addProgressListener").forEach((fn) =>
      fn({ jobId: "job-9", fraction: 0.5, label: "Generating geometry" }),
    );
    listenersOf("addDoneListener").forEach((fn) =>
      fn({ jobId: "job-9", displayMeshUri: DISPLAY_URI, meshUri: FULL_URI }),
    );
    const result = await pending;
    expect(seen.map((p) => p.label)).toEqual(["Generating shape (step 26/50)"]);
    expect(result.generator).toBe("triposg@2c1c516d+qnn-htp-fp16");
    expect(loadNative().clearJob).toHaveBeenCalledWith("job-9");
  });

  test("attach abort cancels the job and rejects cancelled", async () => {
    const controller = new AbortController();
    const pending = attachToTripoSGJob({
      jobId: "job-9",
      steps: 50,
      onProgress: null,
      signal: controller.signal,
    });
    await waitForSubscriptions();
    controller.abort();
    listenersOf("addErrorListener").forEach((fn) =>
      fn({ jobId: "job-9", code: "cancelled", message: "stopped" }),
    );
    await expect(pending).rejects.toBeInstanceOf(ImageTo3dCancelledError);
    expect(loadNative().cancel).toHaveBeenCalledWith("job-9");
  });

  test("copyCompletedDisplayMesh copies and reports GLB", async () => {
    const model = await copyCompletedDisplayMesh("file:///jobs/job-1/mesh.display.glb");
    expect(loadFs().__copied).toEqual([
      ["file:///jobs/job-1/mesh.display.glb", "file:///cache/image-to-3d/test-uuid.glb"],
    ]);
    expect(model).toEqual({
      uri: "file:///cache/image-to-3d/test-uuid.glb",
      format: "glb",
    });
  });
});

describe("assertValidGlb", () => {
  const { assertValidGlb, assertValidJobMeshes } = require("./triposg-image-to-3d.adapter");

  test("a byte-valid GLB passes", async () => {
    await expect(assertValidGlb(DISPLAY_URI, "display mesh")).resolves.toBeUndefined();
  });

  test("a missing file fails as missing", async () => {
    await expect(assertValidGlb("file:///nope.glb", "display mesh")).rejects.toThrow(
      "missing or unreadable",
    );
  });

  test("a bad magic fails as corrupt", async () => {
    const bad = validGlb();
    bad[0] = 0x00;
    loadFs().__cannedBytes.set("file:///bad.glb", bad);
    await expect(assertValidGlb("file:///bad.glb", "display mesh")).rejects.toThrow(
      "incomplete or corrupt",
    );
  });

  test("a truncated file fails on length", async () => {
    const truncated = validGlb(32).slice(0, 20);
    loadFs().__cannedBytes.set("file:///cut.glb", truncated);
    await expect(assertValidGlb("file:///cut.glb", "full mesh")).rejects.toThrow(
      "incomplete or corrupt",
    );
  });

  test("assertValidJobMeshes needs both files", async () => {
    await expect(
      assertValidJobMeshes({ displayMeshUri: DISPLAY_URI, meshUri: null }),
    ).rejects.toThrow("Model files are missing.");
    await expect(
      assertValidJobMeshes({ displayMeshUri: DISPLAY_URI, meshUri: FULL_URI }),
    ).resolves.toBeUndefined();
  });

  test("a done event with broken outputs rejects instead of saving", async () => {
    const broken = validGlb();
    broken[1] = 0x00;
    loadFs().__cannedBytes.set("file:///broken.glb", broken);
    const pending = attachToTripoSGJob({
      jobId: "job-9",
      steps: 50,
      onProgress: null,
      signal: null,
    });
    await waitForSubscriptions();
    listenersOf("addDoneListener").forEach((fn) =>
      fn({ jobId: "job-9", displayMeshUri: "file:///broken.glb", meshUri: FULL_URI }),
    );
    await expect(pending).rejects.toThrow("incomplete or corrupt");
    expect(loadFs().__copied).toEqual([]);
  });
});
