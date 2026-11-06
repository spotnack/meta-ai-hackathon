<div align='center'>
  <h1> Mobile Architecture</h1>
</div>

# Table of Contents

- [Frontend](#frontend)
- [Backend](#backend)
- [File Source Tree](#fst)
- [Tooling and CI](#tooling)

---

<!-- #region Frontend -->
<details>
  <summary><h1 id="frontend">Frontend</h1></summary>

- Code Organization: feature-first folders at the top level (`src/features/<feature>/`).
- Presentation-Layer Architectural Pattern: MVVM (`*port.ts, *entity.ts` for models, `*.screen.tsx, *.component.tsx` for views, `*.view-model.ts` for view models).
- Application/System Architectural Pattern: Hexagonal Architecture (a.k.a. Ports and Adapters).

MVVM + Hexagonal Architecture:

- View and ViewModel are included inside the `Presentation/` folder.
- Models are included inside the `Domain/` folder.
- The `Application/` folder contains the React contexts and hooks that expose the use cases to the screens.
- The `Infrastructure/` folder contains the adapters that implement the ports defined in the `Domain/` folder.

Each feature is split into the layers it needs:

| Layer             | Responsibility                                                                                                                                      | Example                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `domain/`         | Server-state operations, domain logic (entities, value objects, business rules, and domain services), and ports (interfaces). No framework imports. | `generated-shapes/domain/generated-shape.entity.ts`, `generated-shapes.port.ts`             |
| `application/`    | Use cases exposed as React contexts and hooks, plus mappers.                                                                                        | `generated-shapes/application/generated-shapes.context.tsx`, `use-generated-shapes.hook.ts` |
| `infrastructure/` | Adapters that implement ports (HTTP API, data sources, device location).                                                                            | `generated-shapes/infrastructure/generated-shapes.api.adapter.ts`                           |
| `presentation/`   | Screens, feature-specific components, and view models.                                                                                              | `generated-shapes/presentation/screens/manage-generated-shapes/`                            |

</details>
<!-- #endregion -->

---

<!-- #region Backend -->
<details>
  <summary><h1 id="backend">Backend</h1></summary>

- API communication: RESTful API built with Express.js and mounted at `/api` in `app.js`. `server.js` starts the HTTP listener.

- Each frontend feature's `infrastructure/` layer (e.g. `features/generated-shapes/infrastructure/generated-shapes.api.adapter.js`) defines the requests it makes: URL/endpoint, method, and body. On the server, every resource is a **route → middleware → repository** trio:
  - `routes/` maps HTTP methods and paths to handlers. `routes/index.js` aggregates them.
  - `middlewares/` validates input with Joi and contains the handlers.
  - `repositories/` owns data access and delegates storage to `db/client.js`.
  - `services/` contains reusable integrations (e.g., `cognito.service.js`).
  - `auth/cognito/` contains the authentication middleware, ready to attach to protected routes.

- Configuration: `src/config/env.js` loads `server/.env` from an explicit path and exposes the SMTP, `GENERATED_SHAPES_DATA_FILE`, and AWS Cognito settings.

Endpoints:

| Method | Path                        | Description                                           |
| ------ | --------------------------- | ----------------------------------------------------- |
| `GET`  | `/api/health`               | Liveness probe.                                       |
| `GET`  | `/api/auth/config`          | Returns Cognito client config and hosted-UI settings. |
| `POST` | `/api/auth/sign-up`         | Register a new user.                                  |
| `POST` | `/api/auth/confirm-sign-up` | Confirm email with 6-digit code.                      |
| `POST` | `/api/auth/resend-code`     | Resend confirmation code.                             |
| `POST` | `/api/auth/sign-in`         | Email/password sign-in; returns session tokens.       |
| `POST` | `/api/auth/google/token`    | Exchange Cognito PKCE auth code for session tokens.   |
| `POST` | `/api/auth/refresh`         | Refresh session using a refresh token.                |
| `POST` | `/api/auth/forgot-password` | Send password-reset code to email.                    |
| `POST` | `/api/auth/reset-password`  | Set new password with reset code.                     |
| `POST` | `/api/auth/sign-out`        | Revoke refresh token; returns hosted-UI logout URL.   |

`models.routes.js` and `payments.routes.js` are placeholders.

</details>
<!-- #endregion -->

---

<!-- #region File Source Tree -->
<details>
  <summary><h1 id="fst">File Source Tree</h1></summary>

```bash
.github/
└── workflows/
    └── ci.yml                                     # GitHub Actions CI (linting).
assets/                                            # Images used by the README.
docs/
├── ai_pipeline.md                                 # The on-device AI pipeline for generating 3D models from 2D images.
├── ai_pipeline_plan.md                            # Phased plan for the on-device AI pipeline (phases, files, decisions).
├── architecture.md                                # This file.
├── deployment.md                                  # Guide to deploy the app to production.
└── index.html                                     # GitHub Pages landing page (Google Search Console verification).
ml/
└── triposg-mobile/                                # TripoSG conversion/parity/benchmark tooling (weights and large logs git-ignored).
    ├── README.md                                  # Tooling overview and one-command runs.
    ├── .gitignore                                 # Ignores weights, tensors, and large logs.
    ├── audit/                                     # Phase 0 claim notes (claims.md).
    ├── bench/spike.md                             # Spike-first plan: smallest on-device piece (tonight).
    ├── bench/spike_dinov2_export.py             # Encoder→ONNX export + CPU baseline (needs env).
    ├── bench/spike_adb_info.sh                  # Step 0: device specs (you run, paste back).
    ├── bench/spike_adb_push.sh                  # Step 1: push spike files to the phone.
    ├── bench/spike_adb_run.sh                   # Step 2: probe on-device runtimes.
    ├── bench/spike_adb_pull.sh                  # Step 3: pull results + RAM evidence.
    ├── bench/spike_adb_bench.sh                 # Step 4: run NDK bench on phone + VmHWM.
    └── bench/ndk/                               # NDK benchmark sources (bench.cpp, CMake, build.sh).
    ├── bench/spike_transformer_export.py        # FP16 one-step export (mmap, external data).
    ├── eval/manifest_5.json                       # 5-image golden-set manifest (pre-cut inputs, fixed seeds).
    ├── reference/triposg_golden_5.ipynb           # Colab GPU notebook you run for the 5 goldens.
    ├── reference/decimate_display.py              # Decimate goldens to ~80k-face display meshes.
    ├── parity/tensor_parity.py                    # Generic tensor comparator (single math implementation).
    ├── parity/check_step0.py                      # Thin one-step gate wrapper over tensor_parity.
    ├── parity/mesh_parity.py                      # Chamfer + F-score (cKDTree) + volume IoU + --render.
    ├── parity/thresholds.json + THRESHOLDS.md     # Acceptance thresholds, fixed before optimizing.
    ├── parity/run_phase1.py                       # One-command Phase 1 driver (hashes, baselines, report).
    ├── parity/test_parity.py                      # Synthetic harness regression tests (pytest).
    ├── logs/phase1/                               # phase1_report.json + .md (git-ignored raw logs).
    ├── eval/matrix.md                             # Phase 2 per-component × runtime matrix (measured/linked).
    ├── eval/summary.md                            # Phase 2 recommendation + knob trade-off tables.
    ├── bench/export_vae.py                        # VAE decoder export: vae_post + vae_query (FP32, fixed N).
    ├── bench/split_export_step.py                 # Transformer split batch-1 export (23 units, laptop).
    ├── bench/aihub_compile.py                     # AI Hub compile/profile/manifest (transformer + VAE stems).
    ├── bench/spike_adb_chain_npu.sh               # One-step chain runs on the phone NPU.
    ├── bench/spike_adb_pipeline.sh                # Full sampling→mesh runs on the phone NPU.
    ├── bench/ndk/chain.cpp                        # spike_chain: one guided step over 23 resident units.
    ├── bench/ndk/pipeline.cpp                     # spike_pipeline: loop + VAE + extract + mesh on device.
    ├── cpp/extract.{h,cpp}                        # Portable octree SDF extraction (pluggable backend).
    ├── cpp/mcubes.{h,cpp}                         # Portable marching tetrahedra + outward normals.
    ├── cpp/glb_writer.{h,cpp}                     # Minimal valid glTF 2.0 binary writer.
    ├── cpp/test/                                  # Laptop host test (ORT CPU backend, grades vs goldens).
    ├── cpp/CMakeLists.txt                         # triposg_core static lib (reused by the Expo module).
    ├── cpp/test/test_preprocess.cpp               # Front-end host test (u2net CPU + prepare + pixel_values).
    ├── cpp/test/prep_preprocess_inputs.py         # PNG sources + golden prepared -> .npy fixtures.
    ├── cpp/test/make_preprocess_refs.py           # Bit-exact stage refs via real load_image + BitImageProcessor.
    ├── cpp/test/check_preprocess.py               # Grades cutout/prepared/pixel_values vs goldens.
    ├── bench/make_model_manifest.py               # Hashes all model files -> models_manifest.json.
    ├── bench/sideload_models.sh                   # adb-pushes models + manifest to the app dir.
    └── logs/phase2/                               # Phase 2 parity reports + phone/AI Hub logs (git-ignored).
src/
└── spotnack-muse/                                 # Yarn workspace root.
    ├── .yarn/                                     # Yarn Berry releases and cache.
    ├── client/                                    # React Native (Expo) app.
    │   ├── assets/                                # App icons, splash image, tab icons.
    │   ├── polyfills/
    │   │   └── process-emit-warning.js            # Stubs process.emitWarning for Hermes. Prevents three.js crash on startup.
    │   ├── src/
    │   │   ├── app/                               # Expo Router file-based routes (every file = a screen).
    │   │   │   ├── (tabs)/                        # Bottom-tab navigator group.
    │   │   │   │   ├── _layout.tsx                # Auth guard: redirects unauthenticated users; renders AppTabs.
    │   │   │   │   ├── explore.tsx                # Explore tab route (re-exports feature screen).
    │   │   │   │   ├── index.tsx                  # Home tab route.
    │   │   │   │   └── profile.tsx                # Profile tab route.
    │   │   │   ├── auth/
    │   │   │   │   ├── callback.tsx               # OAuth return handler: signals expo-web-browser, navigates to tabs or auth.
    │   │   │   │   └── sign-out.tsx               # Cognito sign-out deep-link handler: signals expo-web-browser, navigates to auth.
    │   │   │   ├── navigation/tabNavigator/
    │   │   │   │   └── app-tabs.tsx               # Tab bar config: icons, labels, and circular profile picture from auth context.
    │   │   │   ├── _layout.tsx                    # Root layout: wraps app with all context providers.
    │   │   │   ├── AuthScreen.tsx                 # Route shim: auth feature landing screen.
    │   │   │   ├── explore.tsx                    # Standalone explore route (outside tabs).
    │   │   │   ├── FavouritesScreen.tsx           # Route shim: favourites feature screen.
    │   │   │   ├── ForgotPasswordScreen.tsx       # Route shim → pass-reset feature screen.
    │   │   │   ├── index.tsx                      # Entry point: redirects to AuthScreen or (tabs). Based on auth state.
    │   │   │   ├── profile.tsx                    # Standalone profile route (outside tabs).
    │   │   │   ├── SignInScreen.tsx               # Route shim: sign-in feature screen.
    │   │   │   ├── SignUpScreen.tsx               # Route shim: sign-up feature screen.
    │   │   │   └── Stage3dScreen.tsx              # Full-screen 3D stage viewer.
    │   │   │   (dev-triposg.jsx deleted in part B; adb trigger is TripoSGDebugReceiver in the module).
    │   │   ├── config/
    │   │   │   └── api.js                         # Resolves the API base URL from the environment.
    │   │   ├── features/
    │   │   │   ├── auth/
    │   │   │   │   ├── application/
    │   │   │   │   │   └── auth.context.tsx       # AuthContextProvider: in-memory session, PKCE federated sign-in,
    │   │   │   │   │                              # sign-out. Exposes useAuth() hook.
    │   │   │   │   ├── infrastructure/
    │   │   │   │   │   ├── auth.api.ts            # HTTP calls to /api/auth/*. ValidationError class.
    │   │   │   │   │   └── demo-auth.config.js    # Demo auth mode: EXPO_PUBLIC_AUTH_MODE flag + guest user.
    │   │   │   │   └── presentation/screens/
    │   │   │   │       ├── auth/
    │   │   │   │       │   ├── auth.screen.tsx    # Landing screen, Sign in / Sign up buttons.
    │   │   │   │       │   └── auth.screen.styles.tsx         # Styled components for the auth landing screen.
    │   │   │   │       ├── sign-in/
    │   │   │   │       │   ├── sign-in.screen.tsx             # Email/password and Google/Apple sign-in view.
    │   │   │   │       │   ├── sign-in.screen.styles.tsx      # Styled components for the sign-in screen.
    │   │   │   │       │   └── sign-in.screen.view-model.ts   # State, handlers, and navigation for sign-in.
    │   │   │   │       ├── sign-up/
    │   │   │   │       │   ├── sign-up.screen.tsx             # Registration and email-verification view.
    │   │   │   │       │   ├── sign-up.screen.view-model.ts   # State, multi-step flow, and navigation for sign-up.
    │   │   │   │       │   └── sign-up.screen.styles.tsx      # Styled components for the sign-up screen.
    │   │   │   │       └── pass-reset/
    │   │   │   │           ├── pass-reset.screen.tsx          # Forgot/reset password two-step view.
    │   │   │   │           ├── pass-reset.screen.view-model.ts  # State, handlers, and navigation for password reset.
    │   │   │   │           └── pass-reset.screen.styles.ts    # StyleSheet styles and PLACEHOLDER_COLOR constant.
    │   │   │   ├── explore/
    │   │   │   │   ├── application/
    │   │   │   │   │   └── categories.context.js                      # CategoriesContextProvider: loads and exposes category items.
    │   │   │   │   ├── domain/
    │   │   │   │   │   └── category-item.port.ts                      # CategoryItem port (interface).
    │   │   │   │   ├── infrastructure/
    │   │   │   │   │   ├── mock-category-items/food/                  # 3D GLB food model assets.
    │   │   │   │   │   ├── categories.mapper.ts                       # Maps raw data to CategoryItem entities.
    │   │   │   │   │   ├── mock-category-items.data-source.js         # Loads mock items from JSON + GLB assets.
    │   │   │   │   │   └── mock-category-items.mock.json              # Seed data: names, descriptions, bookmark counts.
    │   │   │   │   └── presentation/
    │   │   │   │       ├── components/
    │   │   │   │       │   ├── explore-card/
    │   │   │   │       │   │   ├── explore-card.component.jsx         # The one card for library items and the user's creations: 3D viewer or placeholder, bookmark, optional options menu.
    │   │   │   │       │   │   ├── explore-card.component.styles.jsx  # Styled components for the explore card.
    │   │   │   │       │   │   ├── gl-availability.js                 # Non-fatal guard for expo-gl context failures (global-handler filter + subscriber notify).
    │   │   │   │       │   │   ├── gl-preview-policy.js               # Pure live-vs-static card policy + visible-id slicing.
    │   │   │   │       │   │   ├── gl-view-lease.js                   # App-wide cap (2) on concurrent live GL views + useGlViewLease hook.
    │   │   │   │       │   │   ├── glb-model-viewer.component.jsx     # Three.js Canvas.
    │   │   │   │       │   │   └── model-placeholder.component.jsx    # Stand-in for a model that can't be rendered (card and 3D stage).
    │   │   │   │       │   ├── explore-section-list/
    │   │   │   │       │   │   ├── explore-section-list.component.jsx # Horizontal section of cards, with loading/error states and per-item menu actions.
    │   │   │   │       │   │   └── explore-section-list.component.styles.jsx  # Styled components for the section list.
    │   │   │   │       │   └── searchbar/
    │   │   │   │       │       ├── searchbar.component.jsx            # Controlled search input that filters the category list.
    │   │   │   │       │       └── searchbar.component.styles.jsx     # Styled components for the search bar.
    │   │   │   │       └── screen/explore/
    │   │   │   │           ├── explore.screen.tsx                     # Explore screen view.
    │   │   │   │           ├── explore.screen.styles.tsx              # Styled components for the explore screen.
    │   │   │   │           └── explore.screen.view-model.ts           # Search state and filtered-items logic.
    │   │   │   ├── favourites/
    │   │   │   │   ├── application/
    │   │   │   │   │   └── favourites.context.jsx                     # Per-user AsyncStorage persistence. Resets on user change.
    │   │   │   │   └── presentation/
    │   │   │   │       ├── components/
    │   │   │   │       │   ├── favourites-card-button/
    │   │   │   │       │   │   ├── favourites-card-button.component.jsx         # Bookmark toggle button rendered inside each explore card.
    │   │   │   │       │   │   └── favourites-card-button.component.styles.jsx  # Styled components for the card bookmark button.
    │   │   │   │       │   ├── favourites-icon/
    │   │   │   │       │   │   └── favourites-icon.component.jsx                # Fontisto bookmark icon variants for the tab bar and card buttons.
    │   │   │   │       │   └── favourites-toggle-button/
    │   │   │   │       │       └── favourites-toggle-button.component.jsx       # Nav bar bookmark button that pushes to the favourites screen.
    │   │   │   │       └── screens/
    │   │   │   │           ├── favourites.screen.jsx                            # Scrollable list of bookmarked items with empty-state message.
    │   │   │   │           ├── favourites.screen.styles.jsx                     # Styled components for the favourites screen.
    │   │   │   │           └── favourites.screen.view-model.js                  # Resolves stored favourites, re-reading generated shapes from storage.
    │   │   │   ├── generated-shapes/
    │   │   │   │   ├── application/
    │   │   │   │   │   ├── generated-shapes-to-explore-item.mapper.js      # Maps a GeneratedShape to the CategoryItem shape explore cards expect.
    │   │   │   │   │   ├── generated-shapes.context.jsx                    # Thin context wrapper around useGeneratedShapes; shared live list across tabs.
    │   │   │   │   │   └── use-generated-shapes.hook.js                    # CRUD operations and live list of the signed-in user's generated shapes.
    │   │   │   │   ├── domain/
    │   │   │   │   │   ├── generated-shapes.entity.js                      # GeneratedShape entity, model formats, naming and validation helpers.
    │   │   │   │   │   └── generated-shapes.port.js                        # Port contract for generated-shapes persistence (satisfied by file-system.adapter).
    │   │   │   │   ├── infrastructure/
    │   │   │   │   │   ├── generated-shapes.file-system.adapter.js         # On-device adapter, per user: generated-assets/users/<sha256(user id)>/<id>/.
    │   │   │   │   │   └── generated-shapes.api.adapter.js                 # HTTP adapter implementing the same port against the Express backend.
    │   │   │   │   └── presentation/components/
    │   │   │   │       └── rename-generated-shape-dialog/                  # Cross-platform rename prompt (Alert.prompt is iOS-only). Creations render with explore's card.
    │   │   │   ├── home/
    │   │   │   │   └── presentation/screen/
    │   │   │   │       ├── home.screen.tsx              # Home screen: AI 3D Generator entry point.
    │   │   │   │       ├── home.screen.styles.tsx       # Styled components for the home screen.
    │   │   │   │       └── home.screen.view-model.ts    # Exposes the image-to-3D use case and its navigation.
    │   │   │   ├── image-to-3d/
    │   │   │   │   ├── application/
    │   │   │   │   │   ├── use-image-to-3d-conversion.hook.js      # Use case: pick an image, convert it, save it as a generated shape (ondevice port swap + persisted-job resume, no background cancel).
    │   │   │   │   │   ├── use-conversion-running.hook.js + .test.js  # Shared "a conversion is running" signal from the persisted job record (drives Explore static thumbnails).
    │   │   │   │   │   ├── persisted-job-plan.js + .test.js        # Pure resume/complete matrix over the persisted job record.
    │   │   │   │   │   └── use-model-management.hook.js            # Owns the TripoSG model set (download/pause/verify/delete) for the card row.
    │   │   │   │   ├── domain/
    │   │   │   │   │   ├── image-to-3d-conversion.entity.js        # Conversion states, photo permission + cancelled + unavailable errors.
    │   │   │   │   │   ├── image-to-3d.port.js                     # Ports for the conversion pipeline and the image source.
    │   │   │   │   │   └── model-management.port.js                # Model set states, byte formatting, download/space/sideload errors.
    │   │   │   │   ├── infrastructure/
    │   │   │   │   │   ├── image-library.adapter.js                # Image source backed by the device photo library (expo-image-picker).
    │   │   │   │   │   ├── placeholder-image-to-3d.adapter.js      # Simulated pipeline (no inference). Fallback when on-device is unavailable.
    │   │   │   │   │   ├── triposg-image-to-3d.adapter.js          # Real pipeline over @spotnack/triposg (events→port promise, label map, GLB copy, job attach + record clearing).
    │   │   │   │   │   ├── triposg-image-to-3d.adapter.test.js     # Progress/cancel/error/attach/copy mapping against a mocked native module.
    │   │   │   │   │   ├── model-management.adapter.js             # Derived model state + download/verify/delete over the native module.
    │   │   │   │   │   ├── model-management.adapter.test.js        # State machine (7 states, metered/space/sideload, corrupt retry).
    │   │   │   │   │   └── triposg-models.manifest.js              # GENERATED manifest copy (make_model_manifest.py --js-out).
    │   │   │   │   │   ├── demo-goldens.config.js                  # Demo mode: golden ids, URLs, bundled mesh modules, honest labels.
    │   │   │   │   │   ├── demo-goldens-image-source.adapter.js    # Demo source: round-robin over the 5 golden inputs (HTTP).
    │   │   │   │   │   ├── demo-goldens-image-to-3d.adapter.js     # Demo pipeline: copies the matching bundled display mesh.
    │   │   │   │   │   └── demo-goldens/<id>/mesh.display.glb      # 5 bundled display meshes (~80k faces, ~1.6 MB each).
    │   │   │   │   └── presentation/components/
    │   │   │   │       └── image-to-3d-card/                       # Home card: photo picker, preview, progress, model-status row, "Convert to 3D".
    │   │   │   ├── profile/
    │   │   │   │   └── presentation/screen/
    │   │   │   │       ├── profile.screen.tsx         # Profile screen: displays user info and sign-out button.
    │   │   │   │       └── profile.screen.styles.tsx  # Styled components for the profile screen.
    │   │   │   ├── search/
    │   │   │   │   ├── application/
    │   │   │   │   │   └── search.context.js              # SearchContextProvider: runs an initial "all" query and exposes onSearch.
    │   │   │   │   ├── domain/
    │   │   │   │   │   └── search-keyword.utils.js        # Keyword normalization, validation, and category filtering utilities.
    │   │   │   │   └── infrastructure/
    │   │   │   │       └── mock-search.adapter.js         # Mock search adapter: filters explore's category data in memory.
    │   │   │   └── stage-3d/
    │   │   │       └── presentation/screen/
    │   │   │           ├── stage-3d.screen.jsx            # Full-screen 3D viewer with back navigation and model name footer.
    │   │   │           └── stage-3d.screen.styles.jsx     # Styled components for the 3D stage screen.
    │   │   ├── hooks/
    │   │   │   ├── use-color-scheme.ts            # Re-exports useColorScheme from react-native.
    │   │   │   ├── use-fit-to-viewport.ts         # Sizes one flexible element so a ScrollView's content fits without scrolling.
    │   │   │   └── use-theme.ts                   # Returns the active theme color tokens for the current light/dark scheme.
    │   │   ├── shared/
    │   │   │   ├── theme/
    │   │   │   │   ├── theme.ts                   # Design tokens: Spacing, Size, Fonts, and ThemeColor.
    │   │   │   │   ├── themed-text.tsx            # Text component with type scale and theme color.
    │   │   │   │   └── themed-view.tsx            # View component that applies a background color from the current theme.
    │   │   │   └── ui/
    │   │   │       ├── animation/
    │   │   │       │   ├── blinking/              # Blinking animation component.
    │   │   │       │   ├── animated-logo.tsx      # AnimatedLogo (glow + elastic entrance) and AnimatedSplashOverlay.
    │   │   │       │   └── animated-logo.styles.tsx   # Styled components for the AnimatedLogo and AnimatedSplashOverlay.
    │   │   │       ├── app-logo/                  # Static app logo component.
    │   │   │       ├── infinite-scrolling/
    │   │   │       │   └── infinite-scrolling.component.jsx  # FlatList wrapper. Limits concurrent GL contexts; keeps loaded batches when data changes.
    │   │   │       └── safe-area/
    │   │   │           └── screen-container.tsx   # Full-screen safe-area wrapper with theme background.
    │   │   └── global.css                         # Global CSS (web target).
    │   ├── .gitignore                             # Git ignore for the client workspace.
    │   ├── modules/triposg/                       # Local Expo module: on-device TripoSG (Phase 3A + part B integration).
    │   │   ├── package.json + expo-module.config.json  # @spotnack/triposg (portal dep), autolink config.
    │   │   ├── app.plugin.js                      # Config plugin (in app.json): QNN jniLibs excludes (V79 + system only).
    │   │   ├── index.js                           # JS API: status/verify/convert/cancel/release + download/preflight/progress/delete + events.
    │   │   ├── THIRD_PARTY_LICENSES.md            # ORT, qnn-runtime, meshoptimizer, u2net, TripoSG, DINOv2.
    │   │   ├── android/build.gradle + CMakeLists.txt + src/main/AndroidManifest.xml  # ORT 1.29/QNN 2.50 from Maven, AAR extract for CMake, debug receiver.
    │   │   ├── android/.../TripoSGModule.kt       # Expo module: preflight, decode, job queue, progress events, download fns, idle-only trim release, job record (getPendingJob/clearJob).
    │   │   ├── android/.../TripoSGService.kt      # dataSync foreground service: notification + Cancel, wake lock, 1 Hz repaint, self-stop.
    │   │   ├── android/.../TripoSGJobs.kt         # Persisted job record (filesDir/triposg/job.json) + worker-alive flag.
    │   │   ├── android/.../TripoSGDownload.kt     # Resumable Range downloader (part files, sha256, manifest write).
    │   │   ├── android/.../TripoSGDebugReceiver.kt + TripoSGDebug  # Debuggable-only adb trigger (no UI).
    │   │   ├── android/.../cpp/jni_bridge.cpp     # JNI: engine singleton, progress callbacks, verify, debug entry.
    │   │   ├── cpp/pipeline.{h,cpp}               # Engine: sampler + VAE + extract + GLB orchestration.
    │   │   ├── cpp/preprocess.{h,cpp}             # u2net bg removal + prepare_image + DINOv2 preprocessing.
    │   │   ├── cpp/decimate.{h,cpp}               # meshoptimizer display decimation (default 100k tris).
    │   │   ├── cpp/models.{h,cpp}                 # Manifest parse + size/sha256 verification.
    │   │   ├── cpp/third_party/meshoptimizer/     # Vendored simplifier (v0.24) + fetch README.
    │   │   └── ios/TripoSGModule.swift + TripoSG.podspec  # iOS stub: reports unsupported.
    │   ├── .env.example                           # Example EXPO_PUBLIC_* vars (image-to-3D demo mode).
    │   ├── AGENTS.md                              # Agent instructions for this workspace.
    │   ├── app.json                               # Expo app config: name, scheme, icons, splash, and plugins.
    │   ├── app.config.js                          # Local variant: APP_VARIANT=ondevice -> com.spotnackmuse.ondevice.
    │   ├── expo-env.d.ts                          # Expo TypeScript environment declarations.
    │   ├── jest.config.js                         # Jest (jest-expo) config for client unit tests, with the tsconfig path aliases.
    │   ├── metro.config.js                        # Metro bundler config: .glb assets, process-emit-warning polyfill.
    │   ├── package.json                           # Client dependencies and scripts.
    │   └── tsconfig.json                          # Path aliases mirroring Babel config, for tsc/editor use.
    │
    ├── server/                                    # Express API.
    │   ├── src/
    │   │   ├── auth/
    │   │   │   ├── cognito/
    │   │   │   │   ├── cognito.errors.js          # Maps Cognito error codes to internal error constants.
    │   │   │   │   ├── cognito.middleware.js      # Express middleware: verifies Cognito JWT on protected routes.
    │   │   │   │   ├── cognito.service.js         # Cognito SDK calls: signUp, signIn, forgotPassword, etc.
    │   │   │   │   ├── jwks.js                    # Fetches and caches Cognito JWKS for JWT verification.
    │   │   │   │   └── verifyJwt.js               # Verifies and decodes a Cognito ID/access token.
    │   │   │   ├── session.js                     # Builds a session object from a verified Cognito token.
    │   │   │   └── user.js                        # Extracts user info from Cognito token claims.
    │   │   ├── config/
    │   │   │   ├── auth.config.js                 # Cognito client ID, user pool ID, hosted UI domain.
    │   │   │   └── env.js                         # Loads .env and exposes typed config values.
    │   │   ├── db/data/
    │   │   │   └── generated_shapes.json          # Persistent store for generated 3D shapes.
    │   │   ├── middlewares/
    │   │   │   ├── auth.security.middleware.js    # Rate-limiting and brute-force protection for auth routes.
    │   │   │   └── health.middleware.js           # Health-check handler.
    │   │   ├── routes/
    │   │   │   ├── index.js                       # Aggregates all routers and mounts them under /api.
    │   │   │   ├── auth.routes.js                 # All /api/auth/* endpoints.
    │   │   │   ├── health.routes.js               # GET /api/health.
    │   │   │   ├── models.routes.js               # Placeholder: AI model endpoints.
    │   │   │   └── payments.routes.js             # Placeholder: payments endpoints.
    │   │   └── validators/
    │   │       └── auth.validators.js             # Joi schemas for auth request bodies.
    │   ├── .env                                   # Local secrets (git-ignored).
    │   ├── .gitignore                             # Git ignore for the server workspace.
    │   ├── app.js                                 # Express app: security middleware, /api routes, and error handler.
    │   ├── eslint.config.js                       # Server ESLint flat config.
    │   ├── jest.config.cjs                        # Jest config for the server workspace (supertest, fast-check).
    │   ├── jest.setup.js                          # Redirects GENERATED_SHAPES_DATA_FILE to a temp file before tests.
    │   ├── package.json                           # Server dependencies and scripts.
    │   └── server.js                              # HTTP server entry point.
    │
    ├── .editorconfig                              # Consistent coding styles across editors and IDEs.
    ├── .flake8                                    # Flake8 (Python linter) configuration.
    ├── .gitattributes                             # Git attributes file.
    ├── .gitignore                                 # Git ignore for the workspace root.
    ├── .pre-commit-config.yaml                    # Git hooks: Black, Flake8, and ESLint.
    ├── .yarnrc.yml                                # Yarn 4 configuration.
    ├── environment.yml                            # Conda environment with Python dev tools.
    ├── eslint.config.cjs                          # ESLint flat config for the client workspace.
    ├── jest.config.cjs                            # Root Jest config: runs both workspaces' suites via `yarn test`.
    ├── package.json                               # Shared tooling, root scripts, and workspaces declaration.
    ├── tsconfig.json                              # Workspace-level TypeScript config. Extended by the client.
    └── yarn.lock                                  # Yarn lockfile.
│
PRIVACY_POLICY.md
README.md
```

</details>
<!-- #endregion -->

---

<!-- #region Tooling and CI -->
<details>
  <summary><h1 id="tooling">Tooling and CI</h1></summary>

- **Linting:** ESLint 9 flat config. `eslint.config.cjs` covers the client and `server/eslint.config.js` covers the server. Prettier is integrated through `eslint-plugin-prettier`. Run with `yarn lint` or `yarn lint:fix`.

- **Testing:** the root `jest.config.cjs` runs both workspaces through Jest `projects`. The client uses the `jest-expo` preset with `@testing-library/react-native`. The server uses Jest with `supertest`, and `jest.setup.js` redirects `GENERATED_SHAPES_DATA_FILE` to a temporary file. Both workspaces use `fast-check` for property-based tests. Run with `yarn test`.

- **Git hooks:** `.pre-commit-config.yaml` runs Black, Flake8, and ESLint. The Python tooling is defined in `environment.yml` (conda).

- **CI:** `.github/workflows/ci.yml` runs on pushes and pull requests to `main`. It installs dependencies, runs lint and tests, and then runs Black and Flake8.

</details>
<!-- #endregion -->
