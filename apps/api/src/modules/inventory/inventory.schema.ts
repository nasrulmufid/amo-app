import { Type, type Static } from '@sinclair/typebox'
import {
  DEVICE_DISPLAY_STATUSES,
  ONLINE_STATUSES,
  REMOTE_SCHEMES,
  type DeviceDisplayStatus,
  type OnlineStatus,
  type RemoteScheme,
} from '@amo/shared'
import { PaginationQuery } from '../../common/schemas'

/**
 * Schema TypeBox untuk modul inventaris (PRD §3.3, §3.4, §9.1).
 *
 * Aturan penting:
 *  - `additionalProperties: false` pada body → field asing ditolak, bukan diabaikan.
 *  - Field yang berasal dari GenieACS (serial/manufacturer/model/oui/productClass)
 *    TIDAK dapat diubah lewat PATCH bila perangkat sudah tertaut — sync yang memilikinya.
 *  - Koordinat divalidasi rentangnya; `null` berarti "belum ada" (jangan dikarang).
 */

const NullableString = (maxLength: number) =>
  Type.Union([Type.String({ maxLength }), Type.Null()])

const NullableCoordinate = (min: number, max: number) =>
  Type.Union([Type.Number({ minimum: min, maximum: max }), Type.Null()])

/** IPv4/IPv6 teks (maks 45 karakter). Validasi semantik dilakukan di service. */
const ManagementIp = Type.Union([Type.String({ maxLength: 45 }), Type.Null()])

export const InventoryUuidParams = Type.Object({
  uuid: Type.String({ minLength: 36, maxLength: 36, pattern: '^[0-9a-fA-F-]{36}$' }),
})
export type InventoryUuidParams = Static<typeof InventoryUuidParams>

export const InventoryListQuery = Type.Intersect([
  PaginationQuery,
  Type.Object({
    q: Type.Optional(Type.String({ maxLength: 190 })),
    status: Type.Optional(
      Type.Unsafe<OnlineStatus | 'all'>(Type.String({ enum: [...ONLINE_STATUSES, 'all'] })),
    ),
    manufacturer: Type.Optional(Type.String({ maxLength: 128 })),
    model: Type.Optional(Type.String({ maxLength: 128 })),
    linked: Type.Optional(Type.Unsafe<'all' | 'linked' | 'unlinked'>(Type.String({ enum: ['all', 'linked', 'unlinked'] }))),
    sort: Type.Optional(
      Type.Unsafe<'name' | 'createdAt' | 'lastSyncedAt' | 'status'>(
        Type.String({ enum: ['name', 'createdAt', 'lastSyncedAt', 'status'] }),
      ),
    ),
    order: Type.Optional(Type.Unsafe<'asc' | 'desc'>(Type.String({ enum: ['asc', 'desc'] }))),
  }),
])
export type InventoryListQuery = Static<typeof InventoryListQuery>

export const InventoryCreateBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    serialNumber: Type.Optional(NullableString(128)),
    manufacturer: Type.Optional(NullableString(128)),
    model: Type.Optional(NullableString(128)),
    managementIp: Type.Optional(ManagementIp),
    remoteScheme: Type.Optional(Type.Unsafe<RemoteScheme>(Type.String({ enum: [...REMOTE_SCHEMES] }))),
    remotePort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    locationName: Type.Optional(NullableString(190)),
    address: Type.Optional(NullableString(2000)),
    latitude: Type.Optional(NullableCoordinate(-90, 90)),
    longitude: Type.Optional(NullableCoordinate(-180, 180)),
    notes: Type.Optional(NullableString(4000)),
    genieacsDeviceId: Type.Optional(NullableString(190)),
  },
  { additionalProperties: false },
)
export type InventoryCreateBody = Static<typeof InventoryCreateBody>

export const InventoryUpdateBody = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    serialNumber: Type.Optional(NullableString(128)),
    manufacturer: Type.Optional(NullableString(128)),
    model: Type.Optional(NullableString(128)),
    managementIp: Type.Optional(ManagementIp),
    remoteScheme: Type.Optional(Type.Unsafe<RemoteScheme>(Type.String({ enum: [...REMOTE_SCHEMES] }))),
    remotePort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    locationName: Type.Optional(NullableString(190)),
    address: Type.Optional(NullableString(2000)),
    latitude: Type.Optional(NullableCoordinate(-90, 90)),
    longitude: Type.Optional(NullableCoordinate(-180, 180)),
    notes: Type.Optional(NullableString(4000)),
    isActive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)
export type InventoryUpdateBody = Static<typeof InventoryUpdateBody>

// ── Response ────────────────────────────────────────────────────────────────

const DisplayStatus = Type.Unsafe<DeviceDisplayStatus>(
  Type.String({ enum: [...DEVICE_DISPLAY_STATUSES] }),
)
const OnlineStatusSchema = Type.Unsafe<OnlineStatus>(Type.String({ enum: [...ONLINE_STATUSES] }))
const IsoDate = Type.String({ format: 'date-time' })
const NullableIsoDate = Type.Union([IsoDate, Type.Null()])

export const InventoryItemSchema = Type.Object({
  uuid: Type.String(),
  name: Type.String(),
  serialNumber: Type.Union([Type.String(), Type.Null()]),
  manufacturer: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  managementIp: Type.Union([Type.String(), Type.Null()]),
  locationName: Type.Union([Type.String(), Type.Null()]),
  onlineStatus: OnlineStatusSchema,
  displayStatus: DisplayStatus,
  lastInformAt: NullableIsoDate,
  lastSyncedAt: NullableIsoDate,
  isActive: Type.Boolean(),
  linked: Type.Boolean(),
})

export const InventoryDetailSchema = Type.Object({
  ...InventoryItemSchema.properties,
  oui: Type.Union([Type.String(), Type.Null()]),
  productClass: Type.Union([Type.String(), Type.Null()]),
  remoteScheme: Type.Unsafe<RemoteScheme>(Type.String({ enum: [...REMOTE_SCHEMES] })),
  remotePort: Type.Integer(),
  address: Type.Union([Type.String(), Type.Null()]),
  latitude: Type.Union([Type.Number(), Type.Null()]),
  longitude: Type.Union([Type.Number(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  device: Type.Union([
    Type.Object({
      genieacsDeviceId: Type.String(),
      lastInformAt: NullableIsoDate,
      lastSyncedAt: NullableIsoDate,
      onlineStatus: OnlineStatusSchema,
      syncError: Type.Union([Type.String(), Type.Null()]),
      parameters: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
    }),
    Type.Null(),
  ]),
})

export const InventoryMapPointSchema = Type.Object({
  uuid: Type.String(),
  name: Type.String(),
  serialNumber: Type.Union([Type.String(), Type.Null()]),
  manufacturer: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  latitude: Type.Number(),
  longitude: Type.Number(),
  locationName: Type.Union([Type.String(), Type.Null()]),
  onlineStatus: OnlineStatusSchema,
  displayStatus: DisplayStatus,
})

export const InventoryMapResponse = Type.Object({
  items: Type.Array(InventoryMapPointSchema),
  /** Jumlah perangkat aktif yang TIDAK punya koordinat valid (PRD §3.4). */
  withoutCoordinates: Type.Integer(),
})

export const InventoryListResponse = Type.Object({
  items: Type.Array(InventoryItemSchema),
  pagination: Type.Object({
    page: Type.Integer(),
    pageSize: Type.Integer(),
    total: Type.Integer(),
    totalPages: Type.Integer(),
  }),
})
