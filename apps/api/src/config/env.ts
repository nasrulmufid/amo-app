import { z } from 'zod'

/**
 * Konfigurasi aplikasi — SATU pintu masuk untuk semua environment variable.
 *
 * Prinsip:
 *  1. Validasi saat BOOT. Salah konfigurasi → proses langsung berhenti dengan
 *     pesan jelas, bukan error aneh di tengah request.
 *  2. Kode lain TIDAK boleh membaca `process.env` langsung; gunakan `app.config`.
 *  3. Nilai bertipe (angka, boolean, list) sudah dikonversi di sini.
 *
 * Kontrak nama variabel mengikuti PRD §8.2 (lihat .env.example).
 *
 * ⚠ Zod 4: `.default()` mengharapkan nilai *output*. Untuk schema yang punya
 *   `.transform()` kita memakai `.prefault()` (default pada sisi *input*, lalu
 *   tetap melewati transform).
 */

const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

const stringList = z.string().transform(csv)
const portList = z
  .string()
  .transform(csv)
  .transform((parts) => parts.map(Number)) // "abc" → NaN → ditolak oleh z.number() di bawah
  .pipe(z.array(z.number().int().min(1).max(65535)).min(1))
const boolString = z.enum(['true', 'false']).transform((v) => v === 'true')

const EnvSchema = z
  .object({
    // ── API ──
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_BASE_URL: z.url(),
    TRUST_PROXY: boolString.prefault('false'),
    API_DOCS_ENABLED: boolString.prefault('true'),

    // ── Penyajian frontend produksi (tanpa Nginx) ──
    // true = Fastify menyajikan apps/web/dist (build Vite) pada origin yang sama.
    SERVE_WEB: boolString.prefault('false'),
    // [+] Timpa lokasi dist frontend (default: ../web/dist relatif terhadap API).
    WEB_DIST_DIR: z.string().default(''),

    // ── Sesi ──
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET minimal 32 karakter'),
    SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().positive().default(60),

    // ── Database ──
    DATABASE_URL: z.string().refine((v) => v.startsWith('mysql://'), 'harus berawalan mysql://'),
    DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

    // ── GenieACS (dipakai mulai Sprint 3) ──
    GENIEACS_NBI_URL: z.url().default('http://genieacs-nbi:7557'),
    GENIEACS_USERNAME: z.string().default(''),
    GENIEACS_PASSWORD: z.string().default(''),
    GENIEACS_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    GENIEACS_SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),
    ONLINE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(600),

    // ── Kebijakan remote proxy (dipakai mulai Sprint 4) ──
    REMOTE_ALLOWED_PORTS: portList.prefault('80,443'),
    REMOTE_ALLOWED_SCHEMES: z
      .string()
      .transform(csv)
      .pipe(z.array(z.enum(['http', 'https'])).min(1))
      .prefault('http,https'),
    REMOTE_SESSION_REQUIRED: boolString.prefault('true'),
    REMOTE_AUDIT_ENABLED: boolString.prefault('true'),
    REMOTE_ALLOWED_CIDRS: stringList.prefault(''),
  })
  .superRefine((env, ctx) => {
    // Guard keamanan: jangan pernah jalan di produksi dengan secret contoh.
    if (env.NODE_ENV === 'production' && /CHANGE_ME/i.test(env.SESSION_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'Secret contoh (CHANGE_ME…) tidak boleh dipakai di production',
      })
    }
  })

export type Env = z.infer<typeof EnvSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Konfigurasi environment tidak valid:\n${lines.join('\n')}`)
  }
  return parsed.data
}

/** Origin (scheme://host:port) aplikasi web — basis CORS & cek header Origin. */
export const appOrigin = (env: Env): string => new URL(env.APP_BASE_URL).origin

/** Cookie `Secure` otomatis aktif bila aplikasi diakses lewat HTTPS. */
export const isHttps = (env: Env): boolean => env.APP_BASE_URL.startsWith('https://')
