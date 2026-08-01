<?php
/**
 * User 货币显示顺序 API（按账号 + 公司 / Group 维度永久化）
 * GET: ?company_id= 或 ?group_id=；未传 company 时可用 session / group login
 * POST: JSON { "company_id"?: int, "group_id"?: string, "order": ["USD","MYR",...] }
 *
 * 存储格式（currency_order 列）：
 * - 旧版：JSON 数组 ["MYR","USD"] — 对所有公司返回同一顺序，直至某公司通过 POST 写入后迁移为对象
 * - 新版：JSON 对象 { "12": ["USD","MYR"], "g:5": ["MYR"] } — 数字键为公司 ID；`g:{groups.id}` 为纯 Group 账本
 */

session_start();
session_write_close(); // 释放 session 锁，允许并发 AJAX 请求并行执行
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../includes/group_company_access.php';
require_once __DIR__ . '/../api_response.php';

/**
 * @param mixed $decoded
 */
function currency_order_is_flat_list($decoded) {
    if (!is_array($decoded) || $decoded === []) {
        return false;
    }
    $i = 0;
    foreach ($decoded as $k => $_) {
        if ($k !== $i) {
            return false;
        }
        $i++;
    }
    return true;
}

/**
 * @param array<int|string, mixed> $order
 * @return list<string>
 */
function normalize_currency_order_codes(array $order) {
    $out = [];
    foreach ($order as $c) {
        $u = strtoupper(trim((string) $c));
        if ($u === '' || $u === 'ALL') {
            continue;
        }
        if (!in_array($u, $out, true)) {
            $out[] = $u;
        }
    }
    return $out;
}

/**
 * 从 DB 行解析出「按公司」的 map；若为旧版平铺数组则返回空 map（由 GET 单独返回 legacy）
 *
 * @return array<string, list<string>>
 */
function currency_order_decode_to_company_map(?string $json, ?array &$legacyFlat) {
    $legacyFlat = null;
    if ($json === null || $json === '') {
        return [];
    }
    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        return [];
    }
    if (currency_order_is_flat_list($decoded)) {
        $norm = normalize_currency_order_codes($decoded);
        $legacyFlat = $norm !== [] ? $norm : null;
        return [];
    }
    $map = [];
    foreach ($decoded as $k => $v) {
        if (!is_array($v)) {
            continue;
        }
        $key = (string) $k;
        // Group ledger keys: g:{groups.id}
        if (preg_match('/^g:\d+$/', $key)) {
            $norm = normalize_currency_order_codes($v);
            if ($norm !== []) {
                $map[$key] = $norm;
            }
            continue;
        }
        $kid = (int) $k;
        if ($kid <= 0) {
            continue;
        }
        $norm = normalize_currency_order_codes($v);
        if ($norm !== []) {
            $map[(string) $kid] = $norm;
        }
    }
    return $map;
}

/**
 * True only when the caller explicitly passed group_id/view_group (not the
 * gc_is_group_login() session fallback) — used to stop the company_id
 * resolution from falling back to $_SESSION['company_id'], which for group
 * members can be an unrelated subsidiary anchor rather than the ledger the
 * account actually lives on.
 */
function currency_order_has_explicit_group_param(?array $body = null): bool
{
    if (is_array($body)) {
        if (isset($body['view_group']) && trim((string) $body['view_group']) !== '') {
            return true;
        }
        if (isset($body['group_id']) && trim((string) $body['group_id']) !== '') {
            return true;
        }
    }
    if (isset($_GET['view_group']) && trim((string) $_GET['view_group']) !== '') {
        return true;
    }
    if (isset($_GET['group_id']) && trim((string) $_GET['group_id']) !== '') {
        return true;
    }
    return false;
}

/**
 * Resolve view_group for company access checks (GET query or group login).
 */
function currency_order_view_group(?array $body = null): ?string
{
    if (is_array($body)) {
        if (isset($body['view_group']) && trim((string) $body['view_group']) !== '') {
            return gc_normalize_view_group((string) $body['view_group']);
        }
        if (isset($body['group_id']) && trim((string) $body['group_id']) !== '') {
            return gc_normalize_view_group((string) $body['group_id']);
        }
    }
    if (isset($_GET['view_group']) && trim((string) $_GET['view_group']) !== '') {
        return gc_normalize_view_group((string) $_GET['view_group']);
    }
    if (isset($_GET['group_id']) && trim((string) $_GET['group_id']) !== '') {
        return gc_normalize_view_group((string) $_GET['group_id']);
    }
    if (gc_is_group_login()) {
        return gc_session_login_identifier();
    }

    return null;
}

/**
 * Map key for display order: company id string, or g:{groups.id} for pure group.
 *
 * @return array{map_key:?string, company_id:int, group_code:?string}
 */
