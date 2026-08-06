<?php
/**
 * Group Earnings API — Get available accounts for a group
 * GET ?group_id=IG
 *
 * Returns owners/users from subsidiaries + pure Group sources
 * (`groups.owner_id`, `user_group_map`) so empty Group still has a dropdown.
 */
require_once '../../includes/session_check.php';
require_once '../../includes/config.php';
require_once '../../includes/group_company_access.php';
require_once '../includes/ownership_history.php';

header('Content-Type: application/json');

if (!isset($_SESSION['user_id'])) {
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
    exit();
}

$group_id = $_GET['group_id'] ?? null;

if (!$group_id) {
    echo json_encode(['status' => 'error', 'message' => 'Missing group_id']);
    exit();
}

try {
    gc_assert_group_ledger_access($pdo, (string) $group_id);
} catch (Throwable $e) {
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
    exit();
}

try {
    // 1. Find all company IDs that belong to this group (exclude legacy group-entity rows)
    $stmtCompanies = $pdo->prepare("
        SELECT id, company_id, group_id FROM company
        WHERE UPPER(TRIM(group_id)) = UPPER(TRIM(?)) AND TRIM(company_id) <> ''
    ");
    $stmtCompanies->execute([$group_id]);
    $companyIds = [];
    foreach ($stmtCompanies->fetchAll(PDO::FETCH_ASSOC) as $row) {
        if (gc_company_row_is_group_entity($row['company_id'] ?? '', $row['group_id'] ?? '')) {
            continue;
        }
        $companyIds[] = (int) $row['id'];
    }

    $accountMap = []; // keyed by composite id to deduplicate

    // 1b. Pure Group owner from `groups` table (empty Group / first-class tenant)
    if ($pdo->query("SHOW TABLES LIKE 'groups'")->rowCount() > 0) {
        $gOwnerStmt = $pdo->prepare("
            SELECT CONCAT('O_', o.id) as id,
                   o.owner_code as account_name,
                   o.name,
                   'OWNER' as role,
                   'owner' as type,
                   1 as is_main_owner
            FROM `groups` g
            INNER JOIN owner o ON o.id = g.owner_id
            WHERE UPPER(TRIM(g.group_code)) = UPPER(TRIM(?))
              AND LOWER(o.status) = 'active'
            LIMIT 1
        ");
        $gOwnerStmt->execute([$group_id]);
        foreach ($gOwnerStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $accountMap[$row['id']] = $row;
        }
    }

    // 1c. Users bound via user_group_map (Admin / Partnership on pure Group)
    if ($pdo->query("SHOW TABLES LIKE 'user_group_map'")->rowCount() > 0
        && $pdo->query("SHOW TABLES LIKE 'groups'")->rowCount() > 0
    ) {
        $ugmUsers = $pdo->prepare("
            SELECT DISTINCT CONCAT('U_', u.id) as id,
                   u.login_id as account_name,
                   u.name,
                   UPPER(u.role) as role,
                   'user' as type,
                   0 as is_main_owner
            FROM user u
            INNER JOIN user_group_map ugm ON ugm.user_id = u.id
            INNER JOIN `groups` g ON g.id = ugm.group_id
            WHERE UPPER(TRIM(g.group_code)) = UPPER(TRIM(?))
              AND LOWER(u.status) = 'active'
        ");
        $ugmUsers->execute([$group_id]);
        foreach ($ugmUsers->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!isset($accountMap[$row['id']])) {
                $accountMap[$row['id']] = $row;
            }
        }
    }

    if (!empty($companyIds)) {
        $in = str_repeat('?,', count($companyIds) - 1) . '?';

        // 2. Get all owners from these companies (native owners)
        $stmtOwners = $pdo->prepare("
            SELECT DISTINCT CONCAT('O_', o.id) as id,
                   o.owner_code as account_name,
                   o.name,
                   'OWNER' as role,
                   'owner' as type,
                   CASE WHEN c.owner_id = o.id THEN 1 ELSE 0 END as is_main_owner
            FROM owner o
            INNER JOIN company c ON c.owner_id = o.id
            WHERE c.id IN ($in) AND LOWER(o.status) = 'active'
        ");
        $stmtOwners->execute($companyIds);
        foreach ($stmtOwners->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $accountMap[$row['id']] = $row;
        }

        // 3. Get owners linked via company_ownership (external partners in these companies)
        $stmtLinked = $pdo->prepare("
            SELECT DISTINCT CONCAT('O_', o.id) as id,
                   COALESCE(co.partner_group_id, o.owner_code) as account_name,
                   o.name,
                   'OWNER' as role,
                   'owner' as type,
                   0 as is_main_owner
            FROM company_ownership co
            INNER JOIN owner o ON co.account_id = o.id AND co.owner_type = 'owner'
            WHERE co.company_id IN ($in) AND LOWER(o.status) = 'active'
        ");
        $stmtLinked->execute($companyIds);
        foreach ($stmtLinked->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!isset($accountMap[$row['id']])) {
                $accountMap[$row['id']] = $row;
            }
        }

        // 4. Get partnership users mapped to these companies
        $stmtUsers = $pdo->prepare("
            SELECT DISTINCT CONCAT('U_', u.id) as id,
                   u.login_id as account_name,
                   u.name,
                   'PARTNERSHIP' as role,
                   'user' as type,
                   0 as is_main_owner
            FROM user u
            INNER JOIN user_company_map ucm ON u.id = ucm.user_id
            WHERE ucm.company_id IN ($in) 
              AND LOWER(u.role) = 'partnership' 
              AND LOWER(u.status) = 'active'
        ");
        $stmtUsers->execute($companyIds);
        foreach ($stmtUsers->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!isset($accountMap[$row['id']])) {
                $accountMap[$row['id']] = $row;
            }
        }
    }

    // 5. Get external partners linked via group_ownership for this group
    //    (partners linked by Group ID — their companies are NOT in the current group,
    //     so they won't appear in steps 2-4. We must add them explicitly.)
    $hasGroupOwnership = $pdo->query("SHOW TABLES LIKE 'group_ownership'")->rowCount() > 0;
    if ($hasGroupOwnership) {
        $stmtExt = $pdo->prepare("
            SELECT DISTINCT CONCAT('O_', o.id) as id,
                   COALESCE(NULLIF(TRIM(go.partner_group_id), ''), o.owner_code) as account_name,
                   o.name,
                   'OWNER' as role,
                   'owner' as type,
                   0 as is_main_owner
            FROM group_ownership go
            INNER JOIN owner o ON go.account_id = o.id AND go.owner_type = 'owner'
            WHERE go.group_id = ?
              AND LOWER(o.status) = 'active'
              AND go.account_id != go.owner_id
        ");
        $stmtExt->execute([$group_id]);
        foreach ($stmtExt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!isset($accountMap[$row['id']])) {
                $accountMap[$row['id']] = $row;
            }
        }
    }

    // 6. Self-group links: current owner's OTHER groups (for pooling e.g. AP into IG).
    //    Also include any group-type rows already persisted for this group so their
    //    dropdown option stays available even if the source group was since removed.
    $sessionRole = strtolower($_SESSION['role'] ?? '');
    if ($sessionRole === 'owner') {
        $currentOwnerId = (int) ($_SESSION['real_owner_id'] ?? $_SESSION['owner_id'] ?? $_SESSION['user_id']);
    } else {
        $currentOwnerId = ownership_history_resolve_group_owner_id($pdo, (string) $group_id);
        if ($currentOwnerId <= 0) {
            $stmtOwn = $pdo->prepare('SELECT DISTINCT owner_id FROM company WHERE UPPER(TRIM(group_id)) = UPPER(TRIM(?)) LIMIT 1');
            $stmtOwn->execute([$group_id]);
            $currentOwnerId = (int) $stmtOwn->fetchColumn();
        }
    }
    if ($currentOwnerId > 0) {
        // Prefer groups table for peer groups (empty Group peers included)
        $peerFromGroups = false;
        if ($pdo->query("SHOW TABLES LIKE 'groups'")->rowCount() > 0) {
            $stmtMyGroups = $pdo->prepare("
                SELECT DISTINCT UPPER(TRIM(group_code)) as gid
                FROM `groups`
                WHERE owner_id = ?
                  AND UPPER(TRIM(group_code)) <> UPPER(TRIM(?))
            ");
            $stmtMyGroups->execute([$currentOwnerId, $group_id]);
            $peerRows = $stmtMyGroups->fetchAll(PDO::FETCH_COLUMN);
            $peerFromGroups = true;
            foreach ($peerRows as $gid) {
                $key = 'G_' . $gid;
                if (!isset($accountMap[$key])) {
                    $accountMap[$key] = [
                        'id'            => $key,
                        'account_name'  => 'Group: ' . $gid,
                        'name'          => 'Group Equity',
                        'role'          => 'GROUP',
                        'type'          => 'group',
                        'is_main_owner' => 0,
                    ];
                }
            }
        }
        if (!$peerFromGroups) {
            $stmtMyGroups = $pdo->prepare("
                SELECT DISTINCT UPPER(TRIM(c.group_id)) as gid
                FROM company c
                WHERE c.owner_id = ?
                  AND c.group_id IS NOT NULL
                  AND TRIM(c.group_id) <> ''
                  AND UPPER(TRIM(c.group_id)) <> UPPER(TRIM(?))
            ");
            $stmtMyGroups->execute([$currentOwnerId, $group_id]);
            foreach ($stmtMyGroups->fetchAll(PDO::FETCH_COLUMN) as $gid) {
                $key = 'G_' . $gid;
                if (!isset($accountMap[$key])) {
                    $accountMap[$key] = [
                        'id'            => $key,
                        'account_name'  => 'Group: ' . $gid,
                        'name'          => 'Group Equity',
                        'role'          => 'GROUP',
                        'type'          => 'group',
                        'is_main_owner' => 0,
                    ];
                }
            }
        }
    }

    if ($hasGroupOwnership) {
        $stmtLinkedGroups = $pdo->prepare("
            SELECT DISTINCT UPPER(TRIM(partner_group_id)) as gid
            FROM group_ownership
            WHERE group_id = ?
              AND owner_type = 'group'
              AND partner_group_id IS NOT NULL
              AND TRIM(partner_group_id) <> ''
        ");
        $stmtLinkedGroups->execute([$group_id]);
        foreach ($stmtLinkedGroups->fetchAll(PDO::FETCH_COLUMN) as $gid) {
            $key = 'G_' . $gid;
            if (!isset($accountMap[$key])) {
                $accountMap[$key] = [
                    'id'            => $key,
                    'account_name'  => 'Group: ' . $gid,
                    'name'          => 'Group Equity',
                    'role'          => 'GROUP',
                    'type'          => 'group',
                    'is_main_owner' => 0,
                ];
            }
        }
    }

    // Sort by account_name
    $combined = array_values($accountMap);
    // External linked owners belong in Link Partner only, not "+ Add Account".
    $combined = array_values(array_filter($combined, static function ($row) {
        if (strtolower((string) ($row['type'] ?? '')) !== 'owner') {
            return true;
        }
        return (int) ($row['is_main_owner'] ?? 0) === 1;
    }));
    usort($combined, function ($a, $b) {
        return strcmp($a['account_name'], $b['account_name']);
    });

    echo json_encode([
        'status' => 'success',
        'data'   => $combined
    ]);

} catch (PDOException $e) {
    echo json_encode([
        'status'  => 'error',
        'message' => 'Database error: ' . $e->getMessage()
    ]);
}
?>
