/*
Image-to-3D mode, chosen at build time by EXPO_PUBLIC_IMAGE_TO_3D_MODE:
"placeholder" (default) keeps the simulated adapter; "ondevice" runs the
real TripoSG module on gallery photos (Android SM8750 with installed
models, else the placeholder).
*/

export const IMAGE_TO_3D_MODES = Object.freeze({
  PLACEHOLDER: "placeholder",
  ONDEVICE: "ondevice",
});

export const isOndeviceImageTo3dMode = () =>
  process.env.EXPO_PUBLIC_IMAGE_TO_3D_MODE === IMAGE_TO_3D_MODES.ONDEVICE;
