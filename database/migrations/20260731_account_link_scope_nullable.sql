-- Pure / empty Group: account_link partitioned by scope_type=group + scope_id (groups.id).
-- company_id may be NULL when there is no anchor subsidiary.

ALTER TABLE `account_link`
  MODIFY COLUMN `company_id` INT UNSIGNED NULL;

ALTER TABLE `account_link`
  ADD COLUMN IF NOT EXISTS `scope_type` ENUM('company','group') NOT NULL DEFAULT 'company' AFTER `company_id`,
  ADD COLUMN IF NOT EXISTS `scope_id` BIGINT UNSIGNED NULL AFTER `scope_type`;

ALTER TABLE `account_link`
  ADD KEY IF NOT EXISTS `idx_account_link_scope` (`scope_type`, `scope_id`);
