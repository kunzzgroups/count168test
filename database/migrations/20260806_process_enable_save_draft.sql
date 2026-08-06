-- Games Data Capture: let a company flag a specific process (any name, e.g. one
-- of two same-named BONUS processes) to get save-draft, independent of name.
-- Idempotent-safe: api/includes/ensure_process_enable_save_draft_column.php
-- already auto-applies this on first request if the column is missing.

ALTER TABLE `process`
  ADD COLUMN `enable_save_draft` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`
    COMMENT 'Games Data Capture: 1 = save-draft enabled for this process';
