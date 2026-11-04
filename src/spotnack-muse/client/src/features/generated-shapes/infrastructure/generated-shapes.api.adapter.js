import { getApiBaseUrl } from "@config/api";

/*
Infrastructure adapter implementing generated-shapes.port.js against the real Express backend over HTTP. 
This is the only file in the generated-shapes feature that knows `fetch` or the API's URL shape exist. 
Everything above it (use-generated-shapes.hook.js) only knows the port's method names.
*/

const request = async (path, options = {}) => {
  const response = await fetch(`${getApiBaseUrl()}/generated-shapes${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      body?.message || `Request failed with status ${response.status}`,
    );
  }

  return body;
};

/** @type {import("../domain/generated-shapes.port").GeneratedShapesPort} */
export const generatedShapesApiAdapter = {
  listGeneratedShapes: () => request(""),
  getGeneratedShape: (id) => request(`/${id}`),
  createGeneratedShape: (fields) =>
    request("", { method: "POST", body: JSON.stringify(fields) }),
  updateGeneratedShape: (id, fields) =>
    request(`/${id}`, { method: "PUT", body: JSON.stringify(fields) }),
  deleteGeneratedShape: (id) => request(`/${id}`, { method: "DELETE" }),
};
