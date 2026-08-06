<?php
/**
 * Prefetch latest FX rates into fx_daily_rates (Frankfurter → DB).
 *
 * Suggested EC2 cron (hourly, Amazon Linux):
 *   0 * * * * /usr/bin/php /var/www/count168/cron/warm_fx_rates.php >> /home/ec2-user/logs/warm_fx_rates.log 2>&1
 */
if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Forbidden');
}

require_once dirname(__DIR__) . '/includes/config.php';
require_once dirname(__DIR__) . '/api/includes/fx_rates.php';

if (!isset($pdo) || !($pdo instanceof PDO)) {
    fwrite(STDERR, '[' . date('c') . "] warm_fx_rates: FAIL database unavailable\n");
    exit(1);
}

if (!fx_rates_table_exists($pdo)) {
    fwrite(STDERR, '[' . date('c') . "] warm_fx_rates: FAIL table fx_daily_rates missing — run migration 20260731_fx_daily_rates.sql\n");
    exit(1);
}

try {
    $result = fx_rates_warm_latest($pdo);
    $errCount = count($result['errors']);
    fwrite(
        STDERR,
        '[' . date('c') . '] warm_fx_rates: OK'
        . ' bases=' . $result['bases']
        . ' upserted=' . $result['upserted']
        . ' errors=' . $errCount
        . ($errCount ? ' detail=' . implode('; ', $result['errors']) : '')
        . "\n"
    );
    exit($errCount > 0 && $result['upserted'] === 0 ? 1 : 0);
} catch (Throwable $e) {
    fwrite(STDERR, '[' . date('c') . '] warm_fx_rates: FAIL ' . $e->getMessage() . "\n");
    exit(1);
}
