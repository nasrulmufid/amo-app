-- ════════════════════════════════════════════════════════════════════════════
--  AMO — Migration 001: skema awal (PRD §7.1 – §7.6)
--
--  Aturan migration (PRD §6 & §7):
--   • File ini SUDAH DITERAPKAN di environment mana pun → JANGAN diedit.
--     Perubahan skema = buat file baru (002_xxx.sql, 003_xxx.sql, ...).
--   • MySQL melakukan auto-commit pada DDL, jadi satu file TIDAK atomik.
--     Karena itu semua statement memakai IF NOT EXISTS agar aman dijalankan ulang.
--   • Dijalankan berurutan oleh `npm run db:migrate` (apps/api/src/scripts/migrate.ts).
--
--  Semua DATETIME disimpan dalam UTC (PRD §8.3). Koneksi API memaksa
--  `SET time_zone = '+00:00'`; konversi ke zona lokal hanya di UI.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 7.1 users ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,                      -- argon2id; TIDAK PERNAH dikirim ke client
  role          ENUM('admin','operator','viewer') NOT NULL DEFAULT 'operator',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 7.2 onu_inventory — data "milik AMO" (dikelola manual) ──────────────────
--  Dibedakan dari onu_devices (data yang datang dari GenieACS) sesuai PRD §3.4.
--  Sync TIDAK BOLEH menimpa: name, location_name, address, latitude, longitude,
--  notes, remote_scheme, remote_port (PRD §8.4).
CREATE TABLE IF NOT EXISTS onu_inventory (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  uuid          CHAR(36) NOT NULL UNIQUE,                   -- dibuat di backend; dipakai di URL /remote/:uuid
  name          VARCHAR(160) NOT NULL,
  serial_number VARCHAR(128) NULL,                          -- boleh NULL (belum diketahui); bila ada → unik
  oui           VARCHAR(16) NULL,
  product_class VARCHAR(128) NULL,
  manufacturer  VARCHAR(128) NULL,
  model         VARCHAR(128) NULL,
  management_ip VARCHAR(45) NULL,                           -- 45 = panjang maksimum IPv6 teks
  remote_scheme ENUM('http','https') NOT NULL DEFAULT 'http',
  remote_port   SMALLINT UNSIGNED NOT NULL DEFAULT 80,      -- divalidasi ke REMOTE_ALLOWED_PORTS di API
  location_name VARCHAR(190) NULL,
  address       TEXT NULL,
  latitude      DECIMAL(10,7) NULL,                         -- NULL = belum ada koordinat (jangan dikarang!)
  longitude     DECIMAL(10,7) NULL,
  notes         TEXT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_onu_serial (serial_number),                 -- NULL berulang diizinkan oleh MySQL
  KEY idx_onu_name (name),
  KEY idx_onu_model (manufacturer, model),
  KEY idx_onu_ip (management_ip),
  KEY idx_onu_active (is_active),
  CONSTRAINT fk_onu_created_by FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 7.3 onu_devices — data "milik GenieACS" (ditimpa oleh sync) ──────────────
--  PENYESUAIAN dari PRD: idx_device_inventory dijadikan UNIQUE (uq_device_inventory)
--  supaya satu record inventaris hanya tertaut ke SATU device GenieACS.
--  Tanpa ini, JOIN di dashboard bisa menghitung ganda. MySQL mengizinkan banyak
--  NULL pada kolom UNIQUE, jadi device yang belum tertaut tetap aman.
CREATE TABLE IF NOT EXISTS onu_devices (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inventory_id       BIGINT UNSIGNED NULL,
  genieacs_device_id VARCHAR(190) NOT NULL UNIQUE,          -- _id dari GenieACS; kunci idempotensi sync
  serial_number      VARCHAR(128) NULL,
  manufacturer       VARCHAR(128) NULL,
  model              VARCHAR(128) NULL,
  last_inform_at     DATETIME NULL,
  last_synced_at     DATETIME NULL,
  online_status      ENUM('online','offline','unknown') NOT NULL DEFAULT 'unknown',
  parameters_json    JSON NULL,                             -- snapshot parameter; REDAKSI password sebelum simpan!
  sync_error         TEXT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                     ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_inventory (inventory_id),
  KEY idx_device_serial (serial_number),
  KEY idx_device_status (online_status),
  KEY idx_device_sync (last_synced_at),
  CONSTRAINT fk_device_inventory FOREIGN KEY (inventory_id)
    REFERENCES onu_inventory(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 7.4 auth_sessions ───────────────────────────────────────────────────────
--  `id` = SHA-256 (hex, 64 char) dari token acak di cookie — BUKAN token aslinya.
--  Jadi bila tabel ini bocor, penyerang tidak bisa memakai isinya sebagai cookie
--  (PRD §10.4: "Hash token sesi sebelum disimpan").
CREATE TABLE IF NOT EXISTS auth_sessions (
  id           CHAR(64) NOT NULL PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  expires_at   DATETIME NOT NULL,                           -- batas absolut
  last_seen_at DATETIME NULL,                               -- dasar idle timeout
  ip_address   VARCHAR(45) NULL,
  user_agent   VARCHAR(512) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_session_user (user_id),
  KEY idx_session_expiry (expires_at),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 7.5 audit_logs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NULL,
  action        VARCHAR(100) NOT NULL,                      -- lihat AUDIT_ACTIONS di packages/shared
  resource_type VARCHAR(100) NULL,
  resource_id   VARCHAR(190) NULL,
  ip_address    VARCHAR(45) NULL,
  user_agent    VARCHAR(512) NULL,
  request_id    VARCHAR(100) NULL,
  details       JSON NULL,                                  -- JANGAN isi password/cookie/token
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_user_time (user_id, created_at),
  KEY idx_audit_action_time (action, created_at),
  KEY idx_audit_resource (resource_type, resource_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 7.6 Tabel tambahan yang disarankan PRD ──────────────────────────────────
--  Disiapkan sekarang agar sprint 3–5 tidak butuh migration struktural besar.
--  Kolom-kolomnya adalah titik awal yang masuk akal; boleh disesuaikan via 00x_*.sql.

CREATE TABLE IF NOT EXISTS app_settings (
  `key`      VARCHAR(100) NOT NULL PRIMARY KEY,
  value_json JSON NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Satu baris per eksekusi sinkronisasi (PRD §11.1).
CREATE TABLE IF NOT EXISTS sync_runs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  trigger_type  ENUM('scheduler','manual') NOT NULL DEFAULT 'scheduler',
  triggered_by  BIGINT UNSIGNED NULL,
  started_at    DATETIME NOT NULL,
  finished_at   DATETIME NULL,
  status        ENUM('running','success','partial','failed') NOT NULL DEFAULT 'running',
  found_count   INT UNSIGNED NOT NULL DEFAULT 0,
  success_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count  INT UNSIGNED NOT NULL DEFAULT 0,
  error_summary TEXT NULL,
  request_id    VARCHAR(100) NULL,
  KEY idx_sync_started (started_at),
  KEY idx_sync_status (status),
  CONSTRAINT fk_sync_user FOREIGN KEY (triggered_by) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Log khusus akses remote (lebih rinci daripada audit_logs umum).
CREATE TABLE IF NOT EXISTS remote_access_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NULL,
  device_uuid CHAR(36) NOT NULL,
  target      VARCHAR(255) NULL,                            -- host:port, boleh disamarkan
  port        SMALLINT UNSIGNED NULL,
  result      VARCHAR(50) NOT NULL,                         -- ok | denied_policy | denied_perm | upstream_error | ...
  status_code SMALLINT UNSIGNED NULL,
  request_id  VARCHAR(100) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_remote_user_time (user_id, created_at),
  KEY idx_remote_device_time (device_uuid, created_at),
  CONSTRAINT fk_remote_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Pemetaan field UI → path parameter GenieACS (PRD §8.3). Admin-only.
CREATE TABLE IF NOT EXISTS device_parameter_map (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  field_key    VARCHAR(100) NOT NULL,                       -- mis. 'model', 'management_ip'
  manufacturer VARCHAR(128) NULL,                           -- NULL = berlaku untuk semua vendor
  model        VARCHAR(128) NULL,                           -- NULL = berlaku untuk semua model
  param_path   VARCHAR(512) NOT NULL,                       -- mis. 'InternetGatewayDevice.DeviceInfo.ModelName'
  priority     INT NOT NULL DEFAULT 100,                    -- kecil = dicoba lebih dulu (fallback chain)
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
               ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_map_field (field_key, priority),
  KEY idx_map_vendor (manufacturer, model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
