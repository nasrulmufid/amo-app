-- ════════════════════════════════════════════════════════════════════════════
--  AMO — Migration 002: inventaris draft otomatis dari sync GenieACS
--
--  Latar belakang: sync HANYA mengisi onu_devices; halaman inventaris menampilkan
--  onu_inventory, sehingga perangkat hasil sync tak tampak sampai admin menautkan
--  manual. Fitur baru:
--    1. `onu_inventory.auto_created`  → penanda record dibuat otomatis oleh sync
--       (draft), bukan oleh admin. Record tetap dapat diedit seperti biasa;
--       penanda hanya untuk keperluan tampilan/audit.
--    2. `onu_inventory.source_device_id` → jejak device ACS yang menjadi sumber
--       draft (bila dibuat otomatis). Tidak ikut campur logika penautan
--       `onu_devices.inventory_id` yang sudah ada.
--
--  Idempoten (aman dijalankan ulang). JANGAN edit file ini setelah diterapkan.
-- ════════════════════════════════════════════════════════════════════════════

-- Catatan MySQL 8: `ADD COLUMN IF NOT EXISTS` TIDAK didukung (hanya MariaDB).
-- Idempoten dijamin oleh migration runner (schema_migrations + checksum),
-- jadi ALTER biasa sudah cukup dan hanya dijalankan sekali.
ALTER TABLE onu_inventory
  ADD COLUMN auto_created TINYINT(1) NOT NULL DEFAULT 0 AFTER notes,
  ADD COLUMN source_device_id BIGINT UNSIGNED NULL AFTER auto_created,
  ADD CONSTRAINT fk_inv_source_device FOREIGN KEY (source_device_id) REFERENCES onu_devices (id) ON DELETE SET NULL;
