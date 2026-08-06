<?php
/**
 * Group Earnings API — List groups for the current session.
 * Seeds from `groups` table (empty Group OK) + subsidiaries with group_id.
 * Group login: only accessible groups (login_scope fence).
 */
require_once '../../includes/session_check.php';
require_once '../../includes/config.php';
require_once '../../includes/group_company_access.php';
require_once '../includes/money_decimal.php';
require_once '../includes/ownership_history.php';
require_once '../includes/ownership_schema.php';

header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
    exit();
}

$current_user_role = $_SESSION['role'] ?? '';
$parsedMonth = ownership_history_parse_month_param($_GET['month'] ?? null);
$useHistory = $parsedMonth !== null && ownership_history_is_past_month($parsedMonth['month_key']);

/**
 * Ensure a group bucket exists.
 *
 * @param array<string, array{group_id:string, companies:list}> $groups
 */
function ownership_ge_ensure_group(array &$groups, string $gid): void
{
    $gid = strtoupper(trim($gid));
    if ($gid === '') {
        return;
    }
    if (!isset($groups[$gid])) {
        $groups[$gid] = [
            'group_id'  => $gid,
            'companies' => [],
        ];
    }
}

try {
    ownership_ensure_group_ownership_table($pdo);

    require_once '../get_companies_helper.php';
    $companies = [];
    $groups = [];

    $owner_id = 0;
    if (strtolower($current_user_role) === 'owner') {
        $owner_id = (int) ($_SESSION['real_owner_id'] ?? $_SESSION['owner_id'] ?? $_SESSION['user_id']);
        $fetched = getCompaniesByOwner($pdo, $owner_id, true);
    } else {
        $fetched = getCompaniesByUser($pdo, (int) $_SESSION['user_id'], true);
    }

    foreach ($fetched as $c) {
        $code = strtoupper(trim((string) ($c['company_id'] ?? '')));
        if ($code === '') {
            continue;
        }
        $nativeGid = strtoupper(trim((string) ($c['native_group_id'] ?? $c['group_id'] ?? '')));
        if ($nativeGid === '') {
            continue;
        }
        // Skip legacy group-entity rows (company_id === group_id).
        if (gc_company_row_is_group_entity($code, $nativeGid)) {
            ownership_ge_ensure_group($groups, $nativeGid);
            continue;
        }
        $companies[] = [
            'id'       => (int) $c['id'],
            'name'     => $code,
            'group_id' => $nativeGid,
        ];
        ownership_ge_ensure_group($groups, $nativeGid);
        $groups[$nativeGid]['companies'][] = [
            'id'   => (int) $c['id'],
            'name' => $code,
        ];
    }

    // Seed empty / first-class groups from `groups` table (no stub company required).
    if ($owner_id > 0 && $pdo->query("SHOW TABLES LIKE 'groups'")->rowCount() > 0) {
        $gStmt = $pdo->prepare(
            'SELECT UPPER(TRIM(group_code)) AS group_code FROM `groups` WHERE owner_id = ?'
        );
        $gStmt->execute([$owner_id]);
        foreach ($gStmt->fetchAll(PDO::FETCH_COLUMN) as $code) {
            ownership_ge_ensure_group($groups, (string) $code);
        }
    }

    // Non-owner: groups assigned via user_group_map.
    if (strtolower($current_user_role) !== 'owner'
        && $pdo->query("SHOW TABLES LIKE 'user_group_map'")->rowCount() > 0
        && $pdo->query("SHOW TABLES LIKE 'groups'")->rowCount() > 0
    ) {
        $ugm = $pdo->prepare("
            SELECT UPPER(TRIM(g.group_code)) AS group_code
            FROM user_group_map ugm
            INNER JOIN `groups` g ON g.id = ugm.group_id
            WHERE ugm.user_id = ?
        ");
        $ugm->execute([(int) $_SESSION['user_id']]);
        foreach ($ugm->fetchAll(PDO::FETCH_COLUMN) as $code) {
            ownership_ge_ensure_group($groups, (string) $code);
        }
    }

    // Group login: only groups the session may access.
    if (gc_is_group_login()) {
        foreach (array_keys($groups) as $gid) {
            if (!gc_session_can_access_group_ledger($pdo, (string) $gid)) {
                unset($groups[$gid]);
            }
        }
    }

    // Get per-company group equity from company_ownership (owner_type='group')
    $companyGroupEquity = [];
    $allCompanyIds = array_map(static fn($c) => $c['id'], $companies);
    if (!empty($allCompanyIds)) {
        $in = str_repeat('?,', count($allCompanyIds) - 1) . '?';
        $stmt = $pdo->prepare("
            SELECT company_id, partner_group_id, percentage
            FROM company_ownership
            WHERE company_id IN ($in) AND owner_type = 'group'
        ");
        $stmt->execute($allCompanyIds);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $companyGroupEquity[$row['company_id'] . '_' . $row['partner_group_id']] = money_out($row['percentage'], 2);
        }
    }

    $groupIds = array_keys($groups);
    $totals = [];
    if (!empty($groupIds)) {
        $in = str_repeat('?,', count($groupIds) - 1) . '?';
        if ($useHistory) {
            ownership_history_ensure_tables($pdo);
            $stmt = $pdo->prepare("
                SELECT group_id, SUM(percentage) as total_percent
                FROM group_ownership_history
                WHERE group_id IN ($in) AND effective_month = ?
                GROUP BY group_id
            ");
            $stmt->execute(array_merge($groupIds, [$parsedMonth['effective_month']]));
        } else {
            $stmt = $pdo->prepare("
                SELECT group_id, SUM(percentage) as total_percent
                FROM group_ownership
                WHERE group_id IN ($in)
                GROUP BY group_id
            ");
            $stmt->execute($groupIds);
        }
        $totals = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    }

    $result = [];
    foreach ($groups as $gid => $grp) {
        $alloc = isset($totals[$gid]) ? money_out($totals[$gid], 2) : '0';
        $companiesWithEquity = [];
        foreach ($grp['companies'] as $comp) {
            $key = $comp['id'] . '_' . $gid;
            $comp['group_equity'] = $companyGroupEquity[$key] ?? '0';
            $companiesWithEquity[] = $comp;
        }
        $result[] = [
            'group_id'             => $gid,
            'companies'            => $companiesWithEquity,
            'company_count'        => count($grp['companies']),
            'allocated_percentage' => $alloc,
        ];
    }

    usort($result, static function ($a, $b) {
        return strcmp($a['group_id'], $b['group_id']);
    });

    echo json_encode([
        'status' => 'success',
        'data'   => $result,
        'meta'   => [
            'is_historical'   => $useHistory,
            'effective_month' => $useHistory ? $parsedMonth['month_key'] : ownership_history_current_month_key(),
        ],
    ]);
} catch (PDOException $e) {
    echo json_encode([
        'status'  => 'error',
        'message' => 'Database error: ' . $e->getMessage(),
    ]);
}
