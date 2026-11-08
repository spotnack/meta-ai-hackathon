// ViewModel Presentation logic layer: exposes the image-to-3D use case and the navigation it leads to.
// The screen itself stays presentation-only, i.e., no useContext, no business/domain logic.

import { Linking } from "react-native";
import { useRouter } from "expo-router";

import { useImageTo3dConversion } from "@features/image-to-3d/application/use-image-to-3d-conversion.hook";
import { useModelManagement } from "@features/image-to-3d/application/use-model-management.hook";
import { isOndeviceImageTo3dMode } from "@features/image-to-3d/infrastructure/image-to-3d-mode.config";

export const useHomeScreenViewModel = () => {
  const router = useRouter();
  const conversion = useImageTo3dConversion();
  const models = useModelManagement();

  // The model-status row only exists in on-device mode; elsewhere the card
  // keeps its placeholder behavior unchanged. Convert stays disabled
  // until the model set is installed (the hook still falls back to the
  // placeholder if the set vanishes mid-flight).
  const modelsVisible = isOndeviceImageTo3dMode();

  const viewResult = () => router.navigate("/(tabs)/explore");

  const openSettings = () => {
    Linking.openSettings().catch(() => {});
  };

  return {
    ...conversion,
    canConvert:
      conversion.canConvert && (!modelsVisible || models.modelsReady),
    viewResult,
    openSettings,
    modelsVisible,
    modelState: modelsVisible ? models.modelState : null,
    modelActionError: modelsVisible ? models.actionError : null,
    modelActionNotice: modelsVisible ? models.actionNotice : null,
    modelsWorking: models.isWorking,
    needsMeteredConfirm: models.needsMeteredConfirm,
    onDownloadModels: models.startDownload,
    onPauseDownloadModels: models.pauseDownload,
    onVerifyModels: models.verifyModels,
    onDeleteModels: models.deleteModels,
    onDismissModelNotice: models.dismissActionNotice,
  };
};
