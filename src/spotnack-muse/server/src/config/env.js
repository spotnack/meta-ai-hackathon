// dotenv is loaded here, from an EXPLICIT path resolved relative to this file,
// so `node server.js` picks up server/.env regardless of the directory it was
// launched from. Relying on `import "dotenv/config"` alone reads .env from
// process.cwd(), which silently loads nothing when started from the repo root.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Persistent store for the generated shapes CRUD API. Defaults to a server-owned
// JSON file (see db/data/generated_shapes.json) so changes made through the API
// survive restarts. This intentionally does NOT live under client/ because a React
// Native app cannot read an arbitrary file off the dev machine's disk at
// runtime, so the client only ever reaches this data over HTTP. Override
// with GENERATED_SHAPES_DATA_FILE to point at a different location (e.g. a
// writable data directory in production).
export const GENERATED_SHAPES_DATA_FILE =
  process.env.GENERATED_SHAPES_DATA_FILE ||
  path.resolve(__dirname, "../db/data/generated_shapes.json");
