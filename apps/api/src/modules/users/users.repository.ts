import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Role } from '@amo/shared'

/**
 * REPOSITORY = satu-satunya tempat SQL untuk tabel `users` (PRD §6: "hindari
 * query database tersebar di handler"). Service memanggil repository; handler
 * tidak pernah menyentuh `db` langsung.
 *
 * Konvensi:
 *  - memakai `db.query()` (bukan `execute()`) agar objek Date dikonversi sesuai
 *    opsi `timezone: 'Z'` (UTC) — lihat plugins/database.ts.
 *  - SELALU pakai placeholder `?`; jangan pernah menyambung string SQL dari input.
 *  - baris DB (snake_case) dipetakan ke objek TypeScript (camelCase) di sini.
 */

export interface UserRecord {
  id: number
  name: string
  email: string
  passwordHash: string
  role: Role
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
}

interface UserRow extends RowDataPacket {
  id: number
  name: string
  email: string
  password_hash: string
  role: Role
  is_active: number
  last_login_at: Date | null
  created_at: Date
}

const toRecord = (r: UserRow): UserRecord => ({
  id: r.id,
  name: r.name,
  email: r.email,
  passwordHash: r.password_hash,
  role: r.role,
  isActive: r.is_active === 1,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at,
})

const COLUMNS = 'id, name, email, password_hash, role, is_active, last_login_at, created_at'

export class UsersRepository {
  constructor(private readonly db: Pool) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const [rows] = await this.db.query<UserRow[]>(
      `SELECT ${COLUMNS} FROM users WHERE email = ? LIMIT 1`,
      [email],
    )
    return rows[0] ? toRecord(rows[0]) : null
  }

  async findById(id: number): Promise<UserRecord | null> {
    const [rows] = await this.db.query<UserRow[]>(`SELECT ${COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id])
    return rows[0] ? toRecord(rows[0]) : null
  }

  async list(query: { page: number; pageSize: number; q?: string; role?: Role; active?: boolean }) {
    const where: string[] = []
    const params: unknown[] = []
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      where.push('(name LIKE ? OR email LIKE ?)')
      params.push(like, like)
    }
    if (query.role) {
      where.push('role = ?')
      params.push(query.role)
    }
    if (query.active !== undefined) {
      where.push('is_active = ?')
      params.push(query.active ? 1 : 0)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const [countRows] = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM users ${whereSql}`,
      params,
    )
    const [rows] = await this.db.query<UserRow[]>(
      `SELECT ${COLUMNS} FROM users ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    )
    return { rows: rows.map(toRecord), total: Number(countRows[0]?.total ?? 0) }
  }

  async insert(input: { name: string; email: string; passwordHash: string; role: Role }): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [input.name, input.email, input.passwordHash, input.role],
    )
    return res.insertId
  }

  async update(
    id: number,
    patch: { name?: string; email?: string; passwordHash?: string; role?: Role; isActive?: boolean },
  ): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    if (patch.name !== undefined) {
      sets.push('name = ?')
      params.push(patch.name)
    }
    if (patch.email !== undefined) {
      sets.push('email = ?')
      params.push(patch.email)
    }
    if (patch.passwordHash !== undefined) {
      sets.push('password_hash = ?')
      params.push(patch.passwordHash)
    }
    if (patch.role !== undefined) {
      sets.push('role = ?')
      params.push(patch.role)
    }
    if (patch.isActive !== undefined) {
      sets.push('is_active = ?')
      params.push(patch.isActive ? 1 : 0)
    }
    if (sets.length === 0) return
    params.push(id)
    await this.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  async markLoggedIn(userId: number): Promise<void> {
    await this.db.query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [userId])
  }

  /** Jumlah admin aktif — dipakai untuk mencegah "admin terakhir" dinonaktifkan. */
  async countActiveAdmins(): Promise<number> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = 1",
    )
    return Number(rows[0]?.total ?? 0)
  }
}
