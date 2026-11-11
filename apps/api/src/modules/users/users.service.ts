import type { Role, UserListItemDTO } from '@amo/shared'
import type { Env } from '../../config/env'
import { Errors } from '../../common/errors'
import { hashPassword } from '../../common/password'
import type { SessionsRepository } from '../auth/sessions.repository'
import type { UserRecord, UsersRepository } from './users.repository'

/**
 * Logika manajemen pengguna (PRD §2, §9.1).
 *
 * Aturan keamanan yang ditegakkan di sini:
 *  - Email unik (case-insensitive) → 409 CONFLICT.
 *  - Password di-hash argon2id; panjang minimum 12 di produksi.
 *  - Menonaktifkan akun ATAU mengganti password → SEMUA sesi user dicabut
 *    (PRD §10.4: sesi lama tidak boleh tetap berlaku).
 *  - Admin terakhir tidak boleh dinonaktifkan/diturunkan rolenya (cegah lockout).
 *  - Respons tidak pernah memuat password_hash.
 */
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly env: Env,
  ) {}

  private get minPasswordLength(): number {
    return this.env.NODE_ENV === 'production' ? 12 : 8
  }

  private toDto(u: UserRecord): UserListItemDTO {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }
  }

  async list(query: { page: number; pageSize: number; q?: string; role?: Role; active?: boolean }) {
    const { rows, total } = await this.repo.list(query)
    return {
      items: rows.map((u) => this.toDto(u)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    }
  }

  async create(input: { name: string; email: string; password: string; role: Role }): Promise<UserListItemDTO> {
    const email = input.email.trim().toLowerCase()
    if (input.password.length < this.minPasswordLength) {
      throw Errors.validation(`Password minimal ${this.minPasswordLength} karakter.`)
    }
    if (await this.repo.findByEmail(email)) {
      throw Errors.conflict('Email sudah terdaftar.')
    }
    const id = await this.repo.insert({
      name: input.name.trim(),
      email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
    })
    const created = await this.repo.findById(id)
    if (!created) throw Errors.notFound('Pengguna')
    return this.toDto(created)
  }

  async update(
    id: number,
    patch: { name?: string; email?: string; password?: string; role?: Role; isActive?: boolean },
    actorId: number,
  ): Promise<UserListItemDTO> {
    const current = await this.repo.findById(id)
    if (!current) throw Errors.notFound('Pengguna')

    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase()
      if (email !== current.email) {
        const existing = await this.repo.findByEmail(email)
        if (existing && existing.id !== id) throw Errors.conflict('Email sudah terdaftar.')
      }
    }
    if (patch.password !== undefined && patch.password.length < this.minPasswordLength) {
      throw Errors.validation(`Password minimal ${this.minPasswordLength} karakter.`)
    }

    // Cegah lockout: admin terakhir tidak boleh kehilangan akses admin.
    const losesAdmin =
      current.role === 'admin' &&
      current.isActive &&
      ((patch.role !== undefined && patch.role !== 'admin') || patch.isActive === false)
    if (losesAdmin && (await this.repo.countActiveAdmins()) <= 1) {
      throw Errors.conflict('Tidak dapat menonaktifkan atau menurunkan admin terakhir.')
    }
    if (id === actorId && patch.isActive === false) {
      throw Errors.conflict('Anda tidak dapat menonaktifkan akun Anda sendiri.')
    }

    await this.repo.update(id, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.email !== undefined ? { email: patch.email.trim().toLowerCase() } : {}),
      ...(patch.password !== undefined ? { passwordHash: await hashPassword(patch.password) } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    })

    // Sesi lama harus langsung tidak berlaku bila akses berubah.
    const revokeSessions =
      patch.password !== undefined || patch.isActive === false || (patch.role !== undefined && patch.role !== current.role)
    if (revokeSessions) await this.sessions.deleteByUser(id)

    const updated = await this.repo.findById(id)
    if (!updated) throw Errors.notFound('Pengguna')
    return this.toDto(updated)
  }
}
