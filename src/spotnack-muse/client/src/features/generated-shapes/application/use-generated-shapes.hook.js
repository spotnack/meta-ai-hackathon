import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@features/auth/application/auth.context";

import { createGeneratedShapesFileSystemAdapter } from "../infrastructure/generated-shapes.file-system.adapter";

// Any adapter satisfying generated-shapes.port.js works here (e.g. generated-shapes.api.adapter.js once the
// backend exposes /generated-shapes). Shapes are generated and stored on-device, so the file system is the source of truth.
const createGeneratedShapesPort = createGeneratedShapesFileSystemAdapter;

const SIGNED_OUT_MESSAGE = "Sign in to manage your 3D assets.";

/**
 * Owns the signed-in user's live list of generated shapes and exposes CRUD operations backed by generated-shapes.port.js.
 * Shapes are private to their creator: signing in as someone else swaps to that user's shapes, signing out clears them.
 * `error` reflects the last failed load only. Mutations reject so their caller can report the failure in context.
 * @returns {{ generatedShapes: object[], isLoading: boolean, error: Error|null, create: function(object): Promise<object>, update: function(number|string, object): Promise<object>, remove: function(number|string): Promise<void>, refresh: function({showLoading?: boolean}=): Promise<void> }} Generated shapes state and actions.
 */
export const useGeneratedShapes = () => {
  const { user } = useAuth();
  const ownerId = user?.id ?? null;

  // One port per signed-in user, which can only reach that user's shapes. Signed out, there is none.
  const port = useMemo(
    () => (ownerId ? createGeneratedShapesPort(ownerId) : null),
    [ownerId],
  );

  const [generatedShapes, setGeneratedShapes] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // The current user's port. A call made with a previous user's port (the user changed while it was in flight)
  // has its result dropped, so one user's shapes never appear in another user's list.
  const activePort = useRef(port);

  // Bumped by every completed mutation. A refresh that started before a mutation finished read storage
  // too early, so its result is dropped instead of resurrecting a deleted shape or hiding a new one.
  const mutationCount = useRef(0);

  const refresh = useCallback(async ({ showLoading = true } = {}) => {
    const callPort = activePort.current;
    if (!callPort) {
      setGeneratedShapes([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const mutationCountAtStart = mutationCount.current;
    if (showLoading) setIsLoading(true);
    try {
      const result = await callPort.listGeneratedShapes();
      if (activePort.current !== callPort) return;
      if (mutationCount.current === mutationCountAtStart) {
        setGeneratedShapes(result);
      }
      setError(null);
    } catch (err) {
      if (activePort.current === callPort) setError(err);
    } finally {
      if (showLoading && activePort.current === callPort) setIsLoading(false);
    }
  }, []);

  // Signing in, out, or as someone else: drop the previous user's shapes at once, then load the new user's.
  useEffect(() => {
    activePort.current = port;
    setGeneratedShapes([]);
    setError(null);
    refresh();
  }, [port, refresh]);

  const create = useCallback(async (fields) => {
    const callPort = activePort.current;
    if (!callPort) throw new Error(SIGNED_OUT_MESSAGE);
    const created = await callPort.createGeneratedShape(fields);
    if (activePort.current === callPort) {
      mutationCount.current += 1;
      setGeneratedShapes((prev) => [
        created,
        ...prev.filter((generatedShape) => generatedShape.id !== created.id),
      ]);
    }
    return created;
  }, []);

  const update = useCallback(async (id, fields) => {
    const callPort = activePort.current;
    if (!callPort) throw new Error(SIGNED_OUT_MESSAGE);
    const updated = await callPort.updateGeneratedShape(id, fields);
    if (activePort.current === callPort) {
      mutationCount.current += 1;
      setGeneratedShapes((prev) =>
        prev.map((generatedShape) =>
          generatedShape.id === updated.id ? updated : generatedShape,
        ),
      );
    }
    return updated;
  }, []);

  const remove = useCallback(async (id) => {
    const callPort = activePort.current;
    if (!callPort) throw new Error(SIGNED_OUT_MESSAGE);
    await callPort.deleteGeneratedShape(id);
    if (activePort.current === callPort) {
      mutationCount.current += 1;
      setGeneratedShapes((prev) =>
        prev.filter((generatedShape) => generatedShape.id !== id),
      );
    }
  }, []);

  return { generatedShapes, isLoading, error, create, update, remove, refresh };
};
