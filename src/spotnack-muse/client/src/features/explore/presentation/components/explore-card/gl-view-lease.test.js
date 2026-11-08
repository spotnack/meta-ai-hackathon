import {
  MAX_LIVE_GL_VIEWS,
  acquireGlLease,
  hasGlLease,
  releaseGlLease,
  resetGlLeases,
  subscribeGlLeases,
  useGlViewLease,
} from "./gl-view-lease";

beforeEach(() => {
  resetGlLeases();
});

// One more card than the cap: ids "0" .. String(MAX_LIVE_GL_VIEWS).
const acquireOverCap = () => {
  const ids = Array.from({ length: MAX_LIVE_GL_VIEWS + 1 }, (_, i) => String(i));
  ids.forEach(acquireGlLease);
  return ids;
};

describe("GL lease pool", () => {
  test("grants at most MAX_LIVE_GL_VIEWS cards", () => {
    expect(MAX_LIVE_GL_VIEWS).toBe(20);
    const ids = acquireOverCap();
    // The least recently seen card is the one left out.
    expect(hasGlLease(ids[0])).toBe(false);
    expect(ids.slice(1).every(hasGlLease)).toBe(true);
  });

  test("the most recently seen card wins the grant", () => {
    const ids = acquireOverCap();
    acquireGlLease(ids[0]);
    expect(hasGlLease(ids[0])).toBe(true);
    expect(hasGlLease(ids[1])).toBe(false);
  });

  test("releasing frees the grant for the next card", () => {
    const ids = acquireOverCap();
    const newest = ids[ids.length - 1];
    releaseGlLease(newest);
    expect(hasGlLease(ids[0])).toBe(true);
    expect(hasGlLease(newest)).toBe(false);
  });

  test("unknown ids hold no grant and release silently", () => {
    const notified = jest.fn();
    const unsubscribe = subscribeGlLeases(notified);
    expect(hasGlLease("ghost")).toBe(false);
    releaseGlLease("ghost");
    expect(notified).not.toHaveBeenCalled();
    unsubscribe();
  });

  test("acquire and release notify subscribers", () => {
    const notified = jest.fn();
    const unsubscribe = subscribeGlLeases(notified);
    acquireGlLease("a");
    releaseGlLease("a");
    expect(notified).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

let TestRenderer = null;
try {
  TestRenderer = require("react-test-renderer");
} catch {
  // Renderer not installed: the hook test is skipped.
}
// Aliased like the card test: skip only when the renderer is missing.
const maybeDescribe = TestRenderer ? describe : describe.skip;

maybeDescribe("useGlViewLease", () => {
  test("a wanted card is granted after its lease registers", () => {
    const React = require("react");
    const seen = [];
    const Probe = ({ id, wanted }) => {
      seen.push(useGlViewLease(id, wanted));
      return null;
    };
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(React.createElement(Probe, { id: "x", wanted: true }));
    });
    expect(seen[seen.length - 1]).toBe(true);
    TestRenderer.act(() => {
      renderer.update(React.createElement(Probe, { id: "x", wanted: false }));
    });
    expect(seen[seen.length - 1]).toBe(false);
    expect(hasGlLease("x")).toBe(false);
    renderer.unmount();
  });
});
