import ExpoModulesCore

// iOS is not a Phase 3 target (no iOS device on hand; the recommended
// config is QNN HTP on Android). This stub keeps the app compiling and
// the placeholder path active: every call reports unsupported.
public class TripoSGModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TripoSG")

    Events("onProgress", "onDone", "onError", "onDownloadProgress")

    AsyncFunction("getStatus") { () -> [String: Any?] in
      return [
        "supported": false,
        "reason": "on-device TripoSG needs a Snapdragon 8 Elite Android phone; iOS is not supported",
        "modelDir": nil,
        "modelVersion": nil,
        "modelsVerified": nil
      ]
    }

    AsyncFunction("verifyModels") { (_: [String: Any]) -> [String: Any] in
      throw Exception(name: "unsupported", description: "on-device TripoSG is Android-only")
    }

    AsyncFunction("convert") { (_: [String: Any]) -> String in
      throw Exception(name: "unsupported", description: "on-device TripoSG is Android-only")
    }

    AsyncFunction("cancel") { (_: String) -> Bool in
      return false
    }

    AsyncFunction("getPendingJob") { () -> [String: Any?]? in
      return nil
    }

    AsyncFunction("clearJob") { (_: String) -> Bool in
      return false
    }

    AsyncFunction("release") { () -> Bool in
      return true
    }

    AsyncFunction("downloadPreflight") { (_: [String: Any]) -> [String: Any] in
      throw Exception(name: "unsupported", description: "on-device TripoSG is Android-only")
    }

    AsyncFunction("getDownloadProgress") { (_: [String: Any]) -> [String: Any] in
      throw Exception(name: "unsupported", description: "on-device TripoSG is Android-only")
    }

    AsyncFunction("startDownload") { (_: [String: Any]) -> [String: Any] in
      throw Exception(name: "unsupported", description: "on-device TripoSG is Android-only")
    }

    AsyncFunction("pauseDownload") { () -> Bool in
      return false
    }

    AsyncFunction("deleteModels") { (_: [String: Any]) -> [String: Any] in
      throw Exception(name: "unsupported", description: "on-device TripoSG is Android-only")
    }
  }
}
