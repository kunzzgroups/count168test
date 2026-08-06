-- Pure / empty group tenants have no anchor company row.
-- currency.company_id FK rejected 0; allow NULL for scope_type=group rows.
-- Applied on local easycount 2026-07-31.

ALTER TABLE `currency`
  MODIFY COLUMN `company_id` INT(10) UNSIGNED NULL COMMENT 'Company FK; NULL for pure group ledger currencies';
