import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'

export interface AuditRow {
  userId: number | null
  action: string
  resourceType: string | null
  resourceId: string | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
  details: unknown
}

export interface AuditListRow {
  id: number
  userId: number | null
  userName: string | null
  action: string
  resourceType: string | null
  resourceId: string | null
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  details: unknown
  createdAt: Date
}

interface Row extends RowDataPacket {
  id: number
  user_id: number | null
  user_name: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  ip_address: string | null
  user_agent: string | null
  request_id: string | null
  details: unknown
  created_at: Date
}

export interface AuditFilters {
  page: number
  pageSize: number
  userId?: number
  action?: string
  resourceType?: string
  resourceId?: string
  from?: Date
  to?: Date
}

export class AuditRepository {
  constructor(private readonly db: Pool) {}

  async insert(row: AuditRow): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs
         (user_id, action, resource_type, resource_id, ip_address, user_agent, request_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.userId,
        row.action,
        row.resourceType,
        row.resourceId,
        row.ip,
        row.userAgent,
        row.requestId,
        row.details === undefined ? null : JSON.stringify(row.details),
      ],
    )
  }

  async list(filters: AuditFilters): Promise<{ rows: AuditListRow[]; total: number }> {
    const where: string[] = []
    const params: unknown[] = []
    if (filters.userId !== undefined) {
      where.push('a.user_id = ?')
      params.push(filters.userId)
    }
    if (filters.action) {
      where.push('a.action = ?')
      params.push(filters.action)
    }
    if (filters.resourceType) {
      where.push('a.resource_type = ?')
      params.push(filters.resourceType)
    }
    if (filters.resourceId) {
      where.push('a.resource_id = ?')
      params.push(filters.resourceId)
    }
    if (filters.from) {
      where.push('a.created_at >= ?')
      params.push(filters.from)
    }
    if (filters.to) {
      where.push('a.created_at <= ?')
      params.push(filters.to)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [countRows] = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`,
      params,
    )
    const [rows] = await this.db.query<Row[]>(
      `SELECT a.id, a.user_id, u.name AS user_name, a.action, a.resource_type, a.resource_id,
              a.ip_address, a.user_agent, a.request_id, a.details, a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ${whereSql}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ? OFFSET ?`,
      [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
    )

    return {
      total: Number(countRows[0]?.total ?? 0),
      rows: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.user_name,
        action: r.action,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        requestId: r.request_id,
        details: r.details,
        createdAt: r.created_at,
      })),
    }
  }

  /** Retensi (PRD §3.5): hapus audit lebih tua dari N hari. */
  async deleteOlderThan(days: number): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      'DELETE FROM audit_logs WHERE created_at < UTC_TIMESTAMP() - INTERVAL ? DAY',
      [days],
    )
    return res.affectedRows
  }
}
