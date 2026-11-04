// React Components:
import { useState } from "react";
import { ActivityIndicator, Modal, Platform } from "react-native";

// Theme:
import { ThemedText } from "@/shared/theme/themed-text";
import { useTheme } from "@/hooks/use-theme";

// Domain:
import {
  GENERATED_SHAPE_NAME_MAX_LENGTH,
  isGeneratedShapeNameValid,
} from "@features/generated-shapes/domain/generated-shapes.entity";

// Custom Styles:
import {
  DialogLayout,
  Backdrop,
  DialogPanel,
  DialogTitle,
  NameInput,
  ErrorText,
  ActionsRow,
  ActionButton,
  SaveText,
  LINK_COLOR,
} from "./rename-generated-shape-dialog.component.styles";

/*
Cross-platform rename prompt (Alert.prompt is iOS-only). Presentational: it owns only the draft text.
The parent mounts it while a rename is in progress and decides what saving does.
Save is disabled until the trimmed name is valid and different from the current one.
*/
export const RenameGeneratedShapeDialogComponent = ({
  currentName,
  isSaving = false,
  error,
  onCancel,
  onSubmit,
}) => {
  const theme = useTheme();
  const [draftName, setDraftName] = useState(currentName ?? "");

  const trimmedName = draftName.trim();
  const canSave =
    !isSaving &&
    isGeneratedShapeNameValid(trimmedName) &&
    trimmedName !== currentName;

  const save = () => {
    if (canSave) onSubmit(trimmedName);
  };

  const cancel = () => {
    if (!isSaving) onCancel();
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={cancel}>
      <DialogLayout behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Backdrop onPress={cancel} accessibilityLabel="Dismiss" />
        <DialogPanel accessibilityViewIsModal>
          <DialogTitle>Rename asset</DialogTitle>
          <NameInput
            value={draftName}
            onChangeText={setDraftName}
            onSubmitEditing={save}
            editable={!isSaving}
            autoFocus
            selectTextOnFocus
            maxLength={GENERATED_SHAPE_NAME_MAX_LENGTH}
            returnKeyType="done"
            placeholder="Asset name"
            placeholderTextColor={theme.textSecondary}
            selectionColor={LINK_COLOR}
            style={{
              color: theme.text,
              backgroundColor: theme.background,
              borderColor: `${theme.textSecondary}66`,
            }}
            accessibilityLabel="Asset name"
          />
          {error ? <ErrorText accessibilityRole="alert">{error}</ErrorText> : null}
          <ActionsRow>
            <ActionButton
              onPress={cancel}
              disabled={isSaving}
              accessibilityRole="button"
            >
              <ThemedText type="smallBold" themeColor="textSecondary">
                Cancel
              </ThemedText>
            </ActionButton>
            <ActionButton
              onPress={save}
              disabled={!canSave}
              style={!canSave && !isSaving ? { opacity: 0.4 } : undefined}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave, busy: isSaving }}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={LINK_COLOR} />
              ) : (
                <SaveText>Save</SaveText>
              )}
            </ActionButton>
          </ActionsRow>
        </DialogPanel>
      </DialogLayout>
    </Modal>
  );
};