function currency_order_resolve_map_key(PDO $pdo, int $companyId, ?string $groupCode): array
{
    $g = $groupCode !== null ? strtoupper(trim($groupCode)) : '';
    if ($companyId <= 0 && $g !== '') {
        gc_assert_group_ledger_access($pdo, $g);
        $pk = gc_resolve_group_pk_by_code($pdo, $g);
        if ($pk <= 0) {
            throw new RuntimeException('无效的 group_id');
        }

        return ['map_key' => 'g:' . $pk, 'company_id' => 0, 'group_code' => $g];
    }
    if ($companyId > 0) {
        return ['map_key' => (string) $companyId, 'company_id' => $companyId, 'group_code' => $g !== '' ? $g : null];
    }

    return ['map_key' => null, 'company_id' => 0, 'group_code' => null];
}

function assert_currency_order_company_access(PDO $pdo, int $companyId, ?string $viewGroup = null): void
{
    if ($companyId <= 0) {
        return;
    }
    gc_assert_api_company_access($pdo, $companyId, $viewGroup ?? currency_order_view_group());
}

try {
    if (!isset($_SESSION['user_id'])) {
        api_error('未登录', 401);
        exit;
    }

    $userType = strtolower($_SESSION['user_type'] ?? '');
    $baseId = (int) $_SESSION['user_id'];

    $accountId = ($userType === 'member') ? $baseId : -$baseId;

    $method = $_SERVER['REQUEST_METHOD'] ?? '';

    if ($method === 'GET') {
        $companyId = isset($_GET['company_id'])
            ? (int) $_GET['company_id']
            : (currency_order_has_explicit_group_param() ? 0 : (int) ($_SESSION['company_id'] ?? 0));
        $groupCode = currency_order_view_group();
        try {
            $resolved = currency_order_resolve_map_key($pdo, $companyId, $groupCode);
            if ($resolved['company_id'] > 0) {
                assert_currency_order_company_access($pdo, $resolved['company_id'], $groupCode);
            }
        } catch (RuntimeException $e) {
            api_error($e->getMessage() !== '' ? $e->getMessage() : '无权访问', 403);
            exit;
        }

        $stmt = $pdo->prepare('SELECT currency_order FROM account_currency_display_order WHERE account_id = ?');
        $stmt->execute([$accountId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        $order = null;
        $mapKey = $resolved['map_key'] ?? null;
        if ($row && !empty($row['currency_order'])) {
            $legacyFlat = null;
            $map = currency_order_decode_to_company_map((string) $row['currency_order'], $legacyFlat);
            if ($legacyFlat !== null) {
                $order = $legacyFlat;
            } elseif ($mapKey !== null && isset($map[$mapKey])) {
                $order = $map[$mapKey];
            }
        }
        api_success([
            'order' => $order,
            'company_id' => $resolved['company_id'] > 0 ? $resolved['company_id'] : null,
            'group_id' => $resolved['group_code'] ?? null,
        ]);
        exit;
    }

    if ($method === 'POST') {
        $raw = file_get_contents('php://input');
        $body = json_decode($raw, true);
        if (!is_array($body)) {
            $body = [];
        }

        $companyId = isset($body['company_id']) ? (int) $body['company_id'] : 0;
        if ($companyId <= 0 && !currency_order_has_explicit_group_param($body)) {
            $companyId = (int) ($_SESSION['company_id'] ?? 0);
        }
        $groupCode = currency_order_view_group($body);
        try {
            $resolved = currency_order_resolve_map_key($pdo, $companyId, $groupCode);
            if ($resolved['map_key'] === null) {
                api_error('缺少 company_id 或 group_id（且 session 中无公司）', 400);
                exit;
            }
            if ($resolved['company_id'] > 0) {
                assert_currency_order_company_access($pdo, $resolved['company_id'], $groupCode);
            }
        } catch (RuntimeException $e) {
            api_error($e->getMessage() !== '' ? $e->getMessage() : '无权访问', 403);
            exit;
        }

        $order = isset($body['order']) && is_array($body['order']) ? $body['order'] : [];
        $order = normalize_currency_order_codes($order);

        $stmt = $pdo->prepare('SELECT currency_order FROM account_currency_display_order WHERE account_id = ?');
        $stmt->execute([$accountId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        $legacyFlat = null;
        $existingJson = $row && !empty($row['currency_order']) ? (string) $row['currency_order'] : '';
        $map = currency_order_decode_to_company_map($existingJson, $legacyFlat);

        // 若整表仍是旧版平铺数组，首次按公司/Group 写入时转为 map，不再保留「一条全局顺序」
        $map[$resolved['map_key']] = $order;

        $json = json_encode($map, JSON_UNESCAPED_UNICODE);

        $stmt = $pdo->prepare('
            INSERT INTO account_currency_display_order (account_id, currency_order)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE currency_order = VALUES(currency_order), updated_at = CURRENT_TIMESTAMP
        ');
        $stmt->execute([$accountId, $json]);

        api_success([
            'order' => $order,
            'company_id' => $resolved['company_id'] > 0 ? $resolved['company_id'] : null,
            'group_id' => $resolved['group_code'] ?? null,
        ]);
        exit;
    }

    api_error('Method not allowed', 405);
} catch (Throwable $e) {
    api_error('Server error: ' . $e->getMessage(), 500);
}