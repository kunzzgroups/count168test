<?php
/**
 * Dashboard FX rates API (DB-cached Frankfurter).
 * Path: api/fx/fx_rates_api.php?base=MYR&quotes=USD,SGD&date=YYYY-MM-DD
 *
 * Response data: Frankfurter-compatible row list
 *   [{ date, base, quote, rate }, ...]
 * Plus unsupported codes in message/meta via data wrapper fields when needed —
 * frontend parsers accept array or { data: array }.
 */

session_start();
session_write_close();

require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../api_response.php';
require_once __DIR__ . '/../includes/fx_rates.php';

header('Content-Type: application/json; charset=utf-8');

try {
    if (!isset($_SESSION['user_id'])) {
        api_error('用户未登录', 401);
        exit;
    }

    if (!isset($pdo) || !($pdo instanceof PDO)) {
        api_error('数据库不可用', 500);
        exit;
    }

    $base = fx_rates_normalize_code($_GET['base'] ?? '');
    $quotesRaw = (string) ($_GET['quotes'] ?? '');
    $dateRaw = trim((string) ($_GET['date'] ?? ''));
    $dateYmd = $dateRaw !== '' ? $dateRaw : null;

    if ($base === '') {
        api_error('缺少 base', 400);
        exit;
    }

    if ($dateYmd !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateYmd)) {
        api_error('date 格式须为 YYYY-MM-DD', 400);
        exit;
    }

    $quoteCodes = array_filter(array_map('trim', explode(',', $quotesRaw)));
    $resolved = fx_rates_resolve($pdo, $base, $quoteCodes, $dateYmd);

    api_success([
        'rows' => $resolved['rows'],
        'unsupported' => $resolved['unsupported'],
        'cache' => $resolved['cache'],
        'rate_date' => $resolved['rate_date'],
        // Flat Frankfurter-compatible alias for older parsers that read data as array —
        // kept as sibling; clients should prefer rows.
        'rates' => $resolved['rows'],
    ]);
} catch (PDOException $e) {
    error_log('fx_rates_api PDO: ' . $e->getMessage());
    api_error('数据库错误', 500);
} catch (Throwable $e) {
    error_log('fx_rates_api: ' . $e->getMessage());
    api_error('汇率暂时不可用', 502);
}
