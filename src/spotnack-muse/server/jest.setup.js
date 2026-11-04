/*
Runs before any test module is loaded (wired via jest.config.cjs). 
Redirects the images JSON store at a per-process temp
file so tests never read or mutate the real seed data in
src/db/data/generated_shapes.json.
*/
import os from "os";
import path from "path";

process.env.GENERATED_SHAPES_DATA_FILE = path.join(
  os.tmpdir(),
  `generated_shapes.test.${process.pid}.json`,
);
