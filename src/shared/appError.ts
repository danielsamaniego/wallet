/**
 * ErrorKind classifies application errors by semantic category.
 * HTTP adapters map Kind to status codes; domain and app remain transport-agnostic.
 * HTTP adapters map Kind to status codes; domain and app remain transport-agnostic.
 */
export enum ErrorKind {
  Validation = "VALIDATION",
  Unauthorized = "UNAUTHORIZED",
  Forbidden = "FORBIDDEN",
  NotFound = "NOT_FOUND",
  Conflict = "CONFLICT",
  DomainRule = "DOMAIN_RULE",
  Internal = "INTERNAL",
}

/**
 * AppError is the standard application error used across domain, app, and adapter layers.
 * No external dependencies.
 *
 * - kind:    semantic category (Validation, Unauthorized, NotFound, Conflict, etc.)
 * - code:    stable UPPER_SNAKE_CASE code for API consumers (e.g. "INSUFFICIENT_FUNDS")
 * - message: human-readable fallback
 * - cause:   wrapped original error (not exposed to API consumers)
 */
export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly msg: string;
  readonly cause?: Error;

  private constructor(kind: ErrorKind, code: string, message: string, cause?: Error) {
    super(cause ? `${message}: ${cause.message}` : message);
    this.name = "AppError";
    this.kind = kind;
    this.code = code;
    this.msg = message;
    this.cause = cause;
  }

  static create(kind: ErrorKind, code: string, message: string): AppError {
    return new AppError(kind, code, message);
  }

  static wrap(kind: ErrorKind, code: string, message: string, cause: Error): AppError {
    return new AppError(kind, code, message, cause);
  }

  static validation(code: string, message: string): AppError {
    return new AppError(ErrorKind.Validation, code, message);
  }

  static unauthorized(code: string, message: string): AppError {
    return new AppError(ErrorKind.Unauthorized, code, message);
  }

  static forbidden(code: string, message: string): AppError {
    return new AppError(ErrorKind.Forbidden, code, message);
  }

  static notFound(code: string, message: string): AppError {
    return new AppError(ErrorKind.NotFound, code, message);
  }

  static conflict(code: string, message: string): AppError {
    return new AppError(ErrorKind.Conflict, code, message);
  }

  static domainRule(code: string, message: string): AppError {
    return new AppError(ErrorKind.DomainRule, code, message);
  }

  static internal(code: string, message: string, cause?: Error): AppError {
    return cause
      ? new AppError(ErrorKind.Internal, code, message, cause)
      : new AppError(ErrorKind.Internal, code, message);
  }

  /**
   * Type guard: checks if an unknown error is an AppError.
   */
  static is(err: unknown): err is AppError {
    return err instanceof AppError;
  }
}
