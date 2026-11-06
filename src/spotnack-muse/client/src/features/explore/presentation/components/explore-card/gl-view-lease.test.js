import {
  MAX_LIVE_GL_VIEWS,
  acquireGlLease,
  hasGlLease,
  releaseGlLease,
  resetGlLeases,
  subscribeGlLeases,
} from "./gl-view-lease";

beforeEach(() => {
  resetGlLeases();
});

describe("GL lease pool", () => {
  test("grants at most MAX_LIVE_GL_VIEWS cards", () => {
    expect(MAX_LIVE_GL_VIEWS).toBe(2);
    acquireGlLease("a");
    acquireGlLease("b");
    acquireGlLease("c");
    expect(hasGlLease("a")).toBe(false);
    expect(hasGlLease("b")).toBe(true);
    expect(hasGlLease("c")).toBe(true);
  });

  test("the most recently seen card wins the grant", () => {
    acquireGlLease("a");
    acquireGlLease("b");
    acquireGlLease("a");
    expect(hasGlLease("a")).toBe(true);
    expect(hasGlLease("b")).toBe(true);
  });

  test("releasing frees the grant for the next card", () => {
    acquireGlLease("a");
    acquireGlLease("b");
    acquireGlLease("c");
    releaseGlLease("c");
    expect(hasGlLease("a")).toBe(true);
    expect(hasGlLease("b")).toBe(true);
    expect(hasGlLease("c")).toBe(false);
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
