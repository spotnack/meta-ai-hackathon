import express from "express";
import compression from "compression";
import helmet from "helmet";
import morgan from "morgan";

import apiRoutes from "./src/routes/index.js";
import { isAuthConfigured } from "./src/config/auth.config.js";
import { preloadJwks } from "./src/auth/cognito/jwks.js";

// Build the server:
const app = express();

// Built-in middlewares:
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json()); // Parse the body of the request into a json object.
app.use(express.urlencoded({ extended: true })); // Parse requests with URL encoded payload/format (e.g., key-value pairs).

// Secure the app by setting various HTTP headers:
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: [
          "'self'",
          "https://js.stripe.com",
          "https://pay.google.com",
        ],
        frameSrc: [
          "'self'",
          "https://js.stripe.com",
          "https://hooks.stripe.com",
          "https://pay.google.com",
        ],
        connectSrc: [
          "'self'",
          "https://api.stripe.com",
          "https://pay.google.com",
          "https://google.com",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "https://*.stripe.com",
          "https://*.gstatic.com",
          // Google account profile pictures (Google sign-in):
          "https://*.googleusercontent.com",
        ],
      },
    },
  }),
);
app.use(compression()); // Compress HTTP responses (gzip/brotli) to reduce payload size and improve performance.

// Dev/Prod mode:
const env = app.get("env");
if (env === "development") {
  console.log("Running in development mode...");
  app.use(morgan("dev")); // Log HTTP requests to the console or external log file.
} else if (env === "production") {
  console.log("Running in production mode...");
  app.use(morgan("combined"));
} else {
  console.log(`Running in ${env} mode...`);
}

// API (auth, payments, models from src/routes/index.js):
app.use("/api", apiRoutes);

if (isAuthConfigured) {
  preloadJwks();
}

// Centralized error handler. The four-argument signature is required for
// Express to treat this as an error-handling middleware, so errors passed via
// next(err) from any route land here and return a consistent JSON payload.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Only trust 4xx/5xx statuses (e.g. 400 from express.json for malformed JSON):
  const status = err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);

  return res.status(status).json({
    message:
      env === "production" && status >= 500
        ? "Internal Server Error"
        : err.message,
    status,
  });
});

export default app;
