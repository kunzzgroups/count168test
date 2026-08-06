<?php
/**
 * 账户关联 API：获取/建立/解除账户关联及连接类型
 */
require_once __DIR__ . '/../../includes/session_check.php';
require_once __DIR__ . '/../../includes/group_company_access.php';
require_once __DIR__ . '/../../includes/tenant_scope.php';
require_once __DIR__ . '/../deleted_log/deleted_log.php';
require_once __DIR__ . '/../includes/partnership_audit_readonly.php';
header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => '用户未登录', 'data' => null]);
    exit;
}

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$isDirectRequest = (basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'account_link_api.php');

/**
 * @param array<string, mixed> $params
 * @return array{mode: 'group'|'company', group_pk: int, company_id: int, group_code: string}
 */
function accountLinkResolveContext(PDO $pdo, array $params): array
{
    return tenant_resolve_currency_context_from_request($pdo, [
        'group_id' => $params['group_id'] ?? null,
        'view_group' => $params['view_group'] ?? null,
        'company_id' => $params['company_id'] ?? null,
        'group_only' => $params['group_only'] ?? null,
        'session_company_id' => $_SESSION['company_id'] ?? null,
    ]);
}

function accountLinkHasScopeColumns(PDO $pdo): bool
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }
    try {
        $cached = $pdo->query("SHOW COLUMNS FROM account_link LIKE 'scope_type'")->rowCount() > 0;
    } catch (Throwable $e) {
        $cached = false;
    }
    return $cached;
}

/**
 * @return array{company_id: ?int, scope_type: ?string, scope_id: ?int, use_scope: bool}
 */
function accountLinkPartitionFromCtx(PDO $pdo, array $ctx): array
{
    $companyId = (int) ($ctx['company_id'] ?? 0);
    $groupPk = (int) ($ctx['group_pk'] ?? 0);
    if (($ctx['mode'] ?? '') === 'group' && $groupPk > 0 && accountLinkHasScopeColumns($pdo)) {
        return [
            'company_id' => $companyId > 0 ? $companyId : null,
            'scope_type' => 'group',
            'scope_id' => $groupPk,
            'use_scope' => true,
        ];
    }
    return [
        'company_id' => $companyId > 0 ? $companyId : null,
        'scope_type' => null,
        'scope_id' => null,
        'use_scope' => false,
    ];
}

/**
 * @return array{company_id: ?int, scope_type: ?string, scope_id: ?int, use_scope: bool}
 */
function accountLinkAssertCtx(PDO $pdo, array $ctx): array
{
    $companyId = (int) ($ctx['company_id'] ?? 0);
    $groupPk = (int) ($ctx['group_pk'] ?? 0);
    $isPureGroup = ($ctx['mode'] ?? '') === 'group' && $groupPk > 0;
    if ($companyId <= 0 && !$isPureGroup) {
        throw new Exception('缺少必要参数');
    }
    $groupCode = (string) ($ctx['group_code'] ?? '');
    if ($companyId > 0 && $groupCode !== '' && gc_is_group_login()) {
        gc_assert_company_id_allowed_for_login_scope($pdo, $companyId, $groupCode);
    } elseif ($isPureGroup && $groupCode !== '') {
        if (!gc_session_can_access_group_ledger($pdo, $groupCode)) {
            throw new Exception('无权限访问该集团');
        }
    }
    $part = accountLinkPartitionFromCtx($pdo, $ctx);
    if (!$part['use_scope'] && ($part['company_id'] === null || (int) $part['company_id'] <= 0)) {
        throw new Exception('缺少必要参数');
    }
    return $part;
}

/**
 * @param array{company_id: ?int, scope_type: ?string, scope_id: ?int, use_scope: bool} $part
 * @return array{sql: string, params: array<int|string>}
 */
function accountLinkWhereSql(array $part, string $alias = ''): array
{
    $p = $alias !== '' ? $alias . '.' : '';
    if (!empty($part['use_scope'])) {
        return [
            'sql' => "{$p}scope_type = ? AND {$p}scope_id = ?",
            'params' => [(string) $part['scope_type'], (int) $part['scope_id']],
        ];
    }
    return [
        'sql' => "{$p}company_id = ?",
        'params' => [(int) $part['company_id']],
    ];
}

