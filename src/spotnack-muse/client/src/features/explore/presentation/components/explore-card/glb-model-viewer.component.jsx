// React
import { Component, Fragment, useCallback, useRef, useEffect, useState, useMemo, Suspense } from "react";
import { ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

// Three.js
import * as THREE from "three";

// React Three Fiber
import { Canvas, useFrame } from "@react-three/fiber/native";

// React Three Drei
import { useGLTF } from "@react-three/drei/native";
import { ContactShadows } from "@react-three/drei";

// GL context failure guard (expo-gl throws from its surface-create event
// handler, which error boundaries cannot catch).
import { subscribeGlNotAvailable } from "./gl-availability";
import { saveModelPreview } from "./model-preview-snapshot";

// Styles
import {
  FALLBACK_ICON_COLOR,
  FallbackCaption,
  FallbackContainer,
  FallbackPhoto,
  ViewerContainer,
} from "./glb-model-viewer.component.styles";

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

// Light-gray matte clay for untextured meshes (e.g. TripoSG output, which is geometry only).
const UNTEXTURED_MESH_COLOR = "#d6d6d6";

/**
 * Makes untextured meshes renderable: they arrive without normals and with three.js's default glTF
 * material (metalness 1), which renders black without an environment map. Gives them computed normals
 * and a matte material. Textured or unlit models (the bundled food items) have normals and are untouched.
 * @param {THREE.Object3D} root - Cloned glTF scene to prepare in place.
 * @returns {THREE.Object3D} The same scene.
 */
export function prepareUntexturedMeshes(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    const { geometry } = node;
    // Clones share geometry with useGLTF's cache, so remember which ones got computed normals:
    // later clones then still get the matte material.
    if (!geometry.userData.computedNormals) {
      if (geometry.getAttribute("normal")) return;
      geometry.computeVertexNormals();
      geometry.userData.computedNormals = true;
    }
    node.material = new THREE.MeshStandardMaterial({
      color: UNTEXTURED_MESH_COLOR,
      roughness: 0.85,
      metalness: 0,
    });
  });
  return root;
}

/**
 * Loads a GLB model, auto-centers and fits it, then rotates it continuously.
 * @param {object} root0 - Component props.
 * @param {string} root0.uri - URI of the GLB asset to load.
 * @param {number} root0.scaleFactor - Multiplier applied on top of the auto-fit scale.
 * @param {function(object): void} [root0.onSettled] - Called once with the renderer when the model reaches its fitted size.
 * @returns {React.JSX.Element} An animated 3D group containing the loaded model.
 */
