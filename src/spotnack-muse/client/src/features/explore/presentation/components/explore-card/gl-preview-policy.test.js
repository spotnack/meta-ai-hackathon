import {
  LIVE_PREVIEW,
  NO_PREVIEW,
  STATIC_PREVIEW,
  resolveCardPreview,
  sameIdList,
  takeVisibleIds,
} from "./gl-preview-policy";

describe("resolveCardPreview", () => {
  test("a live lease renders live GL", () => {
    expect(
      resolveCardPreview({
        modelUri: "file:///mesh.glb",
        previewOnly: false,
        leaseGranted: true,
      }),
    ).toBe(LIVE_PREVIEW);
  });

  test("a running conversion forces every card to static", () => {
    expect(
      resolveCardPreview({
        modelUri: "file:///mesh.glb",
        previewOnly: true,
        leaseGranted: true,
      }),
    ).toBe(STATIC_PREVIEW);
  });

  test("a card without a lease stays static", () => {
    expect(
      resolveCardPreview({
        modelUri: "file:///mesh.glb",
        previewOnly: false,
        leaseGranted: false,
      }),
    ).toBe(STATIC_PREVIEW);
  });

  test("a card without a model has no preview slot", () => {
    expect(
      resolveCardPreview({
        modelUri: null,
        previewOnly: false,
        leaseGranted: true,
      }),
    ).toBe(NO_PREVIEW);
  });
});

describe("takeVisibleIds", () => {
  const entries = (ids) => ids.map((id) => ({ item: { id } }));

  test("caps at the first two viewable cards, in list order", () => {
    expect(takeVisibleIds(entries(["a", "b", "c"]))).toEqual(["a", "b"]);
  });

  test("keeps short lists and ignores a custom cap above length", () => {
    expect(takeVisibleIds(entries(["a"]), 5)).toEqual(["a"]);
  });

  test("skips entries without ids and tolerates missing input", () => {
    expect(
      takeVisibleIds([{ item: null }, { item: { id: "b" } }]),
    ).toEqual(["b"]);
    expect(takeVisibleIds(null)).toEqual([]);
  });
});

describe("sameIdList", () => {
  test("compares id lists by value and order", () => {
    expect(sameIdList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameIdList(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameIdList(["a"], ["a", "b"])).toBe(false);
  });
});
