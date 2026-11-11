# AMO — Aplikasi Management ONU

Implementasi lengkap berdasarkan **PRD Final & Spesifikasi Teknis v1.0** (`docs/PRD.html`):
inventarisasi, monitoring, pemetaan, dan akses remote perangkat ONU melalui integrasi
GenieACS serta reverse proxy yang aman.

| Lapisan         | Teknologi                                                                               |
| --------------- | --------------------------------------------------------------------------------------- |
| API             | Fastify 5 · TypeScript strict · TypeBox (schema-first) · MySQL 8 (`mysql2`, SQL murni)  |
| Web             | React 19 · Vite · Tailwind v4 · **shadcn/ui** · TanStack Query · React Router · Leaflet |
| Kontrak bersama | `packages/shared` (konstanta, tipe DTO, matriks izin)                                   |
| Deploy          | Docker Compose · Nginx (web + reverse proxy)                                            |

## Fitur

| Area                       | Status | Keterangan                                                        |
| -------------------------- | ------ | ----------------------------------------------------------------- |
| Login / sesi / CSRF / RBAC | ✅     | Sesi server-side, token di-hash, cookie HttpOnly, rate-limit      |
| Dashboard                  | ✅     | Total/online/offline/unknown/perlu data + perangkat terbaru       |
| Inventaris ONU             | ✅     | Search, filter, sort, pagination server-side, detail, tambah/edit |
| Peta perangkat             | ✅     | Leaflet + OSM, hanya koordinat valid, legenda status              |
| Sinkronisasi GenieACS      | ✅     | Scheduler 60 dtk, upsert idempoten, autolink serial, riwayat run  |
| Remote proxy               | ✅     | Sesi+izin per request, allowlist CIDR, anti-SSRF, audit           |
| Pengguna                   | ✅     | CRUD, role, nonaktifkan (sesi dicabut), proteksi admin terakhir   |
| Audit log                  | ✅     | Viewer + filter + pagination, redaksi otomatis                    |
| Pengaturan                 | ✅     | Interval sync, ambang online, retensi audit, pemetaan parameter   |

## Mulai cepat (pengembangan)

Prasyarat: **Node ≥ 22**, **MySQL 8** (atau Docker).

```bash
npm install
cp .env.example .env            # isi SESSION_SECRET (openssl rand -hex 48) & SEED_ADMIN_*

npm run docker:dev-db           # MySQL 8 lewat Docker (atau pakai MySQL Anda sendiri)
npm run db:migrate              # terapkan skema (aman diulang)
npm run db:seed                 # buat akun admin dari SEED_ADMIN_*

npm run dev                     # API :3000  +  Web :5173
```

Buka **http://localhost:5173** dan login dengan akun seed.

> ⚠ **Akses web lewat host yang SAMA dengan `APP_BASE_URL`** (default `localhost`, bukan `127.0.0.1`).
> Proteksi CSRF menolak request yang `Origin`-nya berbeda.

Tautan berguna: Swagger UI `http://localhost:3000/docs` · health `http://localhost:3000/health`

## Menjalankan mode produksi (tanpa Docker)

Satu proses Node menyajikan **API + frontend sekaligus** di satu port (pengganti Nginx):

```bash
npm run build        # build API (tsup) + Web (vite) — wajib sebelum start
npm run start        # baca .env.production + .env → http://localhost:3000
```

- Frontend dilayani Fastify dari `apps/web/dist` (`SERVE_WEB=true` di `.env.production`),
  jadi web & API **satu origin** — cookie sesi & CSRF berperilaku seperti di Docker/Nginx.
- Secret (`SESSION_SECRET`, `DATABASE_URL`, `SEED_ADMIN_*`, dst.) tetap dibaca dari `.env`.
- Aplikasi diakses lewat host yang sama dengan `APP_BASE_URL` (default `http://localhost:3000`).
- Untuk produksi publik: taruh Nginx/TLS di depan, set `TRUST_PROXY=true`, dan ganti
  `APP_BASE_URL` ke domain Anda — atau gunakan `npm run docker:up`.
- Alternatif frontend saja: `npm run start:web` (vite preview :4173, tetap butuh API jalan).

## Perintah

| Perintah                            | Fungsi                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                       | API + Web (hot reload)                                                          |
| `npm run typecheck`                 | Type-check semua workspace                                                      |
| `npm test`                          | Test API. Tambahkan `INTEGRATION_DATABASE_URL=mysql://…` untuk integration test |
| `npm run build`                     | Build produksi API (tsup) & Web (Vite)                                          |
| `npm run start`                     | **Produksi tanpa Docker**: API + frontend satu proses (:3000)                   |
| `npm run start:web`                 | Preview frontend hasil build saja (vite preview :4173)                          |
| `npm run db:migrate` / `db:seed`    | Migrasi skema / akun admin awal                                                 |
| `npm run openapi:export`            | Hasilkan `docs/openapi.yaml` dari schema route                                  |
| `npm run docker:up` / `docker:down` | Stack penuh (MySQL + API + Nginx/Web)                                           |

## Struktur

```
apps/api/src/
  config/env.ts          ← SATU pintu env (zod). Jangan baca process.env di tempat lain
  plugins/               ← database, security, auth (sesi+CSRF+izin), swagger, error-handler
  modules/<fitur>/       ← routes (tipis) → service (logika) → repository (SQL)
    auth/ dashboard/ inventory/ users/ audit/ settings/
    genieacs/            ← client, mapper, sync.repository, sync.service, sync.plugin
    remote/              ← remote.security (anti-SSRF), remote.service, remote.routes
  common/                ← AppError, envelope respons, schema bersama, password
  scripts/               ← migrate, seed-admin, export-openapi
apps/web/src/
  app/                   ← providers & peta route
  components/ui/         ← komponen shadcn/ui   components/layout/ ← shell + menu
  features/<fitur>/      ← halaman + pemanggilan API per fitur
  lib/api.ts             ← klien HTTP (cookie + CSRF + error seragam)
packages/shared/         ← kontrak API↔Web & matriks izin (RBAC)
database/migrations/     ← SQL versioned (jangan edit yang sudah diterapkan!)
deploy/                  ← Dockerfile, compose, Nginx
docs/                    ← PRD.html, ROADMAP.md, openapi.yaml
```

