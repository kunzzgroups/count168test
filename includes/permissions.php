<?php
// permissions.php

/**
 * Extract account ids from account_permissions JSON rows.
 * Rows with self_hidden=true stay in the grant list but are excluded from visibility by default.
 *
 * @param mixed $userAccountPermissions
 * @return int[]
 */
function permissions_extract_account_ids($userAccountPermissions, bool $includeSelfHidden = false): array
{
    if (!is_array($userAccountPermissions) || $userAccountPermissions === []) {
        return [];
    }
    $ids = [];
    foreach ($userAccountPermissions as $row) {
        if (is_array($row)) {
            if (!$includeSelfHidden && !empty($row['self_hidden'])) {
                continue;
            }
            $id = (int) ($row['id'] ?? 0);
        } else {
            $id = (int) $row;
        }
        if ($id > 0) {
            $ids[] = $id;
        }
    }
    return array_values(array_unique($ids));
}

/**
 * Group-entity company PK for a subsidiary (or 0). Used when Acc/Process grants were saved
 * on the group User List scope but the viewer opens a subsidiary ledger.
 */
function permissions_group_entity_company_id_for_company(PDO $pdo, int $companyId): int
{
    if ($companyId <= 0) {
        return 0;
    }
    if (!function_exists('gc_resolve_legacy_group_entity_company_id')) {
        $path = __DIR__ . '/group_scope_resolve.php';
        if (is_file($path)) {
            require_once $path;
        }
    }
    if (!function_exists('gc_resolve_legacy_group_entity_company_id')) {
        return 0;
    }
    try {
        $stmt = $pdo->prepare('SELECT UPPER(TRIM(COALESCE(group_id, \'\'))) AS gid FROM company WHERE id = ? LIMIT 1');
        $stmt->execute([$companyId]);
        $gid = strtoupper(trim((string) ($stmt->fetchColumn() ?: '')));
        if ($gid === '') {
            return 0;
        }
        $entityId = (int) gc_resolve_legacy_group_entity_company_id($pdo, $gid);
        if ($entityId <= 0 && function_exists('gc_resolve_group_anchor_company_id')) {
            $entityId = (int) gc_resolve_group_anchor_company_id($pdo, $gid);
        }
        return ($entityId > 0 && $entityId !== $companyId) ? $entityId : 0;
    } catch (Throwable $e) {
        return 0;
    }
}

/**
 * Load account_permissions JSON for user+company.
 * null = unset (see all). If this company has no explicit row/null, fall back to group-entity grants.
 *
 * @return mixed null|array decoded whitelist (may be [])
 */
function permissions_load_account_permissions_decoded(PDO $pdo, int $userId, int $companyId)
{
    if ($userId <= 0 || $companyId <= 0) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT account_permissions FROM user_company_permissions WHERE user_id = ? AND company_id = ?');
    $stmt->execute([$userId, $companyId]);
    $permission = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($permission && array_key_exists('account_permissions', $permission) && $permission['account_permissions'] !== null) {
        $decoded = json_decode((string) $permission['account_permissions'], true);
        return is_array($decoded) ? $decoded : [];
    }
    $entityId = permissions_group_entity_company_id_for_company($pdo, $companyId);
    if ($entityId <= 0) {
        return null;
    }
    $stmt->execute([$userId, $entityId]);
    $permission = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($permission && array_key_exists('account_permissions', $permission) && $permission['account_permissions'] !== null) {
        $decoded = json_decode((string) $permission['account_permissions'], true);
        return is_array($decoded) ? $decoded : [];
    }
    return null;
}

/**
 * @return mixed null|array
 */
function permissions_load_process_permissions_decoded(PDO $pdo, int $userId, int $companyId)
{
    if ($userId <= 0 || $companyId <= 0) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT process_permissions FROM user_company_permissions WHERE user_id = ? AND company_id = ?');
    $stmt->execute([$userId, $companyId]);
    $permission = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($permission && array_key_exists('process_permissions', $permission) && $permission['process_permissions'] !== null) {
        $decoded = json_decode((string) $permission['process_permissions'], true);
        return is_array($decoded) ? $decoded : [];
    }
    $entityId = permissions_group_entity_company_id_for_company($pdo, $companyId);
    if ($entityId <= 0) {
        return null;
    }
    $stmt->execute([$userId, $entityId]);
    $permission = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($permission && array_key_exists('process_permissions', $permission) && $permission['process_permissions'] !== null) {
        $decoded = json_decode((string) $permission['process_permissions'], true);
        return is_array($decoded) ? $decoded : [];
    }
    return null;
}