if ($isDirectRequest) {
    try {
        switch ($action) {
            case 'get_linked_accounts':
                $account_id = isset($_GET['account_id']) ? (int) $_GET['account_id'] : 0;
                $linkCtx = accountLinkResolveContext($pdo, $_GET);
                $part = accountLinkAssertCtx($pdo, $linkCtx);
                if ($account_id <= 0) {
                    throw new Exception('缺少必要参数');
                }
                if (!linkAccountBelongsToContext($pdo, $account_id, $linkCtx)) {
                    throw new Exception('账户不属于当前范围');
                }
                $linked_accounts_data = getAllLinkedAccountsForDisplayWithType($pdo, $account_id, $part, $linkCtx);
                $link_type_info = getLinkTypeInfo($pdo, $account_id, $part);
                echo json_encode([
                    'success' => true,
                    'message' => '',
                    'data' => [
                        'accounts' => $linked_accounts_data['accounts'],
                        'link_type_info' => $link_type_info,
                        'link_types_map' => $linked_accounts_data['link_types_map'],
                        'company_id' => $part['company_id'],
                        'scope_mode' => $linkCtx['mode'] ?? 'company',
                        'group_pk' => (int) ($linkCtx['group_pk'] ?? 0),
                    ],
                ]);
                break;

            case 'link_accounts':
                if (is_partnership_audit_read_only_active($pdo)) {
                    throw new Exception('只读账号无法修改账户关联');
                }
                $input = json_decode(file_get_contents('php://input'), true) ?: [];
                $account_id_1 = isset($input['account_id_1']) ? (int)$input['account_id_1'] : 0;
                $account_id_2 = isset($input['account_id_2']) ? (int)$input['account_id_2'] : 0;
                $linkCtx = accountLinkResolveContext($pdo, array_merge($_GET, $input));
                $part = accountLinkAssertCtx($pdo, $linkCtx);
                $link_type = isset($input['link_type']) ? $input['link_type'] : 'bidirectional';
                $source_account_id = isset($input['source_account_id']) ? (int) $input['source_account_id'] : null;
                if (!$account_id_1 || !$account_id_2) {
                    throw new Exception('缺少必要参数');
                }
                if ($account_id_1 === $account_id_2) {
                    throw new Exception('不能关联同一个账户');
                }
                if (!in_array($link_type, ['bidirectional', 'unidirectional'], true)) {
                    $link_type = 'bidirectional';
                }
                if ($link_type === 'unidirectional' && !$source_account_id) {
                    throw new Exception('单向连接必须指定发起账户');
                }
                if ($account_id_1 > $account_id_2) {
                    [$account_id_1, $account_id_2] = [$account_id_2, $account_id_1];
                }
                if (!linkAccountBelongsToContext($pdo, $account_id_1, $linkCtx)) {
                    throw new Exception('账户1不属于当前范围');
                }
                if (!linkAccountBelongsToContext($pdo, $account_id_2, $linkCtx)) {
                    throw new Exception('账户2不属于当前范围');
                }
                linkAccountsUpsert($pdo, $account_id_1, $account_id_2, $part, $link_type, $source_account_id);
                require_once __DIR__ . '/../includes/realtime.php';
                if (($part['company_id'] ?? null) !== null && (int) $part['company_id'] > 0) {
                    realtime_publish_companies([(int) $part['company_id']], 'accounts', 'link');
                }
                echo json_encode(['success' => true, 'message' => '账户关联成功', 'data' => null]);
                break;

            case 'unlink_accounts':
                if (is_partnership_audit_read_only_active($pdo)) {
                    throw new Exception('只读账号无法修改账户关联');
                }
                $input = json_decode(file_get_contents('php://input'), true) ?: [];
                $account_id_1 = isset($input['account_id_1']) ? (int)$input['account_id_1'] : 0;
                $account_id_2 = isset($input['account_id_2']) ? (int)$input['account_id_2'] : 0;
                $linkCtx = accountLinkResolveContext($pdo, array_merge($_GET, $input));
                $part = accountLinkAssertCtx($pdo, $linkCtx);
                if (!$account_id_1 || !$account_id_2) {
                    throw new Exception('缺少必要参数');
                }
                if ($account_id_1 > $account_id_2) {
                    [$account_id_1, $account_id_2] = [$account_id_2, $account_id_1];
                }
                if (
                    !linkAccountBelongsToContext($pdo, $account_id_1, $linkCtx)
                    || !linkAccountBelongsToContext($pdo, $account_id_2, $linkCtx)
                ) {
                    throw new Exception('账户不属于当前范围');
                }
                unlinkAccounts($pdo, $account_id_1, $account_id_2, $part);
                require_once __DIR__ . '/../includes/realtime.php';
                if (($part['company_id'] ?? null) !== null && (int) $part['company_id'] > 0) {
                    realtime_publish_companies([(int) $part['company_id']], 'accounts', 'unlink');
                }
                echo json_encode(['success' => true, 'message' => '账户关联已移除', 'data' => null]);
                break;

            case 'get_all_linked_accounts':
                $account_id = isset($_GET['account_id']) ? (int) $_GET['account_id'] : 0;
                $linkCtx = accountLinkResolveContext($pdo, $_GET);
                $part = accountLinkAssertCtx($pdo, $linkCtx);
                if ($account_id <= 0) {
                    throw new Exception('缺少必要参数');
                }
                if (!linkAccountBelongsToContext($pdo, $account_id, $linkCtx)) {
                    throw new Exception('账户不属于当前范围');
                }
                $linked_accounts = getLinkedAccountsForMember($pdo, $account_id, $part, $linkCtx);
                $account_ids = array_column($linked_accounts, 'id');
                if (!in_array($account_id, $account_ids)) {
                    $current_account = getAccountById($pdo, $account_id);
                    if ($current_account) {
                        array_unshift($linked_accounts, $current_account);
                    }
                } else {
                    $current_index = array_search($account_id, $account_ids);
                    if ($current_index !== false) {
                        $current_account = $linked_accounts[$current_index];
                        unset($linked_accounts[$current_index]);
                        array_unshift($linked_accounts, $current_account);
                        $linked_accounts = array_values($linked_accounts);
                    }
                }
                echo json_encode(['success' => true, 'message' => '', 'data' => $linked_accounts]);
                break;

            case 'update_link_type':
                if (is_partnership_audit_read_only_active($pdo)) {
                    throw new Exception('只读账号无法修改账户关联');
                }
                $input = json_decode(file_get_contents('php://input'), true) ?: [];
                $account_id_1 = isset($input['account_id_1']) ? (int)$input['account_id_1'] : 0;
                $account_id_2 = isset($input['account_id_2']) ? (int)$input['account_id_2'] : 0;
                $linkCtx = accountLinkResolveContext($pdo, array_merge($_GET, $input));
                $part = accountLinkAssertCtx($pdo, $linkCtx);
                $link_type = isset($input['link_type']) ? $input['link_type'] : 'bidirectional';
                $source_account_id = isset($input['source_account_id']) ? (int) $input['source_account_id'] : null;
                if (!$account_id_1 || !$account_id_2) {
                    throw new Exception('缺少必要参数');
                }
                if (!in_array($link_type, ['bidirectional', 'unidirectional'], true)) {
                    $link_type = 'bidirectional';
                }
                if ($account_id_1 > $account_id_2) {
                    [$account_id_1, $account_id_2] = [$account_id_2, $account_id_1];
                }
                if (
                    !linkAccountBelongsToContext($pdo, $account_id_1, $linkCtx)
                    || !linkAccountBelongsToContext($pdo, $account_id_2, $linkCtx)
                ) {
                    throw new Exception('账户不属于当前范围');
                }
                updateLinkType($pdo, $account_id_1, $account_id_2, $part, $link_type, $source_account_id);
                require_once __DIR__ . '/../includes/realtime.php';
                if (($part['company_id'] ?? null) !== null && (int) $part['company_id'] > 0) {
                    realtime_publish_companies([(int) $part['company_id']], 'accounts', 'update_link_type');
                }
                echo json_encode(['success' => true, 'message' => '连接类型更新成功', 'data' => null]);
                break;

            default:
                throw new Exception('无效的操作');
        }
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => '数据库错误: ' . $e->getMessage(), 'data' => null]);
    } catch (Exception $e) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => $e->getMessage(), 'data' => null]);
    }
}

