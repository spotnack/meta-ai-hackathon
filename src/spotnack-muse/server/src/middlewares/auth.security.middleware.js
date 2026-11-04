/*
Request guards for the auth API.
*/

// State-changing requests must send JSON.
// In a mobile application, Tokens travel in the request body
// and in the Authorization header, never in cookies,
// so there is no CSRF risk to guard against with an Origin check.
export const requireJson = (req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") {
    return next();
  }

  if (!req.is("application/json")) {
    return res
      .status(415)
      .json({ code: "UNSUPPORTED_MEDIA_TYPE", message: "Send JSON." });
  }
  return next();
};

// Validates and normalizes `req.body` with a Joi schema; unknown fields are
// dropped. Responds 400 with a message per invalid field.
export const validateBody = (schema) => (req, res, next) => {
  const { value, error } = schema.validate(req.body ?? {}, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (error) {
    const fields = {};
    error.details.forEach((detail) => {
      const field = detail.path.join(".") || "body";
      fields[field] ??= detail.message;
    });
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Please check the highlighted fields.",
      fields,
    });
  }

  req.body = value;
  return next();
};
