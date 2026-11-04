import { isRenderableGeneratedShapeModel } from "../domain/generated-shapes.entity";
import {
  DEMO_ATTRIBUTION_LABEL,
  isDemoGenerator,
} from "@features/image-to-3d/infrastructure/demo-goldens.config";

// Tags explore items that came from a generated shape, so features that store items
// (e.g. favourites) can tell them apart from library items and render them accordingly.
export const GENERATED_SHAPE_ITEM_KIND = "generated-shape";

/*
Boundary mapper: adapts a GeneratedShape (see domain/generated-shapes.entity.js)
into the shape explore's presentation layer already knows how to render
(see features/explore/domain/category-item.port.js).
This keeps the two features' domains decoupled - explore's card/detail
components never need to learn a second item shape.
`thumbnail` only lists models the 3D viewer can render, so placeholder models fall back to a preview image.
`ownerId` lets screens tell the signed-in user's own items (which they may manage) from everyone else's.
*/
export const generatedShapeToExploreItem = (generatedShape) => ({
  id: generatedShape?.id,
  kind: GENERATED_SHAPE_ITEM_KIND,
  ownerId: generatedShape?.ownerId ?? null,
  name: generatedShape?.name ?? "",
  thumbnail: isRenderableGeneratedShapeModel(generatedShape?.model)
    ? [generatedShape.model.uri]
    : [],
  photos: generatedShape?.image ? [generatedShape.image] : [],
  bookmarkCount: 0,
  createdAt: generatedShape?.createdAt ?? null,
  generator: generatedShape?.generator ?? null,
  // Honest demo label: set only for cloud-GPU golden assets, never for
  // on-device output. Explore and Stage render it when present.
  demoAttribution: isDemoGenerator(generatedShape?.generator)
    ? DEMO_ATTRIBUTION_LABEL
    : null,
});

export const isGeneratedShapeItem = (item) =>
  item?.kind === GENERATED_SHAPE_ITEM_KIND;

// The user's own content vs the world's: only an item's owner may manage (rename, delete) it.
// Library items have no owner, so they belong to no one.
export const isItemOwnedByUser = (item, userId) =>
  Boolean(userId) && item?.ownerId === userId;
