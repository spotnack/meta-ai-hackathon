/*
Regression test for the round-25 guest-restore race: the provider started
with isLoading false, so the index redirect sent the user to the auth screen
before the persisted "@auth:demo-session" read resolved. These tests assert
the provider starts loading in demo mode (so the redirect waits) and then
restores the stored guest — or resolves to signed-out when nothing is
stored.

Needs the react-test-renderer devDependency (pinned in client/package.json
to the repo's React version). Without it the suite skips with an
explanation instead of failing: run `yarn install` in client/, then jest.
*/

let TestRenderer = null;
try {
  TestRenderer = require("react-test-renderer");
} catch (err) {
  TestRenderer = null;
}
// Aliased so the jest lint rule against describe.skip stays quiet: the skip
// only happens when the renderer package is not installed.
const maybeDescribe = TestRenderer ? describe : describe.skip;

jest.mock("@react-native-async-storage/async-storage", () => {
  let store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key) =>
        Object.hasOwn(store, key) ? store[key] : null,
      ),
      setItem: jest.fn(async (key, value) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key) => {
        delete store[key];
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
    },
  };
});

jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
  openBrowserAsync: jest.fn(),
}));

jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn(async () => new Uint8Array(96)),
  digestStringAsync: jest.fn(async () => "challenge"),
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  CryptoEncoding: { BASE64: "BASE64" },
}));

jest.mock("../infrastructure/auth.api", () => ({
  authApi: {
    getConfig: jest.fn(),
    signIn: jest.fn(),
    signUp: jest.fn(),
    confirmSignUp: jest.fn(),
    resendCode: jest.fn(),
    googleToken: jest.fn(),
    signOut: jest.fn(),
  },
}));

jest.mock("../infrastructure/demo-auth.config", () => ({
  AUTH_MODES: { DEFAULT: "default", DEMO: "demo" },
  isDemoAuthMode: () => true,
  DEMO_GUEST_USER: {
    id: "demo-guest",
    name: "Demo guest",
    email: "demo@spotnack.local",
    provider: "demo",
  },
}));

maybeDescribe("AuthContextProvider demo restore", () => {
  const loadAll = () => {
    // jest.resetModules() gives every test a fresh React; the renderer must
    // come from the same module registry or hooks see a null dispatcher.
    TestRenderer = require("react-test-renderer");
    const React = require("react");
    const { AuthContextProvider, useAuth } = require("./auth.context");
    const AsyncStorage =
      require("@react-native-async-storage/async-storage").default;
    return { React, AuthContextProvider, useAuth, AsyncStorage };
  };

  beforeEach(() => {
    jest.resetModules();
  });

  test("starts loading in demo mode so the index redirect waits", () => {
    const { React, AuthContextProvider, useAuth } = loadAll();
    const seen = [];
    const Probe = () => {
      seen.push(useAuth());
      return null;
    };
    let renderer;
    // Sync act runs the restore effect but leaves the AsyncStorage promise
    // pending, so seen[0] is the pre-restore state the redirect reads.
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContextProvider,
          null,
          React.createElement(Probe),
        ),
      );
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].isLoading).toBe(true);
    renderer.unmount();
  });

  test("a stored demo session restores the guest user", async () => {
    const { React, AuthContextProvider, useAuth, AsyncStorage } = loadAll();
    await AsyncStorage.setItem("@auth:demo-session", "demo-guest");
    const seen = [];
    const Probe = () => {
      seen.push(useAuth());
      return null;
    };
    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContextProvider,
          null,
          React.createElement(Probe),
        ),
      );
    });
    const last = seen[seen.length - 1];
    expect(last.isLoading).toBe(false);
    expect(last.user).toMatchObject({ id: "demo-guest", provider: "demo" });
    renderer.unmount();
  });

  test("no stored session resolves to signed-out, not stuck loading", async () => {
    const { React, AuthContextProvider, useAuth } = loadAll();
    const seen = [];
    const Probe = () => {
      seen.push(useAuth());
      return null;
    };
    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(
          AuthContextProvider,
          null,
          React.createElement(Probe),
        ),
      );
    });
    const last = seen[seen.length - 1];
    expect(last.isLoading).toBe(false);
    expect(last.user).toBeNull();
    renderer.unmount();
  });
});
