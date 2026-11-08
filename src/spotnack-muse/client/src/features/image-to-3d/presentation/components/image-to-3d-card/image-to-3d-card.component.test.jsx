/*
Regression test for the round-25 release crash: the card used an undeclared
`hasImage` variable (ReferenceError, fatal in release builds). Rendering the
card with an image selected, a cut-out with warnings, and the high-detail
toggle exercises every use site, so this test fails on that bug. (The
no-undef lint rule now guards it statically too; this test guards the
rendered output.)

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

// theme.ts pulls in the Tailwind stylesheet, which jest cannot transform.
jest.mock("@/global.css", () => ({}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const stub = (displayName) => {
    const Stub = (props) => React.createElement(displayName, props);
    Stub.displayName = displayName;
    return Stub;
  };
  return {
    Ionicons: stub("Ionicons"),
    MaterialCommunityIcons: stub("MaterialCommunityIcons"),
  };
});

jest.mock("expo-image", () => {
  const React = require("react");
  const ExpoImageStub = (props) => React.createElement("ExpoImage", props);
  ExpoImageStub.displayName = "ExpoImage";
  return { Image: ExpoImageStub };
});

jest.mock(
  "@shared/ui/animation/blinking/blinking-animation.component",
  () => {
    const React = require("react");
    return {
      BlinkingAnimation: ({ children }) =>
        React.createElement("BlinkingAnimation", null, children),
    };
  },
);

maybeDescribe("ImageTo3dCardComponent", () => {
  const React = require("react");
  const {
    ImageTo3dCardComponent,
  } = require("./image-to-3d-card.component");
  const {
    CONVERSION_STATUS,
  } = require("../../../domain/image-to-3d-conversion.entity");

  const noop = () => {};
  const baseProps = {
    selectedImage: {
      uri: "file:///photo.jpg",
      width: 800,
      height: 600,
      fileName: "photo.jpg",
    },
    status: CONVERSION_STATUS.IDLE,
    progress: { fraction: 0, label: "" },
    error: null,
    isPicking: false,
    isConverting: false,
    canConvert: true,
    cutout: {
      uri: "file:///cutout.png",
      width: 800,
      height: 600,
      stats: { borderTouch: 0.4, bigComponents: 2, maskAreaFrac: 0.3 },
      warnings: [
        {
          id: "multiple",
          message: "Looks like more than one object — the model works best with a single subject.",
        },
      ],
    },
    cutoutWorking: false,
    highDetail: false,
    setHighDetail: noop,
    onPickImage: noop,
    onClearImage: noop,
    onConvert: noop,
    onCancelConversion: noop,
    modelState: null,
  };

  // Every string rendered anywhere in the tree.
  const renderedStrings = (root) =>
    root
      .findAll((node) => typeof node?.props?.children === "string")
      .map((node) => node.props.children);

  test("renders preview, cut-out badge, warnings and high-detail toggle", () => {
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        React.createElement(ImageTo3dCardComponent, baseProps),
      );
    });
    const strings = renderedStrings(renderer.root);
    expect(strings).toContain("Cut-out preview");
    expect(strings).toContain(
      "Looks like more than one object — the model works best with a single subject.",
    );
    expect(strings).toContain("High detail");
    expect(
      renderer.root.findByProps({
        accessibilityLabel: "High detail extraction",
      }),
    ).toBeTruthy();
    expect(
      renderer.root.findByProps({ accessibilityLabel: "Convert to 3D" }),
    ).toBeTruthy();
    renderer.unmount();
  });

  test("renders the empty picker without an image", () => {
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        React.createElement(ImageTo3dCardComponent, {
          ...baseProps,
          selectedImage: null,
          cutout: null,
        }),
      );
    });
    expect(renderedStrings(renderer.root)).toContain("Choose a photo");
    renderer.unmount();
  });

  test("a passed Verify shows the pop-up and a green Verified button", () => {
    const { MODEL_STATUS } = require("../../../domain/model-management.port");
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        React.createElement(ImageTo3dCardComponent, {
          ...baseProps,
          modelState: {
            status: MODEL_STATUS.INSTALLED,
            version: "v2",
            downloadedBytes: 1024,
            totalBytes: 1024,
            reason: null,
            fullyVerified: true,
          },
          modelActionNotice: "Every TripoSG QNN model file matches its SHA-256 hash.",
          onVerifyModels: noop,
          onDismissModelNotice: noop,
        }),
      );
    });
    const strings = renderedStrings(renderer.root);
    expect(strings).toContain("Every TripoSG QNN model file matches its SHA-256 hash.");
    expect(strings).toContain("Swipe to dismiss");
    expect(strings).toContain("Verified");
    expect(strings).not.toContain("Verify");
    expect(
      renderer.root.findByProps({ accessibilityLabel: "TripoSG QNN model verified" })
        .props.disabled,
    ).toBe(true);
    renderer.unmount();
  });

  test("an installed but not fully checked set offers Verify", () => {
    const { MODEL_STATUS } = require("../../../domain/model-management.port");
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        React.createElement(ImageTo3dCardComponent, {
          ...baseProps,
          modelState: {
            status: MODEL_STATUS.INSTALLED,
            version: "v2",
            downloadedBytes: 1024,
            totalBytes: 1024,
            reason: null,
            fullyVerified: false,
          },
          onVerifyModels: noop,
        }),
      );
    });
    const strings = renderedStrings(renderer.root);
    expect(strings).toContain("Verify");
    expect(strings).not.toContain("Swipe to dismiss");
    renderer.unmount();
  });

  test("converting state shows progress and the Stop action", () => {
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        React.createElement(ImageTo3dCardComponent, {
          ...baseProps,
          isConverting: true,
          progress: { fraction: 0.5, label: "Sampling" },
        }),
      );
    });
    expect(
      renderer.root.findByProps({ accessibilityLabel: "Stop conversion" }),
    ).toBeTruthy();
    renderer.unmount();
  });
});
