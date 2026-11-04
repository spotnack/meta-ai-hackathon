// ViewModel Presentation logic layer: exposes the image-to-3D use case and the navigation it leads to.
// The screen itself stays presentation-only, i.e., no useContext, no business/domain logic.

import { Linking } from "react-native";
import { useRouter } from "expo-router";

import { useImageTo3dConversion } from "@features/image-to-3d/application/use-image-to-3d-conversion.hook";

export const useHomeScreenViewModel = () => {
  const router = useRouter();
  const conversion = useImageTo3dConversion();

  const viewResult = () => router.navigate("/(tabs)/explore");

  const openSettings = () => {
    Linking.openSettings().catch(() => {});
  };

  return { ...conversion, viewResult, openSettings };
};
