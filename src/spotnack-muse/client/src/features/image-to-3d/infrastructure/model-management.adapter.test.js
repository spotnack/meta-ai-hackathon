import { MODEL_STATUS } from "../domain/model-management.port";

jest.mock(
  "@spotnack/triposg",
  () => ({
    deleteModels: jest.fn(),
    downloadPreflight: jest.fn(),
    getDownloadProgress: jest.fn(),
    getStatus: jest.fn(),
    pauseDownload: jest.fn(),
    startDownload: jest.fn(),
    verifyModels: jest.fn(),
  }),
  { virtual: true },
);

const MANIFEST_TOTAL = 7436843245;

const loadAll = () => {
  const native = require("@spotnack/triposg");
  const { modelManagementAdapter } = require("./model-management.adapter");
  // Error classes must come from the same module instance the adapter
  // sees (jest.resetModules duplicates the registry per test).
  const port = require("../domain/model-management.port");
  return { native, modelManagementAdapter, port };
};

const supportedStatus = (overrides = {}) => ({
  supported: true,
  reason: "SM8750 + HTP ready",
  modelDir: "/models/v1-fp32-50step",
  modelVersion: "v1-fp32-50step",
  modelsVerified: false,
  ...overrides,
});

beforeEach(() => {
  jest.resetModules();
  process.env.EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL =
    "https://example.com/triposg-models";
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL;
});

