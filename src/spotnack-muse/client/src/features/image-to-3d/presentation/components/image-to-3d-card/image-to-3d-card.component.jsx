// React Components:
import { ActivityIndicator, Switch } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

// Theme:
import { ThemedText } from "@/shared/theme/themed-text";
import { useTheme } from "@/hooks/use-theme";

// Custom Components:
import { BlinkingAnimation } from "@shared/ui/animation/blinking/blinking-animation.component";
import { ModelNoticeModalComponent } from "../model-notice-modal/model-notice-modal.component";

// Domain:
import { CONVERSION_STATUS } from "@features/image-to-3d/domain/image-to-3d-conversion.entity";
import {
  MODEL_STATUS,
  formatBytes,
} from "@features/image-to-3d/domain/model-management.port";

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
  CutoutBadge,
  CutoutBadgeText,
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
  cutout = null,
  cutoutWorking = false,
  highDetail = false,
  setHighDetail = null,
  previewHeight = PREVIEW_MAX_HEIGHT,
  onPickImage,
  onClearImage,
  onConvert,
  onCancelConversion,
  onViewResult,
  onOpenSettings,
  modelState = null,
  modelActionError = null,
  modelActionNotice = null,
  modelsWorking = false,
  needsMeteredConfirm = false,
  onDownloadModels,
  onPauseDownloadModels,
  onVerifyModels,
  onDeleteModels,
  onDismissModelNotice,
}) => {
  const theme = useTheme();
  const percent = Math.round((progress?.fraction ?? 0) * 100);
  const isBusy = isPicking || isConverting;
  const hasImage = Boolean(selectedImage?.uri);
  const hasImageSize = Boolean(selectedImage?.width && selectedImage?.height);

  // On-device model set, when the row is shown (null otherwise).
  const modelStatus = modelState?.status ?? null;
  const modelTotal = formatBytes(modelState?.totalBytes ?? 0);
  const modelDone = formatBytes(modelState?.downloadedBytes ?? 0);
  const modelPercent =
    modelState?.totalBytes > 0
      ? Math.round((modelState.downloadedBytes / modelState.totalBytes) * 100)
      : 0;
  const modelBusy = modelsWorking || isConverting;
  // A full SHA-256 check passed in this app session.
  const modelVerified =
    modelStatus === MODEL_STATUS.INSTALLED && Boolean(modelState?.fullyVerified);
  const modelLine = (() => {
    switch (modelStatus) {
    case MODEL_STATUS.UNSUPPORTED:
      return (
        modelState.reason ?? "On-device 3D is not supported on this device."
      );
    case MODEL_STATUS.NOT_INSTALLED:
      return `TripoSG QNN model · ${modelTotal} · not downloaded${modelState.reason ? ` — ${modelState.reason}` : ""}`;
    case MODEL_STATUS.DOWNLOADING:
      return `Downloading TripoSG QNN model · ${modelDone} of ${modelTotal} · ${modelPercent}%`;
    case MODEL_STATUS.PAUSED:
      return `Download paused · ${modelDone} of ${modelTotal}`;
    case MODEL_STATUS.VERIFYING:
      return "Verifying TripoSG QNN model…";
    case MODEL_STATUS.INSTALLED:
      return `TripoSG QNN model · ${modelTotal} · ready`;
    case MODEL_STATUS.CORRUPT:
      return `TripoSG QNN model corrupt: ${modelState.reason ?? "verification failed"}`;
    default:
      return "";
    }
  })();
  const modelIcon =
    modelStatus === MODEL_STATUS.INSTALLED
      ? "checkmark-circle"
      : modelStatus === MODEL_STATUS.CORRUPT ||
          modelStatus === MODEL_STATUS.UNSUPPORTED
        ? "alert-circle-outline"
        : "cube-outline";

  return (
    <Card>
      {selectedImage ? (
        <PreviewFrame $height={previewHeight}>
          <PreviewImage
            source={{ uri: cutout?.uri ?? selectedImage.uri }}
            accessibilityLabel={
              cutout ? "Cut-out preview: what the model gets" : "Selected image preview"
            }
          />
          {!isBusy && cutout && (
            <CutoutBadge>
              <CutoutBadgeText>Cut-out preview</CutoutBadgeText>
            </CutoutBadge>
          )}
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
                onPress={onPickImage}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Choose a different photo"
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
                <ProgressFill $percent={percent} />
              </ProgressTrack>
            </ConvertingOverlay>
          )}
        </PreviewFrame>
      ) : (
        <EmptyPicker
          onPress={onPickImage}
          disabled={isPicking}
          activeOpacity={0.75}
          $height={previewHeight}
          $borderColor={`${theme.textSecondary}66`}
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
          <CenteredText type="small" themeColor="textSecondary">
            Works best with one object, fully in frame, on a plain background.
          </CenteredText>
        </EmptyPicker>
      )}

      {hasImage && !isConverting && cutoutWorking && (
        <StatusRow>
          <ActivityIndicator size="small" color={theme.text} />
          <StatusText>Checking cut-out…</StatusText>
        </StatusRow>
      )}
      {hasImage && !isConverting && !cutoutWorking && (cutout?.warnings ?? []).map((warning) => (
        <StatusRow key={warning.id}>
          <MaterialCommunityIcons
            name="alert-outline"
            size={16}
            color={theme.text}
          />
          <StatusText>{warning.message}</StatusText>
        </StatusRow>
      ))}

      {modelState && (
        <StatusRow>
          <Ionicons
            name={modelIcon}
            size={18}
            color={
              modelStatus === MODEL_STATUS.CORRUPT ||
              modelStatus === MODEL_STATUS.UNSUPPORTED
                ? ERROR_COLOR
                : modelStatus === MODEL_STATUS.INSTALLED
                  ? SUCCESS_COLOR
                  : theme.text
            }
          />
          <StatusText>{modelLine}</StatusText>
          {modelStatus === MODEL_STATUS.VERIFYING ? (
            <ActivityIndicator color={theme.text} size="small" />
          ) : (
            <>
              {(modelStatus === MODEL_STATUS.NOT_INSTALLED ||
                modelStatus === MODEL_STATUS.CORRUPT) && (
                <InlineButton
                  onPress={() => onDownloadModels?.()}
                  disabled={modelBusy || !onDownloadModels}
                  accessibilityRole="button"
                  accessibilityLabel="Download TripoSG QNN model"
                >
                  <Ionicons name="download-outline" size={16} color={LINK_COLOR} />
                  <LinkText>Download</LinkText>
                </InlineButton>
              )}
              {modelStatus === MODEL_STATUS.DOWNLOADING && (
                <InlineButton
                  onPress={() => onPauseDownloadModels?.()}
                  disabled={!onPauseDownloadModels}
                  accessibilityRole="button"
                  accessibilityLabel="Pause model download"
                >
                  <Ionicons name="pause" size={16} color={LINK_COLOR} />
                  <LinkText>Pause</LinkText>
                </InlineButton>
              )}
              {modelStatus === MODEL_STATUS.PAUSED && (
                <InlineButton
                  onPress={() => onDownloadModels?.()}
                  disabled={modelBusy || !onDownloadModels}
                  accessibilityRole="button"
                  accessibilityLabel="Resume model download"
                >
                  <Ionicons name="play" size={16} color={LINK_COLOR} />
                  <LinkText>Resume</LinkText>
                </InlineButton>
              )}
              {(modelStatus === MODEL_STATUS.PAUSED ||
                modelStatus === MODEL_STATUS.INSTALLED ||
                modelStatus === MODEL_STATUS.CORRUPT) && (
                <InlineButton
                  onPress={() => onDeleteModels?.()}
                  disabled={modelBusy || !onDeleteModels}
                  accessibilityRole="button"
                  accessibilityLabel="Delete TripoSG QNN model"
                >
                  <Ionicons name="trash-outline" size={16} color={LINK_COLOR} />
                  <LinkText>Delete</LinkText>
                </InlineButton>
              )}
              {modelStatus === MODEL_STATUS.INSTALLED && (
                <InlineButton
                  onPress={() => onVerifyModels?.()}
                  // Once a full check passed, the button is only a badge.
                  disabled={modelVerified || modelBusy || !onVerifyModels}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: modelVerified }}
                  accessibilityLabel={
                    modelVerified
                      ? "TripoSG QNN model verified"
                      : "Verify TripoSG QNN model"
                  }
                >
                  <Ionicons
                    name={modelVerified ? "shield-checkmark" : "shield-checkmark-outline"}
                    size={16}
                    color={modelVerified ? SUCCESS_COLOR : LINK_COLOR}
                  />
                  <LinkText $color={modelVerified ? SUCCESS_COLOR : undefined}>
                    {modelVerified ? "Verified" : "Verify"}
                  </LinkText>
                </InlineButton>
              )}
            </>
          )}
        </StatusRow>
      )}

      {modelState?.status === MODEL_STATUS.DOWNLOADING && (
        <ProgressTrack>
          <ProgressFill $percent={modelPercent} />
        </ProgressTrack>
      )}

      {needsMeteredConfirm && (
        <StatusRow>
          <Ionicons name="cellular-outline" size={18} color={theme.text} />
          <StatusText>Models are ~7 GB. Download over mobile data?</StatusText>
          <InlineButton
            onPress={() => onDownloadModels?.({ allowMetered: true })}
            disabled={modelBusy || !onDownloadModels}
            accessibilityRole="button"
            accessibilityLabel="Download models over mobile data"
          >
            <LinkText>Download anyway</LinkText>
          </InlineButton>
        </StatusRow>
      )}

      <ModelNoticeModalComponent
        message={modelActionNotice}
        onDismiss={onDismissModelNotice}
      />

      {modelActionError && (
        <StatusRow $tone="error" accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={18} color={ERROR_COLOR} />
          <StatusText $isError>{modelActionError}</StatusText>
        </StatusRow>
      )}

      {error && (
        <StatusRow $tone="error" accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={18} color={ERROR_COLOR} />
          <StatusText $isError>{error.message}</StatusText>
          {error.canOpenSettings && (
            <InlineButton onPress={onOpenSettings} accessibilityRole="button">
              <LinkText>Settings</LinkText>
            </InlineButton>
          )}
        </StatusRow>
      )}

      {status === CONVERSION_STATUS.SUCCEEDED && (
        <StatusRow $tone="success">
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

      {/* High-detail extraction (d1 9, 200k display mesh): the full-res
          mesh keeps the detail and the display mesh shows more of it. Off
          by default; costs about one to two minutes (75 s measured, more
          when the phone is warm). */}
      {hasImage && !isConverting && setHighDetail && (
        <StatusRow>
          <StatusText>High detail</StatusText>
          <ThemedText type="small" themeColor="textSecondary">
            ≈ +1–2 min
          </ThemedText>
          <Switch
            value={highDetail}
            onValueChange={setHighDetail}
            accessibilityRole="switch"
            accessibilityLabel="High detail extraction"
          />
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
          $dimmed={!canConvert}
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