// ---------- 数据库与业务辅助函数 ----------

function linkAccountBelongsToContext(PDO $pdo, int $account_id, array $ctx): bool
{
    return tenant_account_belongs_to_context($pdo, $account_id, $ctx);
}

function filterLinkAccountRowsInContext(PDO $pdo, array $rows, array $ctx): array
{
    return array_values(array_filter($rows, static function ($row) use ($pdo, $ctx) {
        return linkAccountBelongsToContext($pdo, (int) ($row['id'] ?? 0), $ctx);
    }));
}

function linkAccountsUpsert(PDO $pdo, int $account_id_1, int $account_id_2, array $part, string $link_type, ?int $source_account_id): void {
    $w = accountLinkWhereSql($part);
    $stmt = $pdo->prepare("SELECT id FROM account_link WHERE account_id_1 = ? AND account_id_2 = ? AND {$w['sql']}");
    $stmt->execute(array_merge([$account_id_1, $account_id_2], $w['params']));
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);
    $source = $link_type === 'unidirectional' ? $source_account_id : null;
    if ($existing) {
        $updateStmt = $pdo->prepare("UPDATE account_link SET link_type = ?, source_account_id = ? WHERE id = ?");
        $updateStmt->execute([$link_type, $source, $existing['id']]);
        return;
    }
    if (!empty($part['use_scope'])) {
        $stmt = $pdo->prepare("
            INSERT INTO account_link (account_id_1, account_id_2, company_id, scope_type, scope_id, link_type, source_account_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            $account_id_1,
            $account_id_2,
            $part['company_id'],
            $part['scope_type'],
            $part['scope_id'],
            $link_type,
            $source,
        ]);
        return;
    }
    $stmt = $pdo->prepare("INSERT INTO account_link (account_id_1, account_id_2, company_id, link_type, source_account_id) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$account_id_1, $account_id_2, $part['company_id'], $link_type, $source]);
}

