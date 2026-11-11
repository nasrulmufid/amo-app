import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { Role } from '@amo/shared'
import type { Env } from '../../config/env'
import type { SessionsRepository } from './sessions.repository'

/** Pengguna yang sedang login, dilampirkan ke `request.auth`. */
export interface AuthUser {
  id: number
  name: string
  email: string
  role: Role
  lastLoginAt: Date | null
}

/** Konteks autentikasi per-request (hasil `SessionService.resolve`). */
export interface AuthContext {
  user: AuthUser
  /** ID sesi di DB = SHA-256(token cookie). */
  sessionId: string
  /** Batas absolut sesi (UTC). */
  expiresAt: Date
  /** Token CSRF yang valid untuk sesi ini (diturunkan via HMAC, tak perlu disimpan). */
  csrfToken: string
}

const TOKEN_PATTERN = /^[a-f0-9]{64}$/
/** Perbarui last_seen_at paling sering sekali per menit → hemat write ke DB. */
const TOUCH_INTERVAL_MS = 60_000

/**
 * Siklus hidup sesi sisi-server (PRD §3.1 & §10.4).
 *
 *   Cookie  amo_session = token acak 256-bit (hex 64 char)
 *   DB      auth_sessions.id = SHA-256(token)     ← token asli TIDAK disimpan
 *
 * Mengapa bukan JWT? Sesi server-side dapat DICABUT seketika (logout, user
 * dinonaktifkan) dan tak ada bearer token di localStorage (PRD §17).
 */
export class SessionService {
  constructor(
    private readonly repo: SessionsRepository,
    private readonly env: Env,
  ) {}

  static hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

  /**
   * Token CSRF = HMAC(SESSION_SECRET, sessionId). Stateless: server cukup menghitung
   * ulang & membandingkan. Penyerang lintas-origin tak bisa membaca token ini
   * (butuh membaca respons /auth/me, yang dilindungi CORS & SameSite).
   */
  csrfTokenFor(sessionId: string): string {
    return createHmac('sha256', this.env.SESSION_SECRET).update(sessionId).digest('hex')
  }

  /** Buat sesi baru. Mengembalikan token MENTAH (hanya untuk dikirim ke cookie sekali ini). */
  async create(userId: number, meta: { ip: string | null; userAgent: string | null }) {
    const token = randomBytes(32).toString('hex')
    const id = SessionService.hashToken(token)
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000)
    await this.repo.insert({ id, userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent })
    return { token, expiresAt, csrfToken: this.csrfTokenFor(id) }
  }

  /**
   * Validasi token dari cookie. Mengembalikan null bila: format salah, tidak ada di DB,
   * kedaluwarsa (absolut), idle terlalu lama, atau akun sudah dinonaktifkan.
   * Sesi yang terbukti tak berlaku langsung dihapus (pembersihan oportunistik).
   */
  async resolve(token: string): Promise<AuthContext | null> {
    if (!TOKEN_PATTERN.test(token)) return null // tolak sampah tanpa menyentuh DB

    const id = SessionService.hashToken(token)
    const session = await this.repo.findWithUser(id)
    if (!session) return null

    const now = Date.now()
    const lastActivity = (session.lastSeenAt ?? session.createdAt).getTime()
    const idleMs = this.env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000

    const invalid =
      session.expiresAt.getTime() <= now || // lewat batas absolut
      now - lastActivity > idleMs || // diam terlalu lama
      !session.user.isActive // akun dinonaktifkan setelah login
    if (invalid) {
      await this.repo.delete(id)
      return null
    }

    if (now - lastActivity > TOUCH_INTERVAL_MS) await this.repo.touch(id)

    return {
      sessionId: id,
      expiresAt: session.expiresAt,
      csrfToken: this.csrfTokenFor(id),
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
        lastLoginAt: session.user.lastLoginAt,
      },
    }
  }

  /** Cabut sesi (logout). Aman dipanggil untuk token yang sudah tidak ada. */
  async revoke(token: string): Promise<void> {
    await this.repo.delete(SessionService.hashToken(token))
  }

  async purgeExpired(): Promise<number> {
    return this.repo.deleteExpired()
  }
}