function getCurrentUserAccountPermissions($pdo) {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    // 获取当前用户ID和公司ID
    $currentUserId = $_SESSION['user_id'] ?? $_SESSION['login_id'] ?? null;
    $companyId = $_SESSION['company_id'] ?? null;

    if (!$currentUserId || !$companyId) {
        return [];
    }

    // 如果存储的是 login_id，需要先获取 user id
    if (is_string($currentUserId)) {
        $stmt = $pdo->prepare("SELECT id FROM user WHERE login_id = ?");
        $stmt->execute([$currentUserId]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user) {
            return [];
        }
        $currentUserId = $user['id'];
    }

    // 从 user_company_permissions 表获取当前公司下的账户权限
    $stmt = $pdo->prepare("SELECT account_permissions FROM user_company_permissions WHERE user_id = ? AND company_id = ?");
    $stmt->execute([$currentUserId, $companyId]);
    $permission = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($permission && $permission['account_permissions'] !== null) {
        $permissions = json_decode($permission['account_permissions'], true);
        return is_array($permissions) ? $permissions : [];
    }

    // 如果 user_company_permissions 表中没有记录，返回空数组（表示未设置权限，默认可以看到所有账户）
    return [];
}

/**
 * Roles that bypass user_company_permissions.account_permissions whitelist (full ledger visibility).
 * Only owner / member bypass. Partnership / audit follow the same whitelist as other roles
 * (null = unset see-all; array = granted; superior revoke drops rows; self_hidden hides without revoke).
 */
function permissions_user_sees_all_accounts(?string $role = null, ?string $userType = null): bool
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    $role = strtolower(trim((string) ($role ?? $_SESSION['role'] ?? '')));
    $userType = strtolower(trim((string) ($userType ?? $_SESSION['user_type'] ?? '')));

    return $role === 'owner' || $userType === 'member';
}

/**
 * Process visibility follows the same policy as accounts (owner / member bypass only).
 */
function permissions_user_sees_all_processes(?string $role = null, ?string $userType = null): bool
{
    return permissions_user_sees_all_accounts($role, $userType);
}

/**
 * @param int|null $permissionCompanyId 查询「指定公司」账户时传入该公司主键，用于读取 user_company_permissions；
 *                                        为 null 时用 $_SESSION['company_id']（与旧行为一致）。
 */
function filterAccountsByPermissions($pdo, $baseQuery, $params = [], $permissionCompanyId = null) {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    if (permissions_user_sees_all_accounts()) {
        return [$baseQuery, $params];
    }

    // 获取当前用户ID和公司ID
    $currentUserId = $_SESSION['user_id'] ?? $_SESSION['login_id'] ?? null;
    $companyId = ($permissionCompanyId !== null && (int)$permissionCompanyId > 0)
        ? (int)$permissionCompanyId
        : (int)($_SESSION['company_id'] ?? 0);

    if (!$currentUserId || !$companyId) {
        // 如果没有用户ID或公司ID，不添加过滤条件，显示所有账户
        return [$baseQuery, $params];
    }

    // 如果存储的是 login_id，需要先获取 user id
    if (is_string($currentUserId)) {
        $stmt = $pdo->prepare("SELECT id FROM user WHERE login_id = ?");
        $stmt->execute([$currentUserId]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user) {
            return [$baseQuery, $params];
        }
        $currentUserId = $user['id'];
    }

    // Company row, else group-entity grants (Owner group User List saves there).
    $userAccountPermissions = permissions_load_account_permissions_decoded($pdo, (int) $currentUserId, (int) $companyId);

    // null = unset → see all
    if ($userAccountPermissions === null) {
        return [$baseQuery, $params];
    }

    // 空数组 []（已设置但清空）→ 看不到任何账户
    if ($userAccountPermissions === []) {
        $hasWhere = stripos($baseQuery, ' WHERE ') !== false;
        if ($hasWhere) {
            $baseQuery .= " AND 1=0";
        } else {
            $baseQuery .= " WHERE 1=0";
        }
        return [$baseQuery, $params];
    }

    // 可见 = 授权列表且未 self_hidden（自己关掉的仍留在授权里，可自行勾回）
    $accountIds = permissions_extract_account_ids($userAccountPermissions, false);

    // 只有当有有效的账户 ID 时，才添加过滤条件
    if (!empty($accountIds)) {
        $placeholders = str_repeat('?,', count($accountIds) - 1) . '?';
        $baseQuery .= " AND id IN ($placeholders)";
        $params = array_merge($params, $accountIds);
    } else {
        // 如果 accountIds 为空（虽然理论上不应该发生），不显示任何账户
        $hasWhere = stripos($baseQuery, ' WHERE ') !== false;
        if ($hasWhere) {
            $baseQuery .= " AND 1=0";
        } else {
            $baseQuery .= " WHERE 1=0";
        }
    }

    return [$baseQuery, $params];
}

