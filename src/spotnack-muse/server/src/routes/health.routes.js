/*
Health-check route. Mounted at /api/health (see routes/index.js).

This file only maps the HTTP method and path to the handler in
middlewares/health.middleware.js.
*/

import express from "express";

import { healthCheck } from "../middlewares/health.middleware.js";

const router = express.Router();

router.get("/", healthCheck);

export default router;
