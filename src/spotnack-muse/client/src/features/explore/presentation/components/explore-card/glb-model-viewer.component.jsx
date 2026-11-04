// React
import { Component, Fragment, useRef, useEffect, useState, useMemo, Suspense } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

// Three.js
import * as THREE from "three";

// React Three Fiber
import { Canvas, useFrame } from "@react-three/fiber/native";

// React Three Drei
import { useGLTF } from "@react-three/drei/native";
import { ContactShadows } from "@react-three/drei";

const _origWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === "string" && args[0].startsWith("THREE.Clock")) return;
  _origWarn(...args);
};

/**
 * Patches expo-gl's pixelStorei to silently ignore unsupported WebGL parameters.
 * @param {object} root0 - R3F onCreated callback argument.
 * @param {object} root0.gl - The R3F WebGL renderer instance.
 */
export function patchPixelStorei({ gl }) {
  const ctx = gl.getContext();
  if (ctx && typeof ctx.pixelStorei === "function") {
    const orig = ctx.pixelStorei.bind(ctx);
    ctx.pixelStorei = (pname, param) => {
      if (pname === 37440 || pname === 37441 || pname === 37443) return;
      orig(pname, param);
    };
  }
}

// How fast the model grows to its fitted size (exponential damping rate; ~0.5 s to settle).
const SCALE_IN_DAMPING = 8;

/**
 * Loads a GLB model, auto-centers and fits it, then rotates it continuously.
 * @param {object} root0 - Component props.
 * @param {string} root0.uri - URI of the GLB asset to load.
 * @param {number} root0.scaleFactor - Multiplier applied on top of the auto-fit scale.
 * @returns {React.JSX.Element} An animated 3D group containing the loaded model.
 */
export function RotatingModel({ uri, scaleFactor = 1.0 }) {
  const { scene } = useGLTF(uri);
  const clonedScene = useMemo(() => scene.clone(true), [scene]);
  const groupRef = useRef();
  const currentScale = useRef(0);
  const [fitScale, setFitScale] = useState(0);
  const [offset, setOffset] = useState([0, 0, 0]);

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(clonedScene);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    setOffset([-center.x, -center.y, -center.z]);
    if (maxDim > 0) setFitScale(1.0 / maxDim);
  }, [clonedScene]);

  // Grows the model from nothing to its fitted size, and keeps it spinning. This is animated per frame rather
  // than with @react-spring/three: react-spring requests frames by invalidating *every* canvas, including ones
  // still starting up (no renderer yet), which crashes R3F ("Cannot read property 'xr' of null"). The canvas
  // renders every frame anyway, so per-frame damping needs no frame requests.
  useFrame((_state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    currentScale.current = THREE.MathUtils.damp(
      currentScale.current,
      fitScale,
      SCALE_IN_DAMPING,
      delta,
    );
    const scale = currentScale.current * scaleFactor;
    group.scale.set(scale * 1.2, scale * 1.8, scale * 1.2);
    group.rotation.y += delta * 0.6;
  });

  return (
    <group rotation={[Math.PI / 5, 0, Math.PI / 12]}>
      <group ref={groupRef}>
        <group position={offset}>
          <primitive object={clonedScene} dispose={null} />
        </group>
      </group>
    </group>
  );
}

const DEFAULT_STYLE = { width: "100%", height: 140 };
const DEFAULT_BACKGROUND = "#242225";
const FALLBACK_ICON_COLOR = "rgba(255, 255, 255, 0.6)";
const MAX_CANVAS_RETRIES = 2;
const CANVAS_RETRY_DELAY_MS = 500;

/**
 * Contains a failed 3D canvas to its own card.
 * expo-gl destroys a GLView's context when its surface goes away (on Android, when the view is detached
 * from the window). If that happens while three.js is still creating its renderer, the Canvas throws
 * ("Cannot read property 'precision' of undefined"). This boundary shows a fallback instead and remounts
 * the canvas, which gets a fresh GLView and context, up to MAX_CANVAS_RETRIES times.
 */
class GlCanvasBoundary extends Component {
  state = { failed: false, retries: 0 };

  /**
   * @returns {{failed: boolean}} State that switches to the fallback.
   */
  static getDerivedStateFromError() {
    return { failed: true };
  }

  /**
   * Logs the failure and schedules a retry while retries remain.
   * @param {Error} error - What the canvas threw.
   */
  componentDidCatch(error) {
    console.warn(`- 3D canvas failed to start: ${error?.message}`);
    if (this.state.retries < MAX_CANVAS_RETRIES) {
      this.retryTimer = setTimeout(
        () => this.setState((state) => ({ failed: false, retries: state.retries + 1 })),
        CANVAS_RETRY_DELAY_MS,
      );
    }
  }

  /**
   * Cancels a pending retry.
   */
  componentWillUnmount() {
    clearTimeout(this.retryTimer);
  }

  /**
   * @returns {React.ReactNode} The canvas, or the fallback after a failure.
   */
  render() {
    if (this.state.failed) {
      return this.props.renderFallback(this.state.retries < MAX_CANVAS_RETRIES);
    }
    // A new key per attempt mounts a new GLView, so each retry starts with a new GL context.
    return <Fragment key={this.state.retries}>{this.props.children}</Fragment>;
  }
}

const CanvasFallback = ({ isRetrying, backgroundColor }) => (
  <View style={[fallbackStyles.container, { backgroundColor }]}>
    {isRetrying ? (
      <ActivityIndicator color={FALLBACK_ICON_COLOR} />
    ) : (
      <MaterialCommunityIcons name="cube-off-outline" size={32} color={FALLBACK_ICON_COLOR} />
    )}
  </View>
);

const fallbackStyles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
});

export const GlbModelViewer = ({ uri, canvas, scaleFactor, background, showShadows = false }) => {
  const backgroundColor = background ?? DEFAULT_BACKGROUND;
  // Defer Canvas creation until after the first commit so the native GLView
  // surface is fully attached before WebGLRenderer calls getShaderPrecisionFormat.
  const [surfaceReady, setSurfaceReady] = useState(false);
  useEffect(() => { setSurfaceReady(true); }, []);

  return (
    <View style={canvas ?? DEFAULT_STYLE} pointerEvents="none">
      {!surfaceReady ? (
        <CanvasFallback isRetrying backgroundColor={backgroundColor} />
      ) : (
        <GlCanvasBoundary
          renderFallback={(isRetrying) => (
            <CanvasFallback isRetrying={isRetrying} backgroundColor={backgroundColor} />
          )}
        >
          <Canvas
            camera={{ position: [0, 0.5, 4], fov: 30 }}
            onCreated={patchPixelStorei}
          >
            <color attach="background" args={[backgroundColor]} />
            {uri ? (
              <Suspense fallback={null}>
                <RotatingModel uri={uri} scaleFactor={scaleFactor} />
                {showShadows && <ContactShadows position-y={-0.5} opacity={0.6} />}
              </Suspense>
            ) : null}
          </Canvas>
        </GlCanvasBoundary>
      )}
    </View>
  );
};