function getCurrentUserProcessPermissions($pdo) {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    // 获取当前用户ID和公司ID
    $currentUserId = $_SESSION['user_id'] ?? $_SESSION['login_id'] ?? null;
    $companyId = $_SESSION['company_id'] ?? null;

    if (!$currentUserId || !$companyId) {
        return [];
    }

    // 如果存储的是 login_id，需要先获取 user id
    if (is_string($currentUserId)) {
        $stmt = $pdo->prepare("SELECT id FROM user WHERE login_id = ?");
        $stmt->execute([$currentUserId]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user) {
            return [];
        }
        $currentUserId = $user['id'];
    }

    // 从 user_company_permissions 表获取当前公司下的流程权限
    $stmt = $pdo->prepare("SELECT process_permissions FROM user_company_permissions WHERE user_id = ? AND company_id = ?");
    $stmt->execute([$currentUserId, $companyId]);
    $permission = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($permission && $permission['process_permissions'] !== null) {
        $permissions = json_decode($permission['process_permissions'], true);
        return is_array($permissions) ? $permissions : [];
    }

    // 如果 user_company_permissions 表中没有记录，返回空数组（表示未设置权限，默认可以看到所有流程）
    return [];
}

/**
 * @param int|null $permissionCompanyId Company for user_company_permissions lookup.
 *   When the list/query targets a company via ?company_id=, pass that id so permissions
 *   match the requested company — not a stale $_SESSION['company_id'] (e.g. Bank CX → Games 95).
 */
function filterProcessesByPermissions($pdo, $baseQuery, $params = [], $permissionCompanyId = null) {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }

    // 与 Account 权限过滤保持一致：仅 owner/member 直接看全量；partnership/audit 走白名单
    if (permissions_user_sees_all_processes()) {
        return [$baseQuery, $params];
    }

    // 获取当前用户ID和公司ID
    $currentUserId = $_SESSION['user_id'] ?? $_SESSION['login_id'] ?? null;
    $companyId = $permissionCompanyId !== null && $permissionCompanyId !== ''
        ? (int) $permissionCompanyId
        : ($_SESSION['company_id'] ?? null);
    if ($companyId !== null && $companyId <= 0) {
        $companyId = null;
    }

    if (!$currentUserId || !$companyId) {
        // 如果没有用户ID或公司ID，不添加过滤条件，显示所有流程
        return [$baseQuery, $params];
    }

    // 如果存储的是 login_id，需要先获取 user id
    if (is_string($currentUserId)) {
        $stmt = $pdo->prepare("SELECT id FROM user WHERE login_id = ?");
        $stmt->execute([$currentUserId]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$user) {
            return [$baseQuery, $params];
        }
        $currentUserId = $user['id'];
    }

    $userProcessPermissions = permissions_load_process_permissions_decoded($pdo, (int) $currentUserId, (int) $companyId);

    if ($userProcessPermissions === null) {
        return [$baseQuery, $params];
    }

    if ($userProcessPermissions === []) {
        $hasWhere = stripos($baseQuery, ' WHERE ') !== false;
        if ($hasWhere) {
            $baseQuery .= " AND 1=0";
        } else {
            $baseQuery .= " WHERE 1=0";
        }
        return [$baseQuery, $params];
    }

    // 可见 = 授权列表且未 self_hidden（自己关掉的仍留在授权里，可自行勾回）
    $processIds = permissions_extract_account_ids($userProcessPermissions, false);

    if (!empty($processIds)) {
        $placeholders = str_repeat('?,', count($processIds) - 1) . '?';

        // 检查是否已经有 WHERE 条件
        $hasWhere = stripos($baseQuery, ' WHERE ') !== false;

        if ($hasWhere) {
            // 如果已经有 WHERE 条件，添加 AND 条件
            $baseQuery .= " AND p.id IN ($placeholders)";
        } else {
            // 如果没有 WHERE 条件，添加 WHERE 条件
            $baseQuery .= " WHERE p.id IN ($placeholders)";
        }
        $params = array_merge($params, $processIds);
    } else {
        // 如果 processIds 为空（虽然理论上不应该发生），不显示任何流程
        $hasWhere = stripos($baseQuery, ' WHERE ') !== false;
        if ($hasWhere) {
            $baseQuery .= " AND 1=0";
        } else {
            $baseQuery .= " WHERE 1=0";
        }
    }

    return [$baseQuery, $params];
}

