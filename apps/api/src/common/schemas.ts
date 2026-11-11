import { Type, type Static, type TSchema } from '@sinclair/typebox'

/**
 * Schema TypeBox yang dipakai ulang oleh banyak modul.
 *
 * Mengapa schema di setiap route? (skill fastify-rest-api, "schema-first")
 *  - request divalidasi SEBELUM handler berjalan;
 *  - response difilter → field yang tak ada di schema (mis. password_hash)
 *    otomatis dibuang = lapisan pengaman terhadap kebocoran data;
 *  - dokumen OpenAPI dihasilkan otomatis dari schema yang sama.
 */

/** Bagian `meta` pada setiap respons sukses (PRD §9.2). */
export const Meta = Type.Object({ requestId: Type.String() })

/** Pembungkus `{ data, meta }` untuk respons sukses. */
export const Envelope = <T extends TSchema>(data: T) => Type.Object({ data, meta: Meta })

/** Bentuk error PRD §9.3 — dipakai pada response schema 4xx/5xx. */
export const ErrorEnvelope = Type.Object(
  {
    error: Type.Object({
      code: Type.String(),
      message: Type.String(),
      requestId: Type.String(),
      details: Type.Optional(Type.Unknown()),
    }),
  },
  { description: 'Error response' },
)

/** Query pagination standar (PRD §3.3: pagination di sisi server). */
export const PaginationQuery = Type.Object({
  page: Type.Integer({ minimum: 1, default: 1 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 100, default: 25 }),
})
export type PaginationQuery = Static<typeof PaginationQuery>

export const PaginationSchema = Type.Object({
  page: Type.Integer(),
  pageSize: Type.Integer(),
  total: Type.Integer(),
  totalPages: Type.Integer(),
})

/** Kumpulan response error umum agar tidak mengulang di tiap route. */
export const CommonErrors = {
  400: ErrorEnvelope,
  401: ErrorEnvelope,
  403: ErrorEnvelope,
  404: ErrorEnvelope,
  429: ErrorEnvelope,
} as const

/** Untuk route yang BELUM dikerjakan (stub sprint berikutnya). */
export const NotImplementedResponse = { 501: ErrorEnvelope } as const
