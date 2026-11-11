import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { ParamMapField } from '@amo/shared'

/** REPOSITORY pengaturan aplikasi (tabel `app_settings` & `device_parameter_map`). */

export interface ParameterMapRow {
  id: number
  fieldKey: ParamMapField
  manufacturer: string | null
  model: string | null
  paramPath: string
  priority: number
  isActive: boolean
}

interface MapDbRow extends RowDataPacket {
  id: number
  field_key: ParamMapField
  manufacturer: string | null
  model: string | null
  param_path: string
  priority: number
  is_active: number
}

const toMap = (r: MapDbRow): ParameterMapRow => ({
  id: r.id,
  fieldKey: r.field_key,
  manufacturer: r.manufacturer,
  model: r.model,
  paramPath: r.param_path,
  priority: Number(r.priority),
  isActive: r.is_active === 1,
})

export class SettingsRepository {
  constructor(private readonly db: Pool) {}

  async getValues(): Promise<Record<string, unknown>> {
    const [rows] = await this.db.query<RowDataPacket[]>('SELECT `key`, value_json FROM app_settings')
    const values: Record<string, unknown> = {}
    for (const r of rows) {
      // mysql2 mengembalikan kolom JSON sebagai string atau objek tergantung driver/versi.
      const raw = r.value_json
      values[String(r.key)] = typeof raw === 'string' ? safeParse(raw) : raw
    }
    return values
  }

  async setValue(key: string, value: unknown, userId: number | null): Promise<void> {
    await this.db.query(
      `INSERT INTO app_settings (\`key\`, value_json, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by)`,
      [key, JSON.stringify(value), userId],
    )
  }

  async listParameterMap(): Promise<ParameterMapRow[]> {
    const [rows] = await this.db.query<MapDbRow[]>(
      'SELECT id, field_key, manufacturer, model, param_path, priority, is_active FROM device_parameter_map ORDER BY field_key, priority, id',
    )
    return rows.map(toMap)
  }

  async insertParameterMap(input: {
    fieldKey: ParamMapField
    manufacturer: string | null
    model: string | null
    paramPath: string
    priority: number
    isActive: boolean
  }): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      `INSERT INTO device_parameter_map (field_key, manufacturer, model, param_path, priority, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.fieldKey, input.manufacturer, input.model, input.paramPath, input.priority, input.isActive ? 1 : 0],
    )
    return res.insertId
  }

  async updateParameterMap(
    id: number,
    patch: Partial<{
      fieldKey: ParamMapField
      manufacturer: string | null
      model: string | null
      paramPath: string
      priority: number
      isActive: boolean
    }>,
  ): Promise<void> {
    const columns: Record<string, string> = {
      fieldKey: 'field_key',
      manufacturer: 'manufacturer',
      model: 'model',
      paramPath: 'param_path',
      priority: 'priority',
      isActive: 'is_active',
    }
    const sets: string[] = []
    const params: unknown[] = []
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue
      const value = (patch as Record<string, unknown>)[key]
      sets.push(`${column} = ?`)
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
    }
    if (sets.length === 0) return
    params.push(id)
    await this.db.query(`UPDATE device_parameter_map SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  async deleteParameterMap(id: number): Promise<boolean> {
    const [res] = await this.db.query<ResultSetHeader>('DELETE FROM device_parameter_map WHERE id = ?', [id])
    return res.affectedRows > 0
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