function unlinkAccounts(PDO $pdo, int $account_id_1, int $account_id_2, array $part): void {
    $w = accountLinkWhereSql($part);
    $stmt = $pdo->prepare("SELECT id FROM account_link WHERE account_id_1 = ? AND account_id_2 = ? AND {$w['sql']} LIMIT 1");
    $stmt->execute(array_merge([$account_id_1, $account_id_2], $w['params']));
    $linkRow = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($linkRow && isset($linkRow['id'])) {
        deletedLog(
            $pdo,
            '',
            '/api/accounts/account_link_api.php',
            'account_link',
            (string) $linkRow['id'],
            'DELETE',
            null,
            $part['company_id'] !== null ? (string) $part['company_id'] : ''
        );
    }
    $stmt = $pdo->prepare("DELETE FROM account_link WHERE account_id_1 = ? AND account_id_2 = ? AND {$w['sql']}");
    $stmt->execute(array_merge([$account_id_1, $account_id_2], $w['params']));
}

function updateLinkType(PDO $pdo, int $account_id_1, int $account_id_2, array $part, string $link_type, ?int $source_account_id): void {
    $w = accountLinkWhereSql($part);
    $stmt = $pdo->prepare("
        UPDATE account_link
        SET link_type = ?, source_account_id = ?
        WHERE account_id_1 = ? AND account_id_2 = ? AND {$w['sql']}
    ");
    $stmt->execute(array_merge(
        [$link_type, $link_type === 'unidirectional' ? $source_account_id : null, $account_id_1, $account_id_2],
        $w['params']
    ));
}

function getAccountById(PDO $pdo, int $id): ?array {
    $stmt = $pdo->prepare("SELECT id, account_id, name FROM account WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function getLinkTypeInfo($pdo, $account_id, array $part) {
    $check_column_stmt = $pdo->query("SHOW COLUMNS FROM account_link LIKE 'link_type'");
    $has_link_type = $check_column_stmt->rowCount() > 0;
    if (!$has_link_type) {
        return ['link_type' => 'bidirectional', 'has_unidirectional' => false];
    }
    $w = accountLinkWhereSql($part);
    $stmt = $pdo->prepare("SELECT link_type, source_account_id FROM account_link WHERE (account_id_1 = ? OR account_id_2 = ?) AND {$w['sql']}");
    $stmt->execute(array_merge([$account_id, $account_id], $w['params']));
    $links = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (empty($links)) {
        return ['link_type' => 'bidirectional', 'has_unidirectional' => false];
    }
    $has_bidirectional = false;
    $has_unidirectional_as_source = false;
    $has_unidirectional_as_target = false;
    foreach ($links as $link) {
        if ($link['link_type'] === 'bidirectional') {
            $has_bidirectional = true;
        } elseif ($link['link_type'] === 'unidirectional') {
            if (isset($link['source_account_id']) && (int)$link['source_account_id'] == $account_id) {
                $has_unidirectional_as_source = true;
            } else {
                $has_unidirectional_as_target = true;
            }
        }
    }
    if ($has_bidirectional) {
        return ['link_type' => 'bidirectional', 'has_unidirectional' => $has_unidirectional_as_source || $has_unidirectional_as_target];
    }
    if ($has_unidirectional_as_source) {
        return ['link_type' => 'unidirectional', 'has_unidirectional' => true];
    }
    return ['link_type' => 'bidirectional', 'has_unidirectional' => false];
}

function getAllLinkedAccountsForDisplayWithType($pdo, $account_id, array $part, array $ctx = []) {
    $linked_data = [];
    $link_types_map = [];
    $check_column_stmt = $pdo->query("SHOW COLUMNS FROM account_link LIKE 'link_type'");
    $has_link_type = $check_column_stmt->rowCount() > 0;
    $w = accountLinkWhereSql($part);
    if ($has_link_type) {
        $stmt = $pdo->prepare("
            SELECT account_id_2 AS linked_id, link_type, source_account_id
            FROM account_link WHERE account_id_1 = ? AND {$w['sql']}
            AND (link_type = 'bidirectional' OR (link_type = 'unidirectional' AND source_account_id = ?))
            UNION
            SELECT account_id_1 AS linked_id, link_type, source_account_id
            FROM account_link WHERE account_id_2 = ? AND {$w['sql']}
            AND (link_type = 'bidirectional' OR (link_type = 'unidirectional' AND source_account_id = ?))
        ");
        $stmt->execute(array_merge(
            [$account_id],
            $w['params'],
            [$account_id, $account_id],
            $w['params'],
            [$account_id]
        ));
        $linked_data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($linked_data as $row) {
            $linked_id = $row['linked_id'];
            if ($linked_id != $account_id) {
                $link_types_map[$linked_id] = $row['link_type'];
            }
        }
    } else {
        $stmt = $pdo->prepare("
            SELECT account_id_2 AS linked_id FROM account_link WHERE account_id_1 = ? AND {$w['sql']}
            UNION
            SELECT account_id_1 AS linked_id FROM account_link WHERE account_id_2 = ? AND {$w['sql']}
        ");
        $stmt->execute(array_merge([$account_id], $w['params'], [$account_id], $w['params']));
        $linked_ids = $stmt->fetchAll(PDO::FETCH_COLUMN);
        foreach ($linked_ids as $linked_id) {
            if ($linked_id != $account_id) {
                $link_types_map[$linked_id] = 'bidirectional';
            }
        }
    }
    $linked_ids = array_keys($link_types_map);
    $result = [];
    if (!empty($linked_ids)) {
        $placeholders = str_repeat('?,', count($linked_ids) - 1) . '?';
        $stmt = $pdo->prepare("SELECT id, account_id, name FROM account WHERE id IN ($placeholders) ORDER BY account_id ASC");
        $stmt->execute(array_values($linked_ids));
        $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if ($ctx !== []) {
            $filtered = filterLinkAccountRowsInContext($pdo, $result, $ctx);
            $allowedIds = array_fill_keys(array_map(static fn ($r) => (int) $r['id'], $filtered), true);
            $link_types_map = array_intersect_key($link_types_map, $allowedIds);
            $result = $filtered;
        }
    }
    return ['accounts' => $result, 'link_types_map' => $link_types_map];
}

function getAllLinkedAccountsForDisplay($pdo, $account_id, array $part, array $ctx = []) {
    $result = getAllLinkedAccountsForDisplayWithType($pdo, $account_id, $part, $ctx);
    return $result['accounts'];
}

function getLinkedAccounts($pdo, $account_id, array $part) {
    $visited = [];
    $result = [];
    $queue = [$account_id];
    $w = accountLinkWhereSql($part);
    while (!empty($queue)) {
        $current_id = array_shift($queue);
        if (isset($visited[$current_id])) {
            continue;
        }
        $visited[$current_id] = true;
        $stmt = $pdo->prepare("
            SELECT account_id_2 AS linked_id, link_type, source_account_id
            FROM account_link WHERE account_id_1 = ? AND {$w['sql']}
            AND (link_type = 'bidirectional' OR (link_type = 'unidirectional' AND (source_account_id = ? OR source_account_id = account_id_2)))
            UNION
            SELECT account_id_1 AS linked_id, link_type, source_account_id
            FROM account_link WHERE account_id_2 = ? AND {$w['sql']}
            AND (link_type = 'bidirectional' OR (link_type = 'unidirectional' AND (source_account_id = ? OR source_account_id = account_id_1)))
        ");
        $stmt->execute(array_merge(
            [$current_id],
            $w['params'],
            [$current_id, $current_id],
            $w['params'],
            [$current_id]
        ));
        $linked_data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($linked_data as $row) {
            $linked_id = $row['linked_id'];
            if (!isset($visited[$linked_id])) {
                $visited[$linked_id] = true;
                if ($row['link_type'] === 'bidirectional') {
                    $queue[] = $linked_id;
                }
            }
        }
    }
    $linked_ids = array_filter(array_keys($visited), function ($id) use ($account_id) {
        return $id != $account_id;
    });
    if (!empty($linked_ids)) {
        $placeholders = str_repeat('?,', count($linked_ids) - 1) . '?';
        $stmt = $pdo->prepare("SELECT id, account_id, name FROM account WHERE id IN ($placeholders) ORDER BY account_id ASC");
        $stmt->execute(array_values($linked_ids));
        $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
    return $result;
}

function getLinkedAccountsForMember($pdo, $account_id, array $part, array $ctx = []) {
    $account_id = (int) $account_id;
    $visited = [];
    $result = [];
    $queue = [$account_id];
    $w = accountLinkWhereSql($part);
    while (!empty($queue)) {
        $current_id = (int) array_shift($queue);
        if (isset($visited[$current_id])) {
            continue;
        }
        $visited[$current_id] = true;
        $stmt = $pdo->prepare("
            SELECT account_id_2 AS linked_id, link_type, source_account_id
            FROM account_link WHERE account_id_1 = ? AND {$w['sql']}
            AND (link_type = 'bidirectional' OR (link_type = 'unidirectional' AND source_account_id = ?))
            UNION
            SELECT account_id_1 AS linked_id, link_type, source_account_id
            FROM account_link WHERE account_id_2 = ? AND {$w['sql']}
            AND (link_type = 'bidirectional' OR (link_type = 'unidirectional' AND source_account_id = ?))
        ");
        $stmt->execute(array_merge(
            [$current_id],
            $w['params'],
            [$current_id, $current_id],
            $w['params'],
            [$current_id]
        ));
        $linked_data = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($linked_data as $row) {
            $linked_id = (int) $row['linked_id'];
            if (!isset($visited[$linked_id])) {
                $visited[$linked_id] = true;
                if ($row['link_type'] === 'bidirectional') {
                    $queue[] = $linked_id;
                }
            }
        }
    }
    $linked_ids = array_filter(array_keys($visited), function ($id) use ($account_id) {
        return (int) $id !== $account_id;
    });
    if (!empty($linked_ids)) {
        $placeholders = str_repeat('?,', count($linked_ids) - 1) . '?';
        $stmt = $pdo->prepare("SELECT id, account_id, name FROM account WHERE id IN ($placeholders) ORDER BY account_id ASC");
        $stmt->execute(array_values($linked_ids));
        $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if ($ctx !== []) {
            $result = filterLinkAccountRowsInContext($pdo, $result, $ctx);
        }
    }
    return $result;
}