/*
Local test variant of the Expo config (Phase 3A).

app.json stays the committed base (preview: com.spotnackmuse). When
APP_VARIANT=ondevice, this variant installs side by side with the
preview build under com.spotnackmuse.ondevice (different package, so a
different signing key is fine and nothing is uninstalled). Expo reads
app.json first and passes it in as `config`; without the env var the
config passes through untouched.
*/
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT !== "ondevice") {
    return { ...config };
  }
  return {
    ...config,
    name: "spotnack (on-device)",
    android: {
      ...config.android,
      package: "com.spotnackmuse.ondevice",
    },
  };
};
