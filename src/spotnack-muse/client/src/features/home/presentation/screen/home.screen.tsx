// View layer: imports JSX/TSX components.

import { ThemedText } from "@/shared/theme/themed-text";
import { SafeScreenContainer } from "@/shared/ui/safe-area/screen-container";
import { useFitToViewport } from "@/hooks/use-fit-to-viewport";

import {
  HomeScreenContainer,
  TopMenuContainer,
  CenterText,
  TitleContainer,
  ConverterContainer,
  HomeScrollView,
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
        <HomeScrollView {...scrollViewProps}>
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
              cutout={vm.cutout}
              cutoutWorking={vm.cutoutWorking}
              highDetail={vm.highDetail}
              setHighDetail={vm.setHighDetail}
              previewHeight={previewHeight}
              onPickImage={vm.pickImage}
              onClearImage={vm.clearImage}
              onConvert={vm.convert}
              onCancelConversion={vm.cancelConversion}
              onViewResult={vm.viewResult}
              onOpenSettings={vm.openSettings}
              modelState={vm.modelsVisible ? vm.modelState : null}
              modelActionError={vm.modelsVisible ? vm.modelActionError : null}
              modelActionNotice={vm.modelsVisible ? vm.modelActionNotice : null}
              modelsWorking={vm.modelsWorking}
              needsMeteredConfirm={vm.needsMeteredConfirm}
              onDownloadModels={vm.onDownloadModels}
              onPauseDownloadModels={vm.onPauseDownloadModels}
              onVerifyModels={vm.onVerifyModels}
              onDeleteModels={vm.onDeleteModels}
              onDismissModelNotice={vm.onDismissModelNotice}
            />
          </ConverterContainer>
        </HomeScrollView>
      </HomeScreenContainer>
    </SafeScreenContainer>
  );
}
