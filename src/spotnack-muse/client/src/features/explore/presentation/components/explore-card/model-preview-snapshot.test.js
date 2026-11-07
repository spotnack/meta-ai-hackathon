jest.mock("expo-gl", () => ({
  GLView: { takeSnapshotAsync: jest.fn() },
}));

const mockFiles = new Map();
jest.mock("expo-file-system", () => ({
  File: class {
    /**
     * @param {string} uri - File URI.
     */
    constructor(uri) {
      this.uri = uri;
    }

    /**
     * @returns {boolean} Whether the fake file exists.
     */
    get exists() {
      return mockFiles.has(this.uri);
    }

    /**
     * @param {{uri: string}} target - Destination file.
     */
    async move(target) {
      mockFiles.delete(this.uri);
      mockFiles.set(target.uri, true);
    }
  },
}));

beforeEach(() => {
  jest.resetModules();
  mockFiles.clear();
});

const load = () => ({
  gl: require("expo-gl"),
  previews: require("./model-preview-snapshot"),
});

describe("model preview snapshots", () => {
  test("saves the frame once and tells subscribers", async () => {
    const { gl, previews } = load();
    gl.GLView.takeSnapshotAsync.mockResolvedValue({ uri: "file:///cache/snap.png" });
    mockFiles.set("file:///cache/snap.png", true);
    const listener = jest.fn();
    previews.subscribeModelPreviews(listener);

    const target = "file:///shapes/1/preview.png";
    await expect(previews.saveModelPreview({}, target)).resolves.toBe(target);
    expect(mockFiles.has(target)).toBe(true);
    expect(listener).toHaveBeenCalledWith(target, target);
    expect(previews.getSavedModelPreview(target)).toBe(target);

    // A second render of the same creation does not snapshot again.
    await expect(previews.saveModelPreview({}, target)).resolves.toBeNull();
    expect(gl.GLView.takeSnapshotAsync).toHaveBeenCalledTimes(1);
  });

  test("a failed snapshot is logged, not thrown", async () => {
    const { gl, previews } = load();
    gl.GLView.takeSnapshotAsync.mockRejectedValue(new Error("no context"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      previews.saveModelPreview({}, "file:///shapes/2/preview.png"),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("no target or context means nothing to save", async () => {
    const { gl, previews } = load();
    await expect(previews.saveModelPreview(null, "file:///x.png")).resolves.toBeNull();
    await expect(previews.saveModelPreview({}, null)).resolves.toBeNull();
    expect(gl.GLView.takeSnapshotAsync).not.toHaveBeenCalled();
  });
});
