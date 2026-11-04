/*
Health-check handler.

Wired up in routes/health.routes.js:

  GET /api/health -> healthCheck

A lightweight liveness probe for uptime monitors, load balancers, and
deployment health checks. Returns a small JSON body and never touches
persistent storage, so it stays fast and dependency-free.
*/

// GET /api/health - report that the service is up.
export const healthCheck = (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
  });
};
