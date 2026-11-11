-- ════════════════════════════════════════════════════════════════════════════
--  AMO — Migration 003: management_ip sebagai data ACS (ikut sync GenieACS)
--
--  Latar belakang: kolom `onu_inventory.management_ip` dikelola manual sehingga
--  tak pernah terisi dari sync. Kini IP manajemen juga disimpan di `onu_devices`
--  (sumber: parameter GenieACS, default path IPTR069, dapat ditimpa via
--  device_parameter_map) sehingga draft/quick-link otomatis mendapat IP.
--
--  Prioritas tampilan: data manual (onu_inventory) TETAP menimpa data ACS —
--  kolom onu_devices.management_ip hanya diisi saat metadata manual kosong.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE onu_devices
  ADD COLUMN management_ip VARCHAR(45) NULL AFTER model;

CREATE INDEX idx_onu_devices_mgmt_ip ON onu_devices (management_ip);
