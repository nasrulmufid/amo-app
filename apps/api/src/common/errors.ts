import type { ErrorCode } from '@amo/shared'

/**
 * Hierarki error aplikasi.
 *
 * Lempar `AppError` dari service/handler mana pun; error handler global
 * (plugins/error-handler.ts) yang mengubahnya menjadi respons PRD §9.3:
 *   { "error": { "code", "message", "requestId" } }
 *
 * `message` ditampilkan ke client → JANGAN isi dengan detail internal
 * (query SQL, path file, stack trace, dsb).
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/** Factory ringkas agar pemanggil tidak perlu menghafal status code. */
export const Errors = {
  authRequired: () => new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'),
  // Pesan sengaja SAMA untuk "email tidak ada", "password salah", dan "akun nonaktif"
  // supaya penyerang tidak bisa menebak email yang terdaftar (PRD §13.1).
  invalidCredentials: () =>
    new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'),
  forbidden: (message = 'You do not have permission to perform this action.') =>
    new AppError(403, 'FORBIDDEN', message),
  csrfInvalid: () => new AppError(403, 'CSRF_INVALID', 'Invalid or missing CSRF token.'),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  /** Aturan bisnis yang dilanggar (mis. koordinat tidak sepasang, port tidak diizinkan). */
  validation: (message: string, details?: unknown) =>
    new AppError(400, 'VALIDATION_ERROR', message, details),
  rateLimited: () =>
    new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'),
  notImplemented: (feature: string) =>
    new AppError(501, 'NOT_IMPLEMENTED', `${feature} is not implemented yet.`),
  upstream: (message = 'Upstream service is unavailable.') =>
    new AppError(502, 'UPSTREAM_ERROR', message),
  /** Target remote ditolak kebijakan (SSRF/allowlist/port). */
  remoteTargetNotAllowed: (message = 'Remote target is not allowed by policy.') =>
    new AppError(403, 'REMOTE_TARGET_NOT_ALLOWED', message),
  /** Perangkat tidak dapat dihubungi (timeout/koneksi ditolak). */
  remoteUnavailable: (message = 'Remote device is unreachable.') =>
    new AppError(502, 'REMOTE_UNAVAILABLE', message),
}