describe("model-management state machine", () => {
  test("a web build without the module is unsupported", async () => {
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockRejectedValue(new Error("no native module"));
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: 0,
      totalBytes: MANIFEST_TOTAL,
    });
    const state = await modelManagementAdapter.getState();
    expect(state.status).toBe(MODEL_STATUS.UNSUPPORTED);
  });

  test("an unsupported phone reports the native reason", async () => {
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockResolvedValue({
      supported: false,
      reason: "needs Snapdragon 8 Elite (SM8750)",
      modelDir: null,
      modelVersion: null,
      modelsVerified: null,
    });
    const state = await modelManagementAdapter.getState();
    expect(state).toMatchObject({
      status: MODEL_STATUS.UNSUPPORTED,
      reason: "needs Snapdragon 8 Elite (SM8750)",
    });
  });

  test("size-verified models are installed", async () => {
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus({ modelsVerified: true }));
    const state = await modelManagementAdapter.getState();
    expect(state.status).toBe(MODEL_STATUS.INSTALLED);
    expect(state.downloadedBytes).toBe(state.totalBytes);
  });

  test("an empty disk is not-installed (no sideload hint with a base URL)", async () => {
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus());
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: 0,
      totalBytes: MANIFEST_TOTAL,
    });
    const state = await modelManagementAdapter.getState();
    expect(state).toMatchObject({
      status: MODEL_STATUS.NOT_INSTALLED,
      reason: null,
    });
  });

  test("an empty disk without a base URL carries the sideload hint", async () => {
    delete process.env.EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL;
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus());
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: 0,
      totalBytes: MANIFEST_TOTAL,
    });
    const state = await modelManagementAdapter.getState();
    expect(state.status).toBe(MODEL_STATUS.NOT_INSTALLED);
    expect(state.reason).toMatch("sideload");
  });

  test("partial bytes on disk are paused (restart-safe)", async () => {
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus());
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: 1024,
      totalBytes: MANIFEST_TOTAL,
    });
    const state = await modelManagementAdapter.getState();
    expect(state).toMatchObject({
      status: MODEL_STATUS.PAUSED,
      downloadedBytes: 1024,
    });
  });

  test("startDownload without a base URL needs sideloading", async () => {
    delete process.env.EXPO_PUBLIC_TRIPOSG_MODEL_BASE_URL;
    const { modelManagementAdapter, port } = loadAll();
    await expect(modelManagementAdapter.startDownload()).rejects.toBeInstanceOf(
      port.ModelSideloadRequiredError,
    );
  });

  test("a metered link needs explicit opt-in", async () => {
    const { native, modelManagementAdapter, port } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus());
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: 0,
      totalBytes: MANIFEST_TOTAL,
    });
    native.downloadPreflight.mockResolvedValue({
      metered: true,
      freeBytes: 100 * 1024 ** 3,
      enoughSpace: true,
    });
    await expect(modelManagementAdapter.startDownload()).rejects.toBeInstanceOf(
      port.ModelMeteredNetworkError,
    );
    expect(native.startDownload).not.toHaveBeenCalled();
    native.startDownload.mockResolvedValue({ status: "completed", problem: null });
    await modelManagementAdapter.startDownload({ allowMetered: true });
    expect(native.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://example.com/triposg-models",
      }),
    );
  });

  test("a full disk rejects with the byte counts", async () => {
    const { native, modelManagementAdapter, port } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus());
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: 0,
      totalBytes: MANIFEST_TOTAL,
    });
    native.downloadPreflight.mockResolvedValue({
      metered: false,
      freeBytes: 1024,
      enoughSpace: false,
    });
    const err = await modelManagementAdapter
      .startDownload()
      .catch((e) => e);
    expect(err).toBeInstanceOf(port.ModelSpaceError);
    expect(err.needBytes).toBe(MANIFEST_TOTAL);
    expect(err.freeBytes).toBe(1024);
    expect(native.startDownload).not.toHaveBeenCalled();
  });

  test("a failed full verification marks the set corrupt", async () => {
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus());
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: MANIFEST_TOTAL,
      totalBytes: MANIFEST_TOTAL,
    });
    native.verifyModels.mockResolvedValue({
      ok: false,
      problem: "head/model.bin: sha256 mismatch",
    });
    await modelManagementAdapter.verifyModels();
    expect(native.verifyModels).toHaveBeenCalledWith({ full: true });
    const state = await modelManagementAdapter.getState();
    expect(state).toMatchObject({
      status: MODEL_STATUS.CORRUPT,
      reason: "head/model.bin: sha256 mismatch",
    });
  });

  test("retrying a corrupt set wipes it before downloading", async () => {
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus());
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: MANIFEST_TOTAL,
      totalBytes: MANIFEST_TOTAL,
    });
    native.verifyModels.mockResolvedValue({ ok: false, problem: "bad file" });
    await modelManagementAdapter.verifyModels();
    native.downloadPreflight.mockResolvedValue({
      metered: false,
      freeBytes: 100 * 1024 ** 3,
      enoughSpace: true,
    });
    native.startDownload.mockResolvedValue({ status: "completed", problem: null });
    await modelManagementAdapter.startDownload();
    expect(native.deleteModels).toHaveBeenCalledWith(
      expect.objectContaining({}),
    );
    expect(native.startDownload).toHaveBeenCalled();
  });

  test("pause signals the native worker and delete clears the set", async () => {
    const { native, modelManagementAdapter } = loadAll();
    native.getStatus.mockResolvedValue(supportedStatus());
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: 512,
      totalBytes: MANIFEST_TOTAL,
    });
    native.pauseDownload.mockResolvedValue(true);
    const paused = await modelManagementAdapter.pauseDownload();
    expect(native.pauseDownload).toHaveBeenCalled();
    expect(paused.status).toBe(MODEL_STATUS.PAUSED);
    native.deleteModels.mockResolvedValue({ ok: true });
    native.getDownloadProgress.mockResolvedValue({
      downloadedBytes: 0,
      totalBytes: MANIFEST_TOTAL,
    });
    const cleared = await modelManagementAdapter.deleteModels();
    expect(native.deleteModels).toHaveBeenCalled();
    expect(cleared.status).toBe(MODEL_STATUS.NOT_INSTALLED);
  });

  test("formatBytes covers the status copy", () => {
    const { port } = loadAll();
    expect(port.formatBytes(MANIFEST_TOTAL)).toBe("6.9 GB");
    expect(port.formatBytes(0)).toBe("0.0 B");
    expect(port.formatBytes(1536)).toBe("1.5 KB");
  });
});
