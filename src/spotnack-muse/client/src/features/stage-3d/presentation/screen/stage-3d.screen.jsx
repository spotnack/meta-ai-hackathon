// React
import { useMemo } from "react";

// Expo
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

// Theme
import { ThemedText } from "@/shared/theme/themed-text";

// React Three Drei
import { useGLTF } from "@react-three/drei";

// Components
import { GlbModelViewer } from "@/features/explore/presentation/components/explore-card/glb-model-viewer.component";
import { ModelPlaceholderComponent } from "@/features/explore/presentation/components/explore-card/model-placeholder.component";

// Styles
import {
  Stage3dContainer,
  HeaderRow,
  BackButton,
  CanvasContainer,
  NameFooter,
  NameText,
  SafeArea,
  STAGE_BACKGROUND,
  BACK_ICON_COLOR,
  BACK_ICON_SIZE,
} from "./stage-3d.screen.styles";

export const Stage3dScreen = () => {
  const router = useRouter();
  const { item: itemJson } = useLocalSearchParams();
  const item = itemJson ? JSON.parse(String(itemJson)) : null;
  const modelUri = item?.thumbnail?.[0];

  // Kick off the GLB load immediately during render, before the Canvas mounts.
  useMemo(() => {
    if (modelUri) useGLTF.preload(modelUri);
  }, [modelUri]);

  return (
    <Stage3dContainer>
      <SafeArea>
        <HeaderRow>
          <BackButton onPress={() => router.back()}>
            <Ionicons
              name="arrow-back"
              size={BACK_ICON_SIZE}
              color={BACK_ICON_COLOR}
            />
          </BackButton>
        </HeaderRow>
        <CanvasContainer>
          {modelUri ? (
            // Opened by explicit tap, so this viewer always attempts live GL;
            // if the context cannot be created it shows the photo fallback
            // with a message instead of crashing.
            <GlbModelViewer
              uri={modelUri}
              fill
              scaleFactor={0.6}
              background={STAGE_BACKGROUND}
              showShadows
              photoUri={item?.photos?.[0] ?? null}
              fallbackCaption="3D preview isn't available right now. Your model is safe — try opening it again."
            />
          ) : (
            // The user's own creations have no 3D model until the AI pipeline generates one.
            <ModelPlaceholderComponent
              photoUri={item?.photos?.[0]}
              fill
              background={STAGE_BACKGROUND}
              iconSize={72}
              caption="No 3D model yet. It will appear here once it has been generated."
            />
          )}
        </CanvasContainer>
        {item?.name && (
          <NameFooter>
            <NameText>{item.name}</NameText>
            {item?.demoAttribution ? (
              <ThemedText type="small">{item.demoAttribution}</ThemedText>
            ) : null}
          </NameFooter>
        )}
      </SafeArea>
    </Stage3dContainer>
  );
};
