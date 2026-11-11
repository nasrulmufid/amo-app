import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Role } from '@amo/shared'

export interface SessionWithUser {
  id: string
  userId: number
  expiresAt: Date
  lastSeenAt: Date | null
  createdAt: Date
  user: {
    id: number
    name: string
    email: string
    role: Role
    isActive: boolean
    lastLoginAt: Date | null
  }
}

interface Row extends RowDataPacket {
  id: string
  user_id: number
  expires_at: Date
  last_seen_at: Date | null
  created_at: Date
  name: string
  email: string
  role: Role
  is_active: number
  last_login_at: Date | null
}

/** SQL untuk tabel `auth_sessions`. `id` di sini = SHA-256 token (lihat migration 001). */
export class SessionsRepository {
  constructor(private readonly db: Pool) {}

  async insert(s: {
    id: string
    userId: number
    expiresAt: Date
    ip: string | null
    userAgent: string | null
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO auth_sessions (id, user_id, expires_at, last_seen_at, ip_address, user_agent)
       VALUES (?, ?, ?, UTC_TIMESTAMP(), ?, ?)`,
      [s.id, s.userId, s.expiresAt, s.ip, s.userAgent],
    )
  }

  async findWithUser(id: string): Promise<SessionWithUser | null> {
    const [rows] = await this.db.query<Row[]>(
      `SELECT s.id, s.user_id, s.expires_at, s.last_seen_at, s.created_at,
              u.name, u.email, u.role, u.is_active, u.last_login_at
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
        LIMIT 1`,
      [id],
    )
    const r = rows[0]
    if (!r) return null
    return {
      id: r.id,
      userId: r.user_id,
      expiresAt: r.expires_at,
      lastSeenAt: r.last_seen_at,
      createdAt: r.created_at,
      user: {
        id: r.user_id,
        name: r.name,
        email: r.email,
        role: r.role,
        isActive: r.is_active === 1,
        lastLoginAt: r.last_login_at,
      },
    }
  }

  async touch(id: string): Promise<void> {
    await this.db.query('UPDATE auth_sessions SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?', [id])
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM auth_sessions WHERE id = ?', [id])
  }

  /** Dipakai nanti untuk "cabut semua sesi user" (ganti password / nonaktifkan akun). */
  async deleteByUser(userId: number): Promise<void> {
    await this.db.query('DELETE FROM auth_sessions WHERE user_id = ?', [userId])
  }

  async deleteExpired(): Promise<number> {
    const [res] = await this.db.query<import('mysql2/promise').ResultSetHeader>(
      'DELETE FROM auth_sessions WHERE expires_at < UTC_TIMESTAMP()',
    )
    return res.affectedRows
  }
}
