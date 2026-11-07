import {
  CUTOUT_WARNING_EMPTY,
  CUTOUT_WARNING_MULTIPLE,
  warningsForCutoutStats,
} from "./cutout-warnings";

describe("warningsForCutoutStats", () => {
  test("a clean centered blob warns about nothing", () => {
    expect(
      warningsForCutoutStats({
        borderTouch: 0,
        bigComponents: 1,
        maskAreaFrac: 0.16,
      }),
    ).toEqual([]);
  });

  test("a border-touching mask no longer warns", () => {
    expect(
      warningsForCutoutStats({
        borderTouch: 0.6,
        bigComponents: 1,
        maskAreaFrac: 0.36,
      }),
    ).toEqual([]);
  });

  test("two large blobs warn about multiple objects", () => {
    const warnings = warningsForCutoutStats({
      borderTouch: 0,
      bigComponents: 2,
      maskAreaFrac: 0.08,
    });
    expect(warnings.map((w) => w.id)).toEqual([CUTOUT_WARNING_MULTIPLE]);
  });

  test("an empty mask warns once and skips the other checks", () => {
    const warnings = warningsForCutoutStats({
      borderTouch: 0,
      bigComponents: 0,
      maskAreaFrac: 0,
    });
    expect(warnings.map((w) => w.id)).toEqual([CUTOUT_WARNING_EMPTY]);
  });

  test("a tiny mask warns about no clear object", () => {
    const warnings = warningsForCutoutStats({
      borderTouch: 0,
      bigComponents: 1,
      maskAreaFrac: 0.02,
    });
    expect(warnings.map((w) => w.id)).toEqual([CUTOUT_WARNING_EMPTY]);
  });

  test("a cropped multi-object photo warns only about multiple; missing stats warn nothing", () => {
    const warnings = warningsForCutoutStats({
      borderTouch: 0.3,
      bigComponents: 3,
      maskAreaFrac: 0.4,
    });
    expect(warnings.map((w) => w.id)).toEqual([CUTOUT_WARNING_MULTIPLE]);
    expect(warningsForCutoutStats(null)).toEqual([]);
    expect(warningsForCutoutStats(undefined)).toEqual([]);
  });
});
