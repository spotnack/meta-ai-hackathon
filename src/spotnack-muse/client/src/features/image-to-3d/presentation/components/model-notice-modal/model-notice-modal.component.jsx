// React Components:
import { useEffect, useMemo, useRef } from "react";
import { Animated, Modal, PanResponder } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Custom Styles:
import {
  ModalLayout,
  Backdrop,
  SwipeLayer,
  NoticePanel,
  NoticeTitle,
  NoticeText,
  HintText,
  SUCCESS_COLOR,
} from "./model-notice-modal.component.styles";

// A swipe past this distance (px, any direction) dismisses the pop-up.
const DISMISS_DISTANCE = 80;

/*
Pop-up confirmation for a model action that passed (a full Verify).
Presentational: it shows while `message` is set and calls onDismiss when the
user swipes it away, taps outside it, or presses Back.
*/
export const ModelNoticeModalComponent = ({
  title = "Verified",
  message,
  onDismiss,
}) => {
  const offset = useRef(new Animated.ValueXY()).current;
  const visible = Boolean(message);

  // Reset the position each time a new notice opens.
  useEffect(() => {
    if (visible) offset.setValue({ x: 0, y: 0 });
  }, [visible, offset]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        onPanResponderMove: Animated.event([null, { dx: offset.x, dy: offset.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_, g) => {
          if (Math.hypot(g.dx, g.dy) > DISMISS_DISTANCE) {
            // Fly out the way it was swiped, then close.
            const scale = 600 / Math.max(Math.hypot(g.dx, g.dy), 1);
            Animated.timing(offset, {
              toValue: { x: g.dx * scale, y: g.dy * scale },
              duration: 160,
              useNativeDriver: false,
            }).start(() => onDismiss?.());
          } else {
            Animated.spring(offset, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: false,
            }).start();
          }
        },
      }),
    [offset, onDismiss],
  );

  const distance = Animated.add(
    Animated.multiply(offset.x, offset.x),
    Animated.multiply(offset.y, offset.y),
  );
  const opacity = distance.interpolate({
    inputRange: [0, 300 * 300],
    outputRange: [1, 0.2],
    extrapolate: "clamp",
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onDismiss?.()}
    >
      <ModalLayout>
        <Backdrop onPress={() => onDismiss?.()} accessibilityLabel="Dismiss" />
        <SwipeLayer
          {...panResponder.panHandlers}
          $opacity={opacity}
          $offset={offset}
        >
          <NoticePanel accessibilityViewIsModal accessibilityLiveRegion="polite">
            <Ionicons name="shield-checkmark" size={36} color={SUCCESS_COLOR} />
            <NoticeTitle>{title}</NoticeTitle>
            <NoticeText>{message}</NoticeText>
            <HintText>Swipe to dismiss</HintText>
          </NoticePanel>
        </SwipeLayer>
      </ModalLayout>
    </Modal>
  );
};
