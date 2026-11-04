/*
Application-layer responsible for creating a context for the generated shapes.
Thin Context wrapper around use-generated-shapes.hook.js.
*/

// React Dependencies:
import React, { createContext, useContext } from "react";

// Custom Dependencies:
import { useGeneratedShapes } from "./use-generated-shapes.hook";

// Creating a global context for the generated 3D shapes:
export const GeneratedShapesContext = createContext(null);

/**
 * Provides the shared live list of generated shapes to the component tree.
 * @param {object} root0 - Provider props.
 * @param {React.ReactNode} root0.children - Child components.
 * @returns {React.JSX.Element} Generated shapes context provider.
 */
export const GeneratedShapesContextProvider = ({ children }) => {
  const generatedShapesViewModel = useGeneratedShapes();

  return (
    <GeneratedShapesContext.Provider value={generatedShapesViewModel}>
      {children}
    </GeneratedShapesContext.Provider>
  );
};

export const useGeneratedShapesContext = () => {
  const context = useContext(GeneratedShapesContext);
  if (!context) {
    throw new Error(
      "useGeneratedShapesContext must be used within a GeneratedShapesContextProvider",
    );
  }
  return context;
};
