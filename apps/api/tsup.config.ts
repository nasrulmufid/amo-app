import { defineConfig } from 'tsup'

/**
 * Build produksi API → dist/.
 *  - 3 entry: server (runtime), migrate & seed (dijalankan di container).
 *  - `@amo/shared` di-bundle (noExternal) karena paketnya berupa source TypeScript
 *    (tidak punya langkah build sendiri). Dependensi npm lain tetap external.
 */
export default defineConfig({
  entry: {
    server: 'src/server.ts',
    'scripts/migrate': 'src/scripts/migrate.ts',
    'scripts/seed-admin': 'src/scripts/seed-admin.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: ['@amo/shared'],
})
