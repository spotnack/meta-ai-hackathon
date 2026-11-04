// View layer: imports JSX/TSX components.

import { ScrollView } from "react-native";

import { ThemedText } from "@/shared/theme/themed-text";
import { SafeScreenContainer } from "@/shared/ui/safe-area/screen-container";
import { useFitToViewport } from "@/hooks/use-fit-to-viewport";

import {
  HomeScreenContainer,
  TopMenuContainer,
  CenterText,
  TitleContainer,
  ConverterContainer,
  homeStyles,
} from "./home.screen.styles";

import { AppLogo } from "@shared/ui/app-logo/app-logo.component";
import {
  ImageTo3dCardComponent,
  PREVIEW_MIN_HEIGHT,
  PREVIEW_MAX_HEIGHT,
} from "@features/image-to-3d/presentation/components/image-to-3d-card/image-to-3d-card.component";

// ViewModel
import { useHomeScreenViewModel } from "./home.screen.view-model";

/**
 * Home screen: AI inference.
 * @returns {React.JSX.Element} Home screen.
 */
export default function HomeScreen() {
  const vm = useHomeScreenViewModel();
  // The card's preview takes whatever height is left, so the whole card stays on screen
  // as status rows (success, error) come and go.
  const { flexibleHeight: previewHeight, scrollViewProps } = useFitToViewport({
    min: PREVIEW_MIN_HEIGHT,
    max: PREVIEW_MAX_HEIGHT,
  });

  return (
    <SafeScreenContainer>
      <HomeScreenContainer>
        <ScrollView
          contentContainerStyle={homeStyles.scrollContent}
          {...scrollViewProps}
        >
          <TopMenuContainer>
            <AppLogo />
          </TopMenuContainer>
          <TitleContainer>
            <ThemedText type="title">AI 3D Generator</ThemedText>
            <CenterText>
              Image-to-3D generation using on-device rectified flow transformers
            </CenterText>
          </TitleContainer>
          <ConverterContainer>
            <ImageTo3dCardComponent
              selectedImage={vm.selectedImage}
              status={vm.status}
              progress={vm.progress}
              error={vm.error}
              isPicking={vm.isPicking}
              isConverting={vm.isConverting}
              isCancelling={vm.isCancelling}
              canConvert={vm.canConvert}
              canPickDemoImage={vm.canPickDemoImage}
              previewHeight={previewHeight}
              onPickImage={vm.pickImage}
              onPickDemoImage={vm.pickDemoImage}
              onClearImage={vm.clearImage}
              onConvert={vm.convert}
              onCancelConversion={vm.cancelConversion}
              onViewResult={vm.viewResult}
              onOpenSettings={vm.openSettings}
            />
          </ConverterContainer>
        </ScrollView>
      </HomeScreenContainer>
    </SafeScreenContainer>
  );
}
