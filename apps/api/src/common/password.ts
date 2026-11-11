import { hash, verify } from '@node-rs/argon2'

/**
 * Hashing password dengan argon2id (default algoritma @node-rs/argon2).
 * Parameter = rekomendasi minimum OWASP (m=19 MiB, t=2, p=1). Naikkan bila
 * server Anda cukup kuat — hash lama tetap valid (parameter tersimpan di hash).
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export const hashPassword = (plain: string) => hash(plain, OPTIONS)

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain)
  } catch {
    return false // hash rusak/format tidak dikenal → anggap gagal, jangan crash
  }
}

/**
 * Hash "umpan" untuk menyamakan waktu proses saat email TIDAK ditemukan.
 * Tanpa ini, login dengan email tak terdaftar jauh lebih cepat → penyerang
 * dapat menebak email valid dari waktu respons (user enumeration via timing).
 */
let dummyHash: Promise<string> | undefined
export const getDummyHash = () => (dummyHash ??= hashPassword('amo-dummy-password-for-timing'))
