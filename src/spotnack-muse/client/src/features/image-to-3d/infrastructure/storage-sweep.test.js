import { Platform } from "react-native";

jest.mock(
  "@spotnack/triposg",
  () => ({
    deleteSweepPaths: jest.fn(),
    getStorageState: jest.fn(),
  }),
  { virtual: true },
);

const loadAll = () => {
  // Fresh registry per test (see beforeEach): the sweep module must come
  // from the same registry as the mocked native module, so both are
  // required here instead of imported at the top.
  const native = require("@spotnack/triposg");
  const sweep = require("./storage-sweep");
  return { native, sweep };
};

const doneRecord = (overrides = {}) => ({
  jobId: "job-done",
  status: "done",
  ...overrides,
});

beforeEach(() => {
  jest.resetModules();
});

describe("planStorageSweep", () => {
  test("keeps a done record's folder, deletes the other orphans", () => {
    const { sweep } = loadAll();
    expect(
      sweep.planStorageSweep({
        jobDirs: ["job-done", "job-old", "job-older"],
        record: doneRecord(),
        workerAlive: false,
        cacheDirs: [],
        debuggable: false,
      }),
    ).toEqual({ jobDirs: ["job-old", "job-older"], cacheDirs: [] });
  });

  test("no record deletes every job folder", () => {
    const { sweep } = loadAll();
    expect(
      sweep.planStorageSweep({
        jobDirs: ["a", "b"],
        record: null,
        workerAlive: false,
        cacheDirs: [],
        debuggable: false,
      }),
    ).toEqual({ jobDirs: ["a", "b"], cacheDirs: [] });
  });

  test("a live worker's running folder is kept", () => {
    const { sweep } = loadAll();
    expect(
      sweep.planStorageSweep({
        jobDirs: ["job-live", "job-old"],
        record: { jobId: "job-live", status: "running" },
        workerAlive: true,
        cacheDirs: [],
        debuggable: false,
      }),
    ).toEqual({ jobDirs: ["job-old"], cacheDirs: [] });
  });

  test("a dead running record keeps nothing (its leftovers are stale)", () => {
    const { sweep } = loadAll();
    expect(
      sweep.planStorageSweep({
        jobDirs: ["job-dead"],
        record: { jobId: "job-dead", status: "running" },
        workerAlive: false,
        cacheDirs: [],
        debuggable: false,
      }),
    ).toEqual({ jobDirs: ["job-dead"], cacheDirs: [] });
  });

  test("failed/cancelled records keep nothing", () => {
    const { sweep } = loadAll();
    for (const status of ["failed", "cancelled", "interrupted"]) {
      expect(
        sweep.planStorageSweep({
          jobDirs: ["job-x"],
          record: { jobId: "job-x", status },
          workerAlive: false,
          cacheDirs: [],
          debuggable: false,
        }),
      ).toEqual({ jobDirs: ["job-x"], cacheDirs: [] });
    }
  });

  test("cache sweep drops previews, keeps debug only when debuggable", () => {
    const { sweep } = loadAll();
    expect(
      sweep.planStorageSweep({
        jobDirs: [],
        record: null,
        workerAlive: false,
        cacheDirs: ["previews", "debug", "some-uuid"],
        debuggable: true,
      }).cacheDirs,
    ).toEqual(["previews", "some-uuid"]);
    expect(
      sweep.planStorageSweep({
        jobDirs: [],
        record: null,
        workerAlive: false,
        cacheDirs: ["previews", "debug", "some-uuid"],
        debuggable: false,
      }).cacheDirs,
    ).toEqual(["previews", "debug", "some-uuid"]);
  });

  test("unsafe child names are never deleted", () => {
    const { sweep } = loadAll();
    expect(
      sweep.planStorageSweep({
        jobDirs: ["", ".", "..", "a/b", "c\\d", "ok"],
        record: null,
        workerAlive: false,
        cacheDirs: ["../x", "ok-cache"],
        debuggable: false,
      }),
    ).toEqual({ jobDirs: ["ok"], cacheDirs: ["ok-cache"] });
  });

  test("missing state fields plan nothing", () => {
    const { sweep } = loadAll();
    expect(sweep.planStorageSweep()).toEqual({ jobDirs: [], cacheDirs: [] });
    expect(sweep.planStorageSweep(null)).toEqual({
      jobDirs: [],
      cacheDirs: [],
    });
  });
});

describe("sweepStaleStorage", () => {
  test("plans from native state and deletes the leftovers", async () => {
    const { native, sweep } = loadAll();
    const originalOs = Platform.OS;
    Platform.OS = "android";
    try {
      native.getStorageState.mockResolvedValue({
        jobDirs: ["job-done", "job-old"],
        record: doneRecord(),
        workerAlive: false,
        cacheDirs: ["previews"],
        debuggable: false,
      });
      native.deleteSweepPaths.mockResolvedValue({ deleted: 2 });
      const result = await sweep.sweepStaleStorage();
      expect(native.deleteSweepPaths).toHaveBeenCalledWith({
        jobDirs: ["job-old"],
        cacheDirs: ["previews"],
      });
      expect(result).toEqual({ deleted: 2 });
    } finally {
      Platform.OS = originalOs;
    }
  });

  test("skips the native call when there is nothing to delete", async () => {
    const { native, sweep } = loadAll();
    const originalOs = Platform.OS;
    Platform.OS = "android";
    try {
      native.getStorageState.mockResolvedValue({
        jobDirs: ["job-done"],
        record: doneRecord(),
        workerAlive: false,
        cacheDirs: ["debug"],
        debuggable: true,
      });
      expect(await sweep.sweepStaleStorage()).toEqual({ deleted: 0 });
      expect(native.deleteSweepPaths).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOs;
    }
  });

  test("is a no-op off Android", async () => {
    const { native, sweep } = loadAll();
    expect(await sweep.sweepStaleStorage()).toEqual({ deleted: 0 });
    expect(native.getStorageState).not.toHaveBeenCalled();
  });

  test("a native failure resolves to zero, never rejects", async () => {
    const { native, sweep } = loadAll();
    const originalOs = Platform.OS;
    Platform.OS = "android";
    try {
      native.getStorageState.mockRejectedValue(new Error("no module"));
      expect(await sweep.sweepStaleStorage()).toEqual({ deleted: 0 });
    } finally {
      Platform.OS = originalOs;
    }
  });
});
