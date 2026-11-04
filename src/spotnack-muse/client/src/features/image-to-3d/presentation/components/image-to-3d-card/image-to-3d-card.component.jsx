// React Components:
import { ActivityIndicator } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

// Theme:
import { ThemedText } from "@/shared/theme/themed-text";
import { useTheme } from "@/hooks/use-theme";

// Custom Components:
import { BlinkingAnimation } from "@shared/ui/animation/blinking/blinking-animation.component";

// Domain:
import { CONVERSION_STATUS } from "@features/image-to-3d/domain/image-to-3d-conversion.entity";
import { DEMO_PICKER_COPY } from "@features/image-to-3d/infrastructure/demo-goldens.config";

// Custom Styles:
import {
  Card,
  EmptyPicker,
  EmptyPickerIconCircle,
  CenteredText,
  PreviewFrame,
  PreviewImage,
  ClearButton,
  ChangePhotoButton,
  ImageSizeBadge,
  OnMediaText,
  ImageSizeText,
  ConvertingOverlay,
  ProgressTrack,
  ProgressFill,
  InlineButton,
  StatusRow,
  StatusText,
  LinkText,
  ConvertButton,
  ConvertGradientBorder,
  ConvertInner,
  ConvertButtonText,
  cardStyles,
  LINK_COLOR,
  ERROR_COLOR,
  SUCCESS_COLOR,
  ON_MEDIA_COLOR,
  PREVIEW_MAX_HEIGHT,
} from "./image-to-3d-card.component.styles";

export {
  PREVIEW_MIN_HEIGHT,
  PREVIEW_MAX_HEIGHT,
} from "./image-to-3d-card.component.styles";

