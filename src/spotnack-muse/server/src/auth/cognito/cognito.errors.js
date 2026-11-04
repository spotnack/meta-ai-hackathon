/*
Maps Amazon Cognito errors to safe, user-facing messages. Raw SDK errors are
only logged on the server.
*/

/** Auth failure with an HTTP status, a stable code and a safe message. */
export class AuthError extends Error {
  /**
   * @param {number} status - HTTP status code.
   * @param {string} code - Stable error code for the client.
   * @param {string} message - Safe, user-facing message.
   */
  constructor(status, code, message) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

// Same message for "wrong password" and "no such user", so the API does not
// reveal which emails have an account:
const INVALID_CREDENTIALS = [
  401,
  "INVALID_CREDENTIALS",
  "Incorrect email or password.",
];
const TOO_MANY_ATTEMPTS = [
  429,
  "TOO_MANY_ATTEMPTS",
  "Too many attempts. Please wait a moment and try again.",
];

const COGNITO_ERRORS = {
  UsernameExistsException: [
    409,
    "EMAIL_TAKEN",
    "An account with this email already exists.",
  ],
  InvalidPasswordException: [
    400,
    "INVALID_PASSWORD",
    "The password does not meet the requirements.",
  ],
  CodeMismatchException: [
    400,
    "INVALID_CODE",
    "The verification code is incorrect.",
  ],
  ExpiredCodeException: [
    400,
    "EXPIRED_CODE",
    "The verification code has expired. Request a new one.",
  ],
  NotAuthorizedException: INVALID_CREDENTIALS,
  UserNotFoundException: INVALID_CREDENTIALS,
  UserNotConfirmedException: [
    403,
    "USER_NOT_CONFIRMED",
    "Please verify your email to finish creating your account.",
  ],
  PasswordResetRequiredException: [
    403,
    "PASSWORD_RESET_REQUIRED",
    "You need to reset your password before signing in.",
  ],
  LimitExceededException: TOO_MANY_ATTEMPTS,
  TooManyRequestsException: TOO_MANY_ATTEMPTS,
  TooManyFailedAttemptsException: TOO_MANY_ATTEMPTS,
  CodeDeliveryFailureException: [
    502,
    "CODE_DELIVERY_FAILED",
    "The verification email could not be sent. Please try again later.",
  ],
  InvalidParameterException: [
    400,
    "INVALID_REQUEST",
    "The request is not valid.",
  ],
};

// Cognito answers some app client misconfigurations with errors that would
// otherwise look like user mistakes (e.g. "Incorrect email or password"):
const MISCONFIGURATIONS = [
  {
    matches: (error) =>
      error?.name === "NotAuthorizedException" &&
      /SECRET_HASH/.test(error?.message),
    hint: "the Cognito app client has a client secret. Create a public app client (type: Mobile app, no secret) and set COGNITO_CLIENT_ID.",
  },
  {
    matches: (error) =>
      error?.name === "InvalidParameterException" &&
      /USER_PASSWORD_AUTH flow not enabled/.test(error?.message),
    hint: "enable ALLOW_USER_PASSWORD_AUTH on the Cognito app client.",
  },
];

export const misconfiguredError = (hint) => {
  console.error(`[auth] Configuration problem: ${hint}`);
  return new AuthError(
    503,
    "AUTH_MISCONFIGURED",
    "Sign-in is temporarily unavailable. Please try again later.",
  );
};

export const toAuthError = (error) => {
  if (error instanceof AuthError) {
    return error;
  }

  const misconfiguration = MISCONFIGURATIONS.find((item) =>
    item.matches(error),
  );
  if (misconfiguration) {
    return misconfiguredError(misconfiguration.hint);
  }

  const mapped = COGNITO_ERRORS[error?.name];
  if (mapped) {
    return new AuthError(...mapped);
  }

  console.error(
    "[auth] Unexpected Cognito error:",
    error?.name,
    error?.message,
  );
  return new AuthError(
    500,
    "AUTH_ERROR",
    "Something went wrong. Please try again.",
  );
};
