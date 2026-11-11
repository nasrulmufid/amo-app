import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { RemoteScheme } from '@amo/shared'

/** REPOSITORY remote: target perangkat + log akses remote (PRD §10.3). */

export interface RemoteTargetRow {
  id: number
  uuid: string
  name: string
  managementIp: string | null
  remoteScheme: RemoteScheme
  remotePort: number
  isActive: boolean
}

interface Row extends RowDataPacket {
  id: number
  uuid: string
  name: string
  management_ip: string | null
  remote_scheme: RemoteScheme
  remote_port: number
  is_active: number
}

export class RemoteRepository {
  constructor(private readonly db: Pool) {}

  async findTarget(uuid: string): Promise<RemoteTargetRow | null> {
    const [rows] = await this.db.query<Row[]>(
      `SELECT id, uuid, name, management_ip, remote_scheme, remote_port, is_active
         FROM onu_inventory WHERE uuid = ? LIMIT 1`,
      [uuid],
    )
    const r = rows[0]
    if (!r) return null
    return {
      id: r.id,
      uuid: r.uuid,
      name: r.name,
      managementIp: r.management_ip,
      remoteScheme: r.remote_scheme,
      remotePort: Number(r.remote_port),
      isActive: r.is_active === 1,
    }
  }

  async logAccess(entry: {
    userId: number | null
    deviceUuid: string
    target: string | null
    port: number | null
    result: string
    statusCode: number | null
    requestId: string | null
  }): Promise<void> {
    await this.db.query<ResultSetHeader>(
      `INSERT INTO remote_access_logs (user_id, device_uuid, target, port, result, status_code, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entry.userId, entry.deviceUuid, entry.target, entry.port, entry.result, entry.statusCode, entry.requestId],
    )
  }
}