/*
Pure presentational card: rendering only, no context/data-fetching of its own (props in, JSX out).
The Home screen's view model owns the conversion state and passes it down.
`previewHeight` sizes the card's only flexible part, so the parent can fit the whole card on screen.
*/
export const ImageTo3dCardComponent = ({
  selectedImage,
  status,
  progress,
  error,
  isPicking,
  isConverting,
  isCancelling = false,
  canConvert,
  canPickDemoImage = false,
  previewHeight = PREVIEW_MAX_HEIGHT,
  onPickImage,
  onPickDemoImage,
  onClearImage,
  onConvert,
  onCancelConversion,
  onViewResult,
  onOpenSettings,
}) => {
  const theme = useTheme();
  const percent = Math.round((progress?.fraction ?? 0) * 100);
  const isBusy = isPicking || isConverting;
  const hasImageSize = Boolean(selectedImage?.width && selectedImage?.height);
  // Demo builds: Change cycles the TripoSG goldens.
  const changeUsesDemo = canPickDemoImage && Boolean(onPickDemoImage);

  return (
    <Card>
      {selectedImage ? (
        <PreviewFrame style={{ height: previewHeight }}>
          <PreviewImage
            source={{ uri: selectedImage.uri }}
            accessibilityLabel="Selected image preview"
          />
          {!isBusy && (
            <>
              <ClearButton
                onPress={onClearImage}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Remove selected image"
              >
                <Ionicons name="close" size={18} color={ON_MEDIA_COLOR} />
              </ClearButton>
              <ChangePhotoButton
                onPress={changeUsesDemo ? onPickDemoImage : onPickImage}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  changeUsesDemo
                    ? DEMO_PICKER_COPY.changeAccessibilityLabel
                    : "Choose a different photo"
                }
              >
                <MaterialCommunityIcons
                  name="image-edit-outline"
                  size={16}
                  color={ON_MEDIA_COLOR}
                />
                <OnMediaText>Change</OnMediaText>
              </ChangePhotoButton>
              {hasImageSize && (
                <ImageSizeBadge>
                  <ImageSizeText>
                    {selectedImage.width} × {selectedImage.height}
                  </ImageSizeText>
                </ImageSizeBadge>
              )}
            </>
          )}
          {isConverting && (
            <ConvertingOverlay>
              <BlinkingAnimation>
                <MaterialCommunityIcons
                  name="cube-scan"
                  size={40}
                  color={ON_MEDIA_COLOR}
                />
              </BlinkingAnimation>
              <OnMediaText>
                {progress?.label || "Starting"}… {percent}%
              </OnMediaText>
              <ProgressTrack>
                <ProgressFill style={{ width: `${percent}%` }} />
              </ProgressTrack>
            </ConvertingOverlay>
          )}
        </PreviewFrame>
      ) : (
        <EmptyPicker
          onPress={onPickImage}
          disabled={isPicking}
          activeOpacity={0.75}
          style={{
            height: previewHeight,
            borderColor: `${theme.textSecondary}66`,
          }}
          accessibilityRole="button"
          accessibilityLabel="Choose a photo from your gallery"
          accessibilityState={{ busy: isPicking }}
        >
          <EmptyPickerIconCircle>
            {isPicking ? (
              <ActivityIndicator color={theme.text} />
            ) : (
              <MaterialCommunityIcons
                name="image-plus"
                size={28}
                color={theme.text}
              />
            )}
          </EmptyPickerIconCircle>
          <ThemedText type="smallBold">Choose a photo</ThemedText>
          <CenteredText type="small" themeColor="textSecondary">
            Pick a clear shot of a single object from your gallery.
          </CenteredText>
        </EmptyPicker>
      )}

      {!selectedImage && changeUsesDemo && (
        <StatusRow>
          <InlineButton
            onPress={onPickDemoImage}
            disabled={isPicking}
            accessibilityRole="button"
            accessibilityLabel={DEMO_PICKER_COPY.demoLink}
          >
            <MaterialCommunityIcons name="cube-outline" size={16} color={LINK_COLOR} />
            <LinkText>{DEMO_PICKER_COPY.demoLink}</LinkText>
          </InlineButton>
        </StatusRow>
      )}

      {error && (
        <StatusRow style={cardStyles.errorRow} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={18} color={ERROR_COLOR} />
          <StatusText style={{ color: ERROR_COLOR }}>{error.message}</StatusText>
          {error.canOpenSettings && (
            <InlineButton onPress={onOpenSettings} accessibilityRole="button">
              <LinkText>Settings</LinkText>
            </InlineButton>
          )}
        </StatusRow>
      )}

      {status === CONVERSION_STATUS.SUCCEEDED && (
        <StatusRow style={cardStyles.successRow}>
          <Ionicons name="checkmark-circle" size={18} color={SUCCESS_COLOR} />
          <StatusText>Saved to your 3D library</StatusText>
          <InlineButton
            onPress={onViewResult}
            accessibilityRole="button"
            accessibilityLabel="View the new asset in Explore"
          >
            <LinkText>View</LinkText>
            <Ionicons name="arrow-forward" size={16} color={LINK_COLOR} />
          </InlineButton>
        </StatusRow>
      )}

      {/* While converting, the primary action becomes "Stop" (progress is shown on the preview). */}
      {isConverting ? (
        <ConvertButton
          onPress={onCancelConversion}
          disabled={isCancelling || !onCancelConversion}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Stop conversion"
          accessibilityState={{ disabled: isCancelling, busy: isCancelling }}
        >
          <ConvertGradientBorder>
            <ConvertInner>
              {isCancelling ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Ionicons name="stop-circle-outline" size={20} color="#000" />
              )}
              <ConvertButtonText>
                {isCancelling ? "Stopping…" : "Stop conversion"}
              </ConvertButtonText>
            </ConvertInner>
          </ConvertGradientBorder>
        </ConvertButton>
      ) : (
        <ConvertButton
          onPress={onConvert}
          disabled={!canConvert}
          activeOpacity={0.85}
          style={!canConvert ? cardStyles.disabled : undefined}
          accessibilityRole="button"
          accessibilityLabel="Convert to 3D"
          accessibilityState={{ disabled: !canConvert }}
        >
          <ConvertGradientBorder>
            <ConvertInner>
              <MaterialCommunityIcons name="cube-outline" size={20} color="#000" />
              <ConvertButtonText>Convert to 3D</ConvertButtonText>
            </ConvertInner>
          </ConvertGradientBorder>
        </ConvertButton>
      )}
    </Card>
  );
};