export function RotatingModel({ uri, scaleFactor = 1.0, onSettled }) {
  const { scene } = useGLTF(uri);
  const clonedScene = useMemo(() => prepareUntexturedMeshes(scene.clone(true)), [scene]);
  const groupRef = useRef();
  const currentScale = useRef(0);
  const [fitScale, setFitScale] = useState(0);
  const [offset, setOffset] = useState([0, 0, 0]);
  const settledReported = useRef(false);

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
  useFrame((state, delta) => {
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
    // Within 1% of the fitted size: the frame looks like the model at rest.
    if (
      onSettled &&
      !settledReported.current &&
      fitScale > 0 &&
      Math.abs(currentScale.current - fitScale) < fitScale * 0.01
    ) {
      settledReported.current = true;
      onSettled(state.gl);
    }
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

const DEFAULT_BACKGROUND = "#242225";
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
  <FallbackContainer $backgroundColor={backgroundColor}>
    {isRetrying ? (
      <ActivityIndicator color={FALLBACK_ICON_COLOR} />
    ) : (
      <MaterialCommunityIcons name="cube-off-outline" size={32} color={FALLBACK_ICON_COLOR} />
    )}
  </FallbackContainer>
);


/**
 * Static stand-in shown when the native GL context could not be created
 * (reported non-fatally by the expo-gl guard). Same look as the other
 * fallbacks; never attempts GL again until the viewer remounts.
 * @param {object} root0 - Component props.
 * @param {string|null} root0.photoUri - Photo shown behind the icon, if any.
 * @param {string} root0.backgroundColor - Container background.
 * @param {string|null} root0.caption - Message under the icon, if any.
 * @returns {React.JSX.Element} The static fallback.
 */
const GlUnavailableFallback = ({ photoUri, backgroundColor, caption }) => (
  <FallbackContainer $backgroundColor={backgroundColor}>
    {photoUri ? <FallbackPhoto source={{ uri: photoUri }} /> : null}
    <MaterialCommunityIcons name="cube-off-outline" size={32} color={FALLBACK_ICON_COLOR} />
    {caption ? <FallbackCaption>{caption}</FallbackCaption> : null}
  </FallbackContainer>
);

/**
 * Renders a GLB model in a 3D canvas, with static fallbacks.
 * @param {object} root0 - Component props.
 * @param {string} root0.uri - URI of the GLB asset to load.
 * @param {boolean} [root0.fill] - Fill the parent (Stage screen) instead of the 140 px card size.
 * @param {number} [root0.scaleFactor] - Multiplier applied on top of the auto-fit scale.
 * @param {string} [root0.background] - Canvas background color.
 * @param {boolean} [root0.showShadows] - Whether to render contact shadows.
 * @param {string|null} [root0.photoUri] - Photo for the GL-unavailable fallback, if any.
 * @param {string|null} [root0.fallbackCaption] - Message for the GL-unavailable fallback, if any.
 * @param {string|null} [root0.snapshotUri] - When set, saves a still of the first settled frame here (see model-preview-snapshot.js).
 * @param {function(string): void} [root0.onSnapshotSaved] - Called with the saved still's URI.
 * @returns {React.JSX.Element} The viewer or its fallback.
 */
export const GlbModelViewer = ({ uri, fill = false, scaleFactor, background, showShadows = false, photoUri = null, fallbackCaption = null, snapshotUri = null, onSnapshotSaved }) => {
  const backgroundColor = background ?? DEFAULT_BACKGROUND;
  // Defer Canvas creation until after the first commit so the native GLView
  // surface is fully attached before WebGLRenderer calls getShaderPrecisionFormat.
  const [surfaceReady, setSurfaceReady] = useState(false);
  useEffect(() => { setSurfaceReady(true); }, []);
  // A missing GL context throws from expo-gl's event handler, outside the
  // error boundary below: the guard reports it here so this viewer shows
  // its static fallback instead of dying with the process. A new uri
  // remounts the canvas for a fresh context attempt.
  const [glUnavailable, setGlUnavailable] = useState(false);
  useEffect(() => subscribeGlNotAvailable(() => setGlUnavailable(true)), []);
  useEffect(() => { setGlUnavailable(false); }, [uri]);
  // Save after the settled frame was presented (next tick), not mid-frame.
  const handleSettled = useCallback(
    (renderer) => {
      if (!snapshotUri) return;
      setTimeout(() => {
        saveModelPreview(renderer.getContext(), snapshotUri).then((savedUri) => {
          if (savedUri) onSnapshotSaved?.(savedUri);
        });
      }, 0);
    },
    [snapshotUri, onSnapshotSaved],
  );

  return (
    <ViewerContainer $fill={fill} pointerEvents="none">
      {glUnavailable ? (
        <GlUnavailableFallback
          photoUri={photoUri}
          backgroundColor={backgroundColor}
          caption={fallbackCaption}
        />
      ) : !surfaceReady ? (
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
            {/* Unlit (textured) models ignore these; lit untextured meshes need them. */}
            <ambientLight intensity={0.6} />
            <directionalLight position={[3, 4, 5]} intensity={1.6} />
            {uri ? (
              <Suspense fallback={null}>
                <RotatingModel
                  uri={uri}
                  scaleFactor={scaleFactor}
                  onSettled={snapshotUri ? handleSettled : undefined}
                />
                {showShadows && <ContactShadows position-y={-0.5} opacity={0.6} />}
              </Suspense>
            ) : null}
          </Canvas>
        </GlCanvasBoundary>
      )}
    </ViewerContainer>
  );
};
