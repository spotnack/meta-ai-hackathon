import {
  GL_NOT_AVAILABLE_CODE,
  buildGuardedHandler,
  ensureGlGuardInstalled,
  isGlNotAvailableError,
  subscribeGlNotAvailable,
} from "./gl-availability";

const glError = () => {
  const error = new Error(
    "GL is currently not available. (Have you enabled remote debugging? GL is not available while debugging remotely.)",
  );
  error.code = GL_NOT_AVAILABLE_CODE;
  return error;
};

describe("isGlNotAvailableError", () => {
  test("matches expo-gl's exact failure by code", () => {
    expect(isGlNotAvailableError(glError())).toBe(true);
  });

  test("matches by message when the code is missing", () => {
    expect(
      isGlNotAvailableError(new Error("GL is currently not available")),
    ).toBe(true);
  });

  test("rejects unrelated errors and non-errors", () => {
    expect(isGlNotAvailableError(new Error("Cannot read property 'x'"))).toBe(
      false,
    );
    expect(isGlNotAvailableError(null)).toBe(false);
    expect(isGlNotAvailableError("GL is currently not available")).toBe(false);
    expect(isGlNotAvailableError({ code: "ERR_OTHER" })).toBe(false);
  });
});

describe("buildGuardedHandler", () => {
  test("swallows the GL failure, notifies, and spares the previous handler", () => {
    const previous = jest.fn();
    const notified = jest.fn();
    buildGuardedHandler(previous, notified)(glError(), true);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(previous).not.toHaveBeenCalled();
  });

  test("delegates every other error with its fatal flag", () => {
    const previous = jest.fn();
    const boom = new Error("boom");
    buildGuardedHandler(previous, jest.fn())(boom, true);
    expect(previous).toHaveBeenCalledWith(boom, true);
  });

  test("survives a missing previous handler", () => {
    expect(() =>
      buildGuardedHandler(null, jest.fn())(new Error("boom"), false),
    ).not.toThrow();
  });
});

describe("ensureGlGuardInstalled", () => {
  const fakeHost = () => {
    const calls = [];
    return {
      calls,
      getGlobalHandler: jest.fn(() => null),
      setGlobalHandler: jest.fn((handler) => calls.push(handler)),
    };
  };

  test("installs once per host and routes failures to subscribers", () => {
    const host = fakeHost();
    ensureGlGuardInstalled(host);
    ensureGlGuardInstalled(host);
    expect(host.setGlobalHandler).toHaveBeenCalledTimes(1);
    const notified = jest.fn();
    const unsubscribe = subscribeGlNotAvailable(notified);
    host.calls[0](glError(), true);
    expect(notified).toHaveBeenCalledTimes(1);
    unsubscribe();
    host.calls[0](glError(), true);
    expect(notified).toHaveBeenCalledTimes(1);
  });
});