## Cara menambah fitur (pola)

1. **Schema** TypeBox di `modules/x/x.schema.ts` (body/query/params/response).
2. **Repository** — satu-satunya tempat SQL; selalu placeholder `?`.
3. **Service** — logika bisnis, melempar `Errors.*`.
4. **Routes** — `onRequest: [app.authenticate, app.requirePermission('…')]` + `ok(request, data)`; daftarkan di `modules/index.ts`.
5. Izin baru → `packages/shared/src/permissions.ts` (API & UI ikut).
6. UI: buat `features/x/`, daftarkan di `app/App.tsx` dan `components/layout/nav-items.ts`.

## Keamanan

- Sesi server-side: token acak 256-bit di cookie `HttpOnly; SameSite=Lax` (+`Secure` bila HTTPS); **hanya SHA-256 token disimpan di DB**.
- CSRF: header `x-csrf-token` (HMAC turunan sesi) + validasi `Origin` pada semua request non-GET.
- Login: argon2id, waktu respons disamakan untuk email tak terdaftar, pesan error generik, rate-limit 10/menit/IP.
- Sesi punya batas absolut & idle timeout; akun dinonaktifkan → sesi langsung tak berlaku; refresh merotasi token.
- RBAC di API (UI hanya menyembunyikan menu). Respons difilter schema (tak ada `password_hash` bocor).
- Audit log dengan redaksi otomatis kunci sensitif. Error 5xx tak membocorkan detail.

### Remote proxy (PRD §10)

Urutan pemeriksaan **setiap** request ke `/remote/:uuid/*`:

1. Sesi valid + izin `remote.open`.
2. UUID asing / perangkat nonaktif → 404.
3. Target **hanya** dari DB (`management_ip`, `remote_scheme`, `remote_port`); host/port dari request diabaikan.
4. Skema ∈ `REMOTE_ALLOWED_SCHEMES`, port ∈ `REMOTE_ALLOWED_PORTS` (default 80/443).
5. Anti-SSRF: loopback, link-local (termasuk `169.254.169.254`), multicast, `0.0.0.0`, ULA IPv6 **selalu** ditolak;
   IP harus berada di `REMOTE_ALLOWED_CIDRS` (**kosong = tidak ada target diizinkan**);
   hostname di-resolve sekali, semua hasil divalidasi, koneksi dipaksa ke IP hasil resolusi.
6. Path dinormalisasi (decode, buang `..`, `\`, null-byte) dan tidak dapat keluar dari prefix remote.
7. Header hop-by-hop, cookie `amo_session`, `Authorization`, dan `X-Forwarded-*` dari klien dibuang.
8. Redirect ke host lain diblokir; cookie perangkat di-scope ke `/remote/:uuid/` dengan awalan `amo_remote_`.
9. Timeout 20 dtk + batas ukuran respons 8 MiB.
10. Audit ke `remote_access_logs` + `audit_logs` tanpa kredensial.

> 📌 Banyak UI ONU mengasumsikan origin langsung (path absolut, redirect, JS khusus). Uji per model/firmware.
> Jangan melemahkan kontrol di atas bila ada yang tidak kompatibel — dokumentasikan ketidakcocokan.

## Penyimpangan / tambahan terhadap PRD (disengaja)

| Hal                                   | Keterangan                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onu_devices.inventory_id` **UNIQUE** | PRD: index biasa. Dijadikan unik agar 1 inventaris = 1 device ACS.                                                                                                       |
| Env tambahan                          | `LOG_LEVEL`, `TRUST_PROXY`, `API_DOCS_ENABLED`, `SESSION_TTL_HOURS`, `SESSION_IDLE_TIMEOUT_MINUTES`, `DB_POOL_SIZE`, `ONLINE_THRESHOLD_SECONDS`, `REMOTE_ALLOWED_CIDRS`. |
| `REMOTE_ALLOWED_CIDRS`                | Allowlist jaringan ONU untuk anti-SSRF; **kosong = tak ada target diizinkan**.                                                                                           |
| `management_ip` wajib IP literal      | Mencegah target proxy diarahkan ke host lain lewat DNS.                                                                                                                  |
| Status turunan                        | `stale` & `sync_error` dihitung API dari `last_synced_at`/`sync_error`, bukan kolom DB.                                                                                  |
| Kebijakan remote read-only di UI      | Port/skema/CIDR hanya dari env agar tidak bisa dilonggarkan lewat UI.                                                                                                    |
| Provider peta                         | OpenStreetMap (Leaflet) — tanpa API key.                                                                                                                                 |
| Struktur folder API                   | Vertical slice per modul (PRD §6 mengizinkan).                                                                                                                           |

## Status pengujian

- `npm run typecheck` — API, Web, Shared ✅
- `npm test` — **76 test** (unit, guard, remote security, integration MySQL) ✅
- `npm run build` — API (tsup) & Web (Vite) ✅
- E2E browser: login, dashboard, inventaris (tambah/detail), peta, pengaturan, pengguna, audit ✅
- **Belum diuji:** build image Docker & `docker compose up`; remote proxy ke perangkat ONU fisik.

Lihat `docs/ROADMAP.md` untuk status per sprint.
