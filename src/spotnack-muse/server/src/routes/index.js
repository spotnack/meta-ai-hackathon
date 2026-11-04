/*
API router aggregator. Mounted at /api in app.js.
*/

import express from "express";

// Health API:
import healthRoutes from "./health.routes.js";

// Authentication API (Amazon Cognito):
import { createAuthRouter } from "./auth.routes.js";

// Payments (Stripe):
import paymentsRoutes from "./payments.routes.js";

// AI model:
import modelsRoutes from "./models.routes.js";

// Router instance:
const router = express.Router();

router.use("/health", healthRoutes);
router.use("/auth", createAuthRouter());
router.use("/payments", paymentsRoutes);
router.use("/models", modelsRoutes);

// Unknown API routes get a JSON 404 (not the React app):
router.use((req, res) => {
  res.status(404).json({ message: "Not found." });
});

export default router;
