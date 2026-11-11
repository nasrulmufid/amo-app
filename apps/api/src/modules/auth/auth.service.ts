import { AppError } from '../../common/errors'
import { getDummyHash, verifyPassword } from '../../common/password'
import type { UsersRepository } from '../users/users.repository'
import type { AuthContext, AuthUser, SessionService } from './session.service'

/**
 * Error login. Ke client pesannya SELALU generik (anti user-enumeration), tetapi
 * `reason` disimpan untuk audit log internal agar admin bisa menelusuri.
 * (`reason` bukan bagian respons — error-handler hanya mengirim code/message.)
 */
export class InvalidCredentialsError extends AppError {
  constructor(public readonly reason: 'unknown_user' | 'bad_password' | 'inactive') {
    super(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
  }
}

export interface IssuedSession {
  user: AuthUser
  token: string // token mentah → cookie
  expiresAt: Date
  csrfToken: string
}

/**
 * Logika bisnis autentikasi. Route tipis → memanggil kelas ini.
 * Tidak mengenal Fastify (mudah di-unit-test dengan repository palsu).
 */
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
  ) {}

  async login(
    input: { email: string; password: string },
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<IssuedSession> {
    const email = input.email.trim().toLowerCase()
    const user = await this.users.findByEmail(email)

    // Verifikasi SELALU dijalankan (pakai hash umpan bila user tak ada) → waktu respons seragam.
    const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password)

    if (!user) throw new InvalidCredentialsError('unknown_user')
    if (!user.isActive) throw new InvalidCredentialsError('inactive')
    if (!passwordOk) throw new InvalidCredentialsError('bad_password')

    const session = await this.sessions.create(user.id, meta)
    await this.users.markLoggedIn(user.id)

    return {
      ...session,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        lastLoginAt: user.lastLoginAt, // nilai SEBELUM login ini (berguna untuk "terakhir masuk")
      },
    }
  }

  /**
   * Perpanjang sesi dengan ROTASI token: sesi baru dibuat, sesi lama dicabut.
   * Token yang bocor jadi tak berguna setelah user berikutnya me-refresh.
   * TODO (opsional): batas umur absolut total (mis. 7 hari sejak login awal) agar
   *                  refresh tak bisa memperpanjang sesi tanpa akhir.
   */
  async refresh(
    auth: AuthContext,
    oldToken: string,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<IssuedSession> {
    const session = await this.sessions.create(auth.user.id, meta)
    await this.sessions.revoke(oldToken)
    return { ...session, user: auth.user }
  }

  async logout(token: string): Promise<void> {
    await this.sessions.revoke(token)
  }
}
