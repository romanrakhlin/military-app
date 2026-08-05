// App error shape matches the spec: { "error": { code, message, field? } }

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly field?: string;

  constructor(statusCode: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.field = field;
  }

  static badRequest(message: string, field?: string) {
    return new ApiError(400, "bad_request", message, field);
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "unauthorized", message);
  }
  static forbidden(message = "Forbidden") {
    return new ApiError(403, "forbidden", message);
  }
  static notFound(message = "Not found") {
    return new ApiError(404, "not_found", message);
  }
  static conflict(message: string, field?: string) {
    return new ApiError(409, "conflict", message, field);
  }
  static tooMany(message = "Too many requests") {
    return new ApiError(429, "rate_limited", message);
  }
}
