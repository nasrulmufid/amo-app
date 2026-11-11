ALTER TABLE onu_devices
  ADD COLUMN product_class VARCHAR(128) NULL AFTER model;
