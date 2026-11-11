import { Type, type Static } from '@sinclair/typebox'
import { PARAM_MAP_FIELDS, SETTING_KEYS, type ParamMapField } from '@amo/shared'

/** Schema pengaturan aplikasi & pemetaan parameter GenieACS (PRD §7.6, §8.3). */

const SettingKeySchema = Type.Unsafe<string>(Type.String({ enum: [...SETTING_KEYS] }))
const ParamFieldSchema = Type.Unsafe<ParamMapField>(Type.String({ enum: [...PARAM_MAP_FIELDS] }))

export const SettingsUpdateBody = Type.Object(
  {
    values: Type.Record(SettingKeySchema, Type.Unknown()),
  },
  { additionalProperties: false },
)
export type SettingsUpdateBody = Static<typeof SettingsUpdateBody>

export const ParameterMapIdParams = Type.Object({ id: Type.Integer({ minimum: 1 }) })

export const ParameterMapCreateBody = Type.Object(
  {
    fieldKey: ParamFieldSchema,
    manufacturer: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
    model: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
    paramPath: Type.String({ minLength: 1, maxLength: 512 }),
    priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
    isActive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)
export type ParameterMapCreateBody = Static<typeof ParameterMapCreateBody>

export const ParameterMapUpdateBody = Type.Partial(ParameterMapCreateBody)

export const ParameterMapSchema = Type.Object({
  id: Type.Integer(),
  fieldKey: ParamFieldSchema,
  manufacturer: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  paramPath: Type.String(),
  priority: Type.Integer(),
  isActive: Type.Boolean(),
})
