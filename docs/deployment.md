<div align='center'>
  <h1> Deployment Guide </h1>
</div>

# Table of Contents

- [Build an APK for Device Testing](#build-an-apk-for-device-testing)
- [Build Production App Binaries](#build-production-app-binaries)
- [Backend Deployment](#backend-deployment)
- [References](#references)

---

# Build an APK for Device Testing

Build an installable Android APK for direct installation on a physical device. The following commands should be run in the `client` directory containing the Expo project.

1. One-time EAS setup:

```bash
# 1. Navigate to the Expo project:
cd client
# 2. Log in to your Expo account:
npx eas-cli login
# 3. Initialize or link the EAS project:
npx eas-cli init
# 4. Configure EAS Build and generate eas.json:
npx eas-cli build:configure
```

2. Configure the APK build profile:

Ensure that src/spotnack/client/eas.json contains a preview profile configured to generate an APK:

```json
{
  "cli": {
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

If eas.json already contains other profiles, preserve them and add or update the preview profile.

3. Build the APK:

Build an APK for device testing:

```bash
npx eas-cli build --platform android --profile preview
```

When the build completes, download the APK from the EAS build page and install it on the Android device.

For USB installation, download the APK to the computer and run:

```bash
adb install path/to/your-app.apk
```

The device and computer must have USB debugging configured for ADB installation.

---

# Build Production App Binaries

Use EAS Build to generate production binaries for Android and iOS.

```bash
# 1. Navigate to the Expo project:
cd client
# 2. Check the EAS CLI:
npx eas-cli -v
# 3. Log in to your Expo account:
npx eas-cli login
npx eas-cli whoami
# The following commands are optional diagnostics:
npx eas-cli -h
npx eas-cli build -h
# 4. If the project has not already been linked and configured:
npx eas-cli init
npx eas-cli build:configure
```

Ensure that src/spotnack/client/eas.json has a production build profile and that the Expo app configuration contains the required application identifiers:

```json
{
  "cli": {
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "autoIncrement": true
    }
  }
}
```

```bash
# 6. Build production binaries for Android and iOS:
npx eas-cli build --platform all --profile production
```

By default, the Android production build uses an Android App Bundle (AAB), which is intended for Google Play distribution. The iOS build produces an iOS application binary for the configured distribution method.

If an installable Android APK is needed instead, use the APK profile described in the device-testing section.

---

# Backend Deployment

The backend is hosted on AWS.

The mobile application must use a reachable API base URL configured for the target environment. Do not use localhost as the API hostname in a standalone mobile build unless the API is running on the device itself.

Configure the production API URL through the appropriate Expo public environment variable and ensure that the backend is deployed, accessible, and configured for production.

---

# References

1. [Expo CLI](https://docs.expo.dev/more/expo-cli/)
2. [EAS CLI Reference](https://docs.expo.dev/eas/cli/)
3. [Build APKs for Android Emulators and Devices](https://docs.expo.dev/build-reference/apk/)
4. [EAS Build Configuration](https://docs.expo.dev/build-reference/build-configuration/)
5. [Create Your First Build](https://docs.expo.dev/build/setup/)
