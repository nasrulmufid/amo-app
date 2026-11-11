import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stringify } from 'yaml'
import { buildApp } from '../app'

/**
 * Ekspor kontrak OpenAPI 3.1 ke docs/openapi.yaml (PRD §6 & §16).
 * Dokumen DIHASILKAN dari schema route — jangan diedit tangan. Commit hasilnya agar
 * perubahan kontrak terlihat di code review. Jalankan: `npm run openapi:export`.
 */
const OUT = path.resolve(import.meta.dirname, '../../../../docs/openapi.yaml')

const app = await buildApp()
await app.ready()
await writeFile(OUT, stringify(app.swagger()), 'utf8')
await app.close()
console.log(`✓ ${OUT}`)