if (!function_exists('checkCompanyCategoryPermission')) {
    /**
     * Helper to verify if a company has access to a specific UI category (Data-Level Access Control).
     *
     * @param PDO $pdo
     * @param int|string $companyId
     * @param string $category (e.g., 'Games', 'Bank', 'Loan', 'Rate', 'Money')
     * @return bool
     */
    function checkCompanyCategoryPermission(PDO $pdo, $companyId, $category) {
        if (empty($companyId)) return false;
        try {
            $stmt = $pdo->prepare("SELECT permissions FROM company WHERE id = ?");
            // If companyId is string like 'C168', ensure we handle it, but table 'id' is int.
            // Assuming companyId here is the `id` column. If it's the string code, caller must provide `id`.
            $stmt->execute([$companyId]);
            $permsJson = $stmt->fetchColumn();
            
            if ($permsJson === false || $permsJson === null || $permsJson === '') {
                return false;
            }

            $perms = json_decode($permsJson, true);
            if (!is_array($perms)) return false;

            // Handle "Games" vs "Gambling" backward compatibility
            if ($category === 'Games' || $category === 'Gambling') {
                return in_array('Games', $perms) || in_array('Gambling', $perms);
            }

            return in_array($category, $perms);
        } catch (PDOException $e) {
            return false;
        }
    }
}

if (!function_exists('checkCompanyGamesOrBankCategoryPermission')) {
    /** Data Capture / maintenance process list: Games/Gambling or Bank (e.g. CX payroll channel). */
    function checkCompanyGamesOrBankCategoryPermission(PDO $pdo, $companyId): bool
    {
        return checkCompanyCategoryPermission($pdo, $companyId, 'Games')
            || checkCompanyCategoryPermission($pdo, $companyId, 'Bank');
    }
}

if (!function_exists('user_sidebar_permissions_list')) {
    /**
     * Sidebar permission keys from user.permissions JSON.
     * Empty/null = unrestricted (owner / legacy full access).
     *
     * @return array<int, string>|null null = unrestricted
     */
    function user_sidebar_permissions_list(PDO $pdo, ?int $userId = null): ?array
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }

        $role = strtolower((string) ($_SESSION['role'] ?? ''));
        if ($role === 'owner') {
            return null;
        }

        $userType = strtolower((string) ($_SESSION['user_type'] ?? ''));
        if ($userType === 'member') {
            return [];
        }

        $uid = $userId ?? (int) ($_SESSION['user_id'] ?? 0);
        if ($uid <= 0) {
            return [];
        }

        $stmt = $pdo->prepare('SELECT permissions FROM user WHERE id = ? LIMIT 1');
        $stmt->execute([$uid]);
        $raw = $stmt->fetchColumn();
        if ($raw === false || $raw === null || trim((string) $raw) === '') {
            return null;
        }

        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) {
            return null;
        }
        if (count($decoded) === 0) {
            return null;
        }

        return array_values(array_filter(array_map('strval', $decoded)));
    }
}

if (!function_exists('user_has_sidebar_permission')) {
    function user_has_sidebar_permission(PDO $pdo, string $key, ?int $userId = null): bool
    {
        if ($key === 'ownership') {
            if (session_status() === PHP_SESSION_NONE) {
                session_start();
            }
            if (!role_supports_ownership_permission($_SESSION['role'] ?? '')) {
                return false;
            }
        }

        $perms = user_sidebar_permissions_list($pdo, $userId);
        if ($perms === null) {
            return true;
        }
        return in_array($key, $perms, true);
    }
}

if (!function_exists('user_can_access_dashboard')) {
    function user_can_access_dashboard(PDO $pdo, ?int $userId = null): bool
    {
        return user_has_sidebar_permission($pdo, 'home', $userId);
    }
}

if (!function_exists('role_supports_ownership_permission')) {
  function role_supports_ownership_permission(?string $role): bool
  {
    $r = strtolower(trim((string) $role));
    return $r === 'owner' || $r === 'partnership';
  }
}

if (!function_exists('sanitize_sidebar_permissions_for_role')) {
  /**
   * @param array<int, string>|null $permissions
   * @return array<int, string>
   */
  function sanitize_sidebar_permissions_for_role(?string $role, $permissions): array
  {
    if (!is_array($permissions)) {
      return [];
    }
    if (role_supports_ownership_permission($role)) {
      return array_values($permissions);
    }
    return array_values(array_filter($permissions, static function ($perm) {
      return $perm !== 'ownership';
    }));
  }
}
?>