import { useLayoutEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

type FitBounds = { min: number; max: number };

/**
 * Height the flexible element needs for the content to exactly fill the viewport, clamped to its bounds.
 * @param {object} root0 - Measurements.
 * @param {number} root0.viewportHeight - Visible height of the ScrollView.
 * @param {number} root0.contentHeight - Measured height of the ScrollView's content.
 * @param {number} root0.measuredFlexibleHeight - Height the flexible element had when the content was measured.
 * @param {number} root0.min - Smallest allowed height.
 * @param {number} root0.max - Largest allowed height.
 * @returns {number} The flexible element's new height.
 */
export function fitFlexibleHeight({
  viewportHeight,
  contentHeight,
  measuredFlexibleHeight,
  min,
  max,
}: FitBounds & {
  viewportHeight: number;
  contentHeight: number;
  measuredFlexibleHeight: number;
}) {
  const restOfContentHeight = contentHeight - measuredFlexibleHeight;
  const height = Math.floor(viewportHeight - restOfContentHeight);
  return Math.min(max, Math.max(min, height));
}

/**
 * Sizes one flexible element (e.g. an image preview) so a ScrollView's content fits its viewport without
 * scrolling, whatever the device height. The element absorbs the space the rest of the content leaves,
 * between `min` and `max`. Below `min` the content scrolls as usual instead of squeezing further.
 *
 * Spread `scrollViewProps` on the ScrollView and give the element a height of `flexibleHeight`.
 * The content container must not stretch (no flexGrow), so its measured height is the content's own.
 * @param {FitBounds} root0 - Height bounds for the flexible element.
 * @param {number} root0.min - Smallest allowed height.
 * @param {number} root0.max - Largest allowed height, also used before the first measurement.
 * @returns {{ flexibleHeight: number, scrollViewProps: object }} The height to apply and the ScrollView handlers.
 */
export function useFitToViewport({ min, max }: FitBounds) {
  const [flexibleHeight, setFlexibleHeight] = useState(max);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const measuredFlexibleHeight = useRef(max);
  // The height the on-screen content was laid out with. Updated before native layout events arrive.
  const committedFlexibleHeight = useRef(max);

  useLayoutEffect(() => {
    committedFlexibleHeight.current = flexibleHeight;
  }, [flexibleHeight]);

  const fit = () => {
    if (!viewportHeight.current || !contentHeight.current) return;
    setFlexibleHeight(
      fitFlexibleHeight({
        viewportHeight: viewportHeight.current,
        contentHeight: contentHeight.current,
        measuredFlexibleHeight: measuredFlexibleHeight.current,
        min,
        max,
      }),
    );
  };

  const scrollViewProps = {
    onLayout: (event: LayoutChangeEvent) => {
      viewportHeight.current = event.nativeEvent.layout.height;
      fit();
    },
    onContentSizeChange: (_width: number, height: number) => {
      contentHeight.current = height;
      measuredFlexibleHeight.current = committedFlexibleHeight.current;
      fit();
    },
  };

  return { flexibleHeight, scrollViewProps };
}
