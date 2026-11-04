/*
Payments API. Mounted at /api/payments (see routes/index.js).  
*/

import express from "express";

const router = express.Router();

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

export default router;
