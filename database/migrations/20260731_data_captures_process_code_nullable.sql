-- Pure / empty Group Data Capture: store fixed payroll process_code without process table rows.
-- process_id / company_id may be NULL; scope_type=group + scope_id identifies the tenant.

ALTER TABLE `data_captures`
  MODIFY COLUMN `company_id` INT UNSIGNED NULL,
  MODIFY COLUMN `process_id` INT NULL;

ALTER TABLE `data_captures`
  ADD COLUMN IF NOT EXISTS `process_code` VARCHAR(50) NULL AFTER `process_id`;

ALTER TABLE `submitted_processes`
  MODIFY COLUMN `company_id` INT UNSIGNED NULL,
  MODIFY COLUMN `process_id` INT NULL;

ALTER TABLE `submitted_processes`
  ADD COLUMN IF NOT EXISTS `process_code` VARCHAR(50) NULL AFTER `process_id`;
