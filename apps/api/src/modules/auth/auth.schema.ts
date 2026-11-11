import { Type, type Static } from '@sinclair/typebox'
import { ROLES, type Role } from '@amo/shared'

/** Schema = kontrak runtime (validasi + filter respons + dokumen OpenAPI). */

export const LoginBody = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 190 }),
    // Panjang maksimum mencegah serangan DoS lewat hashing password sangat panjang.
    password: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
)
export type LoginBody = Static<typeof LoginBody>

/** Hanya field ini yang boleh keluar ke client (password_hash otomatis terbuang). */
export const UserSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  email: Type.String(),
  role: Type.Unsafe<Role>(Type.String({ enum: [...ROLES] })),
  lastLoginAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
})

export const SessionResponse = Type.Object({
  user: UserSchema,
  csrfToken: Type.String(),
  expiresAt: Type.String({ format: 'date-time' }),
})

export const LogoutResponse = Type.Object({ loggedOut: Type.Boolean() })
