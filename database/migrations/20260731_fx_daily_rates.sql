-- Global FX cache for dashboard (Frankfurter-backed).
-- Not tenant-scoped: market mid rates shared across companies.
-- Run once on existing DB (idempotent).

CREATE TABLE IF NOT EXISTS `fx_daily_rates` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `base_code` varchar(10) NOT NULL,
  `quote_code` varchar(10) NOT NULL,
  `rate_date` date NOT NULL COMMENT 'Frankfurter rate calendar date',
  `rate` decimal(24,12) NOT NULL COMMENT '1 base = rate quote',
  `source` varchar(32) NOT NULL DEFAULT 'frankfurter',
  `fetched_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fx_base_quote_date` (`base_code`, `quote_code`, `rate_date`),
  KEY `idx_fx_base_date` (`base_code`, `rate_date`),
  KEY `idx_fx_fetched_at` (`fetched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
