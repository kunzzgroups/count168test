-- Pure / empty group account links have no anchor company.
-- account_company.company_id FK rejected 0; allow NULL for scope_type=group rows.

ALTER TABLE `account_company`
  MODIFY COLUMN `company_id` INT(10) UNSIGNED NULL COMMENT 'Company FK; NULL for pure group ledger';
