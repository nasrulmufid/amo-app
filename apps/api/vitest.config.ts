import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Env khusus test. Test di folder ini TIDAK membutuhkan MySQL yang berjalan
    // (pool koneksi bersifat lazy) — yang diuji: validasi, guard sesi, util murni.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      APP_BASE_URL: 'http://localhost:5173',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-123456',
      DATABASE_URL: 'mysql://test:test@127.0.0.1:3306/amo_test',
    },
  },
})
