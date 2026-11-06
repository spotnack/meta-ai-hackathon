// React Hooks:
import { useState, useEffect } from "react";

// React Components:
import { FlatList } from "react-native-gesture-handler";

// Pagination helper:
export const getLoadedBatches = (data, batchCount, batchSize) => {
  /*
   * Returns every data value of the first `batchCount` batches, i.e. everything loaded so far.
   *
   * @param (array) data - Array of data values.
   * @param (number) batchCount - Number of batches loaded.
   * @param (number) batchSize - Number of data values to render per batch.
   * @returns {array} The loaded data values, in order.
   */
  return data.slice(0, batchCount * batchSize);
};

// Component:
export const InfiniteScrolling = ({
  data,
  batchSize,
  renderItem,
  keyExtractor,
  extraData,
  showsHorizontalScrollIndicator,
  horizontal,
  onViewableItemsChanged,
  viewabilityConfig,
  snapToAlignment,
  scrollEventThrottle,
  decelerationRate,
  pagingEnabled,
  onEndReachedThreshold,
  enableSnapping = false,
}) => {
  /*
   * This component is responsible for rendering a FlatList component with infinite scrolling capabilities.
   * `extraData` is forwarded to the FlatList, so cells re-render when state outside `data` changes.
   */

  console.log(
    "- Rendering InfiniteScrolling component from infinite-scrolling.component.jsx",
  );
  const [currentBatch, setCurrentBatch] = useState(1);
  const [renderedData, setRenderedData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleEndReached = () => {
    /*
     * This function is responsible for handling the end of the current batch and loading the next batch.
     */
    console.log("- End of current batch.");
    if (isLoading) {
      return;
    }
    setIsLoading(true);
    const nextBatch = currentBatch + 1;
    const nextData = getLoadedBatches(data, nextBatch, batchSize);
    if (nextData.length > renderedData.length) {
      setRenderedData(nextData);
      setCurrentBatch(nextBatch);
      console.log(
        `- currentBatch: ${nextBatch} with a total of ${nextData.length} data values.`,
      );
    } else {
      console.log("- No more data to render.");
    }
    setIsLoading(false);
  };

  useEffect(() => {
    // Keep every batch loaded so far: a changed list (search, delete, rename) shows the same span
    // of the new data instead of only the last batch.
    setRenderedData(getLoadedBatches(data, currentBatch, batchSize));
  }, [data]); // Only re-run the effect if data changes.

  console.log(
    `- currentBatch: ${currentBatch} with a total of ${renderedData.length} data values.`,
  );

  return (
    <FlatList
      data={renderedData}
      keyExtractor={keyExtractor}
      extraData={extraData}
      showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
      horizontal={horizontal}
      {...(onViewableItemsChanged && { onViewableItemsChanged })}
      {...(viewabilityConfig && { viewabilityConfig })}
      {...(snapToAlignment && { snapToAlignment })}
      {...(scrollEventThrottle && { scrollEventThrottle })}
      {...(decelerationRate && { decelerationRate })}
      {...(pagingEnabled && { pagingEnabled })}
      snapToAlignment={enableSnapping ? snapToAlignment : undefined}
      pagingEnabled={enableSnapping ? pagingEnabled : false}
      onEndReachedThreshold={onEndReachedThreshold}
      onEndReached={handleEndReached}
      renderItem={renderItem}
      initialNumToRender={1}
      maxToRenderPerBatch={1}
      // Cards host GL canvases. Clipping detaches an off-screen view from the window, and on Android a detached
      // GLView destroys its GL context, which breaks the card (or crashes three.js mid-setup). Instead,
      // windowSize bounds how many cards stay mounted; cards far off screen unmount cleanly.
      removeClippedSubviews={false}
      windowSize={5}
    />
  );
};
