import { Type, type Static } from '@sinclair/typebox'
import { ROLES, type Role } from '@amo/shared'
import { PaginationQuery } from '../../common/schemas'

/** Schema manajemen pengguna (PRD §2, §9.1). Respons TIDAK PERNAH memuat password_hash. */

const RoleSchema = Type.Unsafe<Role>(Type.String({ enum: [...ROLES] }))

/** Panjang minimum password: 8 di dev, 12 di produksi (ditegakkan di service). */
const Password = Type.String({ minLength: 8, maxLength: 200 })

export const UserIdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) })
export type UserIdParams = Static<typeof UserIdParams>

export const UserListQuery = Type.Intersect([
  PaginationQuery,
  Type.Object({
    q: Type.Optional(Type.String({ maxLength: 190 })),
    role: Type.Optional(RoleSchema),
    active: Type.Optional(Type.Boolean()),
  }),
])
export type UserListQuery = Static<typeof UserListQuery>

export const UserCreateBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({ format: 'email', maxLength: 190 }),
    password: Password,
    role: RoleSchema,
  },
  { additionalProperties: false },
)
export type UserCreateBody = Static<typeof UserCreateBody>

export const UserUpdateBody = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    email: Type.Optional(Type.String({ format: 'email', maxLength: 190 })),
    password: Type.Optional(Password),
    role: Type.Optional(RoleSchema),
    isActive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)
export type UserUpdateBody = Static<typeof UserUpdateBody>

export const UserItemSchema = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  email: Type.String(),
  role: RoleSchema,
  isActive: Type.Boolean(),
  lastLoginAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
})

export const UserListResponse = Type.Object({
  items: Type.Array(UserItemSchema),
  pagination: Type.Object({
    page: Type.Integer(),
    pageSize: Type.Integer(),
    total: Type.Integer(),
    totalPages: Type.Integer(),
  }),
})
