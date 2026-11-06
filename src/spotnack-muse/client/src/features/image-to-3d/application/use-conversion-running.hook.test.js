import { isConversionRecordActive } from "./use-conversion-running.hook";

jest.mock(
  "@spotnack/triposg",
  () => ({ getPendingJob: jest.fn() }),
  { virtual: true },
);

const baseRecord = {
  jobId: "job-1",
  imageUri: "file:///photo.jpg",
  fileName: "photo.jpg",
  width: 800,
  height: 800,
  steps: 50,
  fraction: 0.4,
  label: "Sampling",
  outDir: "/files/triposg/jobs/job-1",
  meshUri: null,
  displayMeshUri: null,
  error: null,
};

describe("isConversionRecordActive", () => {
  test("a running job is active", () => {
    expect(isConversionRecordActive({ ...baseRecord, status: "running" })).toBe(
      true,
    );
  });

  test("terminal records are not active", () => {
    for (const status of ["done", "failed", "cancelled", "interrupted"]) {
      expect(
        isConversionRecordActive({ ...baseRecord, status }),
      ).toBe(false);
    }
  });

  test("no record is not active", () => {
    expect(isConversionRecordActive(null)).toBe(false);
  });
});
