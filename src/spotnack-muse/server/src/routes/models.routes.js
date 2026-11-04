/*
AI models API. Mounted at /api/models (see routes/index.js).  
*/

import express from "express";

const router = express.Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

export default router;
