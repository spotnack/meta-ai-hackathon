import { planPersistedJob } from "./persisted-job-plan";

const baseRecord = {
  jobId: "job-1",
  imageUri: "file:///photo.jpg",
  fileName: "photo.jpg",
  width: 800,
  height: 800,
  steps: 50,
  fraction: 0.4,
  label: "Generating geometry",
  outDir: "/files/triposg/jobs/job-1",
  meshUri: null,
  displayMeshUri: null,
  error: null,
};

describe("planPersistedJob", () => {
  test("no record means idle", () => {
    expect(planPersistedJob(null)).toEqual({ action: "none" });
  });

  test("a running job reattaches to its events", () => {
    expect(planPersistedJob({ ...baseRecord, status: "running" })).toEqual({
      action: "attach",
    });
  });

  test("a done job completes its save", () => {
    expect(
      planPersistedJob({
        ...baseRecord,
        status: "done",
        displayMeshUri: "file:///files/mesh.display.glb",
      }),
    ).toEqual({ action: "complete" });
  });

  test("a failed job reports the native error", () => {
    expect(
      planPersistedJob({ ...baseRecord, status: "failed", error: "HTP gone" }),
    ).toEqual({ action: "report", message: "HTP gone" });
  });

  test("a failed job without detail still reports", () => {
    expect(planPersistedJob({ ...baseRecord, status: "failed" })).toEqual({
      action: "report",
      message: "Conversion failed. Please try again.",
    });
  });

  test("an interrupted job offers a retry", () => {
    const plan = planPersistedJob({ ...baseRecord, status: "interrupted" });
    expect(plan.action).toBe("report");
    expect(plan.message).toMatch("interrupted");
  });

  test("a cancelled job is dismissed silently", () => {
    expect(planPersistedJob({ ...baseRecord, status: "cancelled" })).toEqual({
      action: "dismiss",
    });
  });

  test("an unknown status is dismissed, never resumed", () => {
    expect(planPersistedJob({ ...baseRecord, status: "migrating" })).toEqual({
      action: "dismiss",
    });
  });
});
