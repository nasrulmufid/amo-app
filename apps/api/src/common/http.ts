import type { FastifyRequest } from 'fastify'

/** Bungkus data ke format sukses PRD §9.2. `request.id` = requestId (lihat app.ts → genReqId). */
export function ok<T>(request: FastifyRequest, data: T) {
  return { data, meta: { requestId: request.id } }
}

/** Format error PRD §9.3. */
export function errorBody(code: string, message: string, requestId: string, details?: unknown) {
  return { error: { code, message, requestId, ...(details === undefined ? {} : { details }) } }
}

/** Metadata klien untuk audit log & sesi. Panjang dipotong sesuai kolom DB. */
export function requestMeta(request: FastifyRequest) {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
    requestId: request.id,
  }
}
