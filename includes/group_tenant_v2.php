<?php
/**
 * Group first-class tenant (路线 B · Phase 1–3).
 *
 * Isolated from company.permissions / subsidiary-union category flags.
 * Company login paths must NOT call these helpers for category resolution.
 */
declare(strict_types=1);

require_once __DIR__ . '/group_scope_resolve.php';
require_once __DIR__ . '/company_expiration.php';
require_once __DIR__ . '/password_hashing.php';

/** Kill-switch: when false, Phase 1–3 pure-group login fallbacks are disabled. */
function gt_v2_enabled(): bool
{
    return true;
}

/** Product contract: Group category is always Games (never Bank). */
function gt_v2_fixed_games_permissions(): array
{
    return ['Games'];
}

/**
 * @return array{has_gambling: bool, has_bank: bool, permissions: array<int, string>}
 */
function gt_v2_fixed_games_category_flags(): array
{
    return [
        'has_gambling' => true,
        'has_bank' => false,
        'permissions' => gt_v2_fixed_games_permissions(),
    ];
}

/**
 * Active sidebar/session category while Group login has a company_id.
 * Pure Group / group-entity → fixed Games; real subsidiary → that row's permissions
 * (Bank-only must not keep Report / Games menus after company switch).
 *
 * @return array{has_gambling: bool, has_bank: bool, permissions: array<int, string>}
 */
function gt_v2_resolve_active_category_flags(PDO $pdo, int $companyId): array
{
    if ($companyId <= 0) {
        return gt_v2_fixed_games_category_flags();
    }
    if (!function_exists('gc_resolve_company_category_flags') || !function_exists('gc_company_row_is_group_entity')) {
        return gt_v2_fixed_games_category_flags();
    }
    try {
        $stmt = $pdo->prepare('SELECT company_id, group_id FROM company WHERE id = ? LIMIT 1');
        $stmt->execute([$companyId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (
            !$row
            || gc_company_row_is_group_entity(
                isset($row['company_id']) ? (string) $row['company_id'] : '',
                isset($row['group_id']) ? (string) $row['group_id'] : ''
            )
        ) {
            return gt_v2_fixed_games_category_flags();
        }
        return gc_resolve_company_category_flags($pdo, $companyId);
    } catch (Throwable $e) {
        error_log('gt_v2_resolve_active_category_flags: ' . $e->getMessage());
        return gt_v2_fixed_games_category_flags();
    }
}

function gt_v2_normalize_group_code(?string $code): string
{
    return gc_normalize_group_code($code ?? '');
}

/**
 * True when login form ID matches an active `groups.group_code` (first-class group tenant).
 * Does NOT treat company.group_id alone as a group tenant.
 */
function gt_v2_is_active_group_tenant_code(PDO $pdo, string $code): bool
{
    if (!gt_v2_enabled()) {
        return false;
    }
    $g = gt_v2_normalize_group_code($code);
    if ($g === '' || !gc_has_groups_table($pdo)) {
        return false;
    }
    try {
        $stmt = $pdo->prepare(
            "SELECT id FROM `groups` WHERE UPPER(TRIM(group_code)) = ? AND status = 'active' LIMIT 1"
        );
        $stmt->execute([$g]);
        return (bool) $stmt->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
}

/**
 * Active groups row by code (no company join).
 *
 * @return array<string, mixed>|null
 */
function gt_v2_fetch_active_group_row(PDO $pdo, string $groupCode): ?array
{
    $g = gt_v2_normalize_group_code($groupCode);
    if ($g === '' || !gc_has_groups_table($pdo)) {
        return null;
    }
    try {
        $stmt = $pdo->prepare(
            "SELECT id, group_code, group_name, status, owner_id, expiration_date, permissions
             FROM `groups`
             WHERE UPPER(TRIM(group_code)) = ? AND status = 'active'
             LIMIT 1"
        );
        $stmt->execute([$g]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    } catch (Throwable $e) {
        error_log('gt_v2_fetch_active_group_row: ' . $e->getMessage());
        return null;
    }
}

function gt_v2_group_is_expiration_blocking(PDO $pdo, array $groupRow): bool
{
    $code = gt_v2_normalize_group_code((string) ($groupRow['group_code'] ?? ''));
    $exp = $groupRow['expiration_date'] ?? null;
    return gc_is_company_expiration_blocking(
        $exp !== null ? (string) $exp : null,
        $code,
        $code
    );
}

/** Category gate for pure group scope (no company_id). */
function gt_v2_group_category_access_ok(PDO $pdo, string $groupCode): bool
{
    if (!gt_v2_enabled()) {
        return false;
    }
    return gt_v2_fetch_active_group_row($pdo, $groupCode) !== null;
}

/**
 * Apply group-login session fields without requiring a company row.
 * Phase 7: always clear company pin — subsidiaries must not stick via c.group_id match.
 *
 * @param array<string, mixed> $groupRow
 */
function gt_v2_apply_group_login_session(array $groupRow, string $loginIdentifier): void
{
    $g = gt_v2_normalize_group_code($loginIdentifier !== ''
        ? $loginIdentifier
        : (string) ($groupRow['group_code'] ?? ''));
    $_SESSION['login_scope'] = 'group';
    $_SESSION['login_identifier'] = $g;
    $_SESSION['login_group_scope_id'] = (int) ($groupRow['id'] ?? 0) > 0
        ? (int) $groupRow['id']
        : null;
    unset($_SESSION['login_group_id']);
    $_SESSION['company_id'] = null;
    $_SESSION['company_code'] = $g;
}

/**
 * Try Owner auth against groups.owner_id only (empty group / no company row).
 *
 * @return array{
 *   ok: bool,
 *   expired?: bool,
 *   password_match?: bool,
 *   owner?: array<string, mixed>,
 *   group?: array<string, mixed>,
 *   upgrade_plain?: bool
 * }
 */
function gt_v2_try_authenticate_owner(PDO $pdo, string $loginId, string $password, string $groupCode): array
{
    if (!gt_v2_enabled()) {
        return ['ok' => false];
    }
    $group = gt_v2_fetch_active_group_row($pdo, $groupCode);
    if ($group === null) {
        return ['ok' => false];
    }
    $ownerId = (int) ($group['owner_id'] ?? 0);
    if ($ownerId <= 0) {
        return ['ok' => false];
    }

    $stmt = $pdo->prepare('SELECT * FROM owner WHERE id = ? AND UPPER(owner_code) = UPPER(?) LIMIT 1');
    $stmt->execute([$ownerId, $loginId]);
    $owner = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$owner) {
        return ['ok' => false];
    }

    $passwordMatch = false;
    $upgradePlain = false;
    if (verify_secure_password($password, (string) ($owner['password'] ?? ''))) {
        $passwordMatch = true;
    } elseif ($password === (string) ($owner['password'] ?? '')) {
        $passwordMatch = true;
        $upgradePlain = true;
    }
    if (!$passwordMatch) {
        return ['ok' => false, 'password_match' => false];
    }
    if (gt_v2_group_is_expiration_blocking($pdo, $group)) {
        return ['ok' => false, 'password_match' => true, 'expired' => true, 'group' => $group];
    }

    return [
        'ok' => true,
        'password_match' => true,
        'owner' => $owner,
        'group' => $group,
        'upgrade_plain' => $upgradePlain,
    ];
}

/**
 * Try Admin/user auth via user_group_map (no company under group required).
 *
 * @return array{
 *   ok: bool,
 *   expired?: bool,
 *   password_match?: bool,
 *   user?: array<string, mixed>,
 *   group?: array<string, mixed>
 * }
 */
function gt_v2_try_authenticate_user(PDO $pdo, string $loginId, string $password, string $groupCode): array
{
    if (!gt_v2_enabled()) {
        return ['ok' => false];
    }
    $group = gt_v2_fetch_active_group_row($pdo, $groupCode);
    if ($group === null) {
        return ['ok' => false];
    }
    $groupPk = (int) ($group['id'] ?? 0);
    if ($groupPk <= 0) {
        return ['ok' => false];
    }

    try {
        if ($pdo->query("SHOW TABLES LIKE 'user_group_map'")->rowCount() === 0) {
            return ['ok' => false];
        }
    } catch (Throwable $e) {
        return ['ok' => false];
    }

    $stmt = $pdo->prepare("
        SELECT u.*
        FROM user u
        INNER JOIN user_group_map ugm ON ugm.user_id = u.id AND ugm.group_id = ?
        WHERE UPPER(u.login_id) = UPPER(?) AND u.status = 'active'
        LIMIT 1
    ");
    $stmt->execute([$groupPk, $loginId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$user) {
        return ['ok' => false];
    }

    if (!verify_secure_password($password, (string) ($user['password'] ?? ''))) {
        return ['ok' => false, 'password_match' => false];
    }
    if (gt_v2_group_is_expiration_blocking($pdo, $group)) {
        return ['ok' => false, 'password_match' => true, 'expired' => true, 'group' => $group];
    }

    return [
        'ok' => true,
        'password_match' => true,
        'user' => $user,
        'group' => $group,
    ];
}

/**
 * Expiration hint fields from groups row (for current_user when no company).
 *
 * @param array<string, mixed> $groupRow
 * @return array{
 *   expiration_date: ?string,
 *   days_until_expiration: ?int,
 *   expiration_hint: string,
 *   expiration_status: string
 * }
 */
function gt_v2_group_expiration_payload(array $groupRow): array
{
    $raw = $groupRow['expiration_date'] ?? null;
    $rawStr = $raw !== null && $raw !== '' ? (string) $raw : null;
    if ($rawStr === null) {
        return [
            'expiration_date' => null,
            'days_until_expiration' => null,
            'expiration_hint' => 'No expiration date',
            'expiration_status' => 'normal',
        ];
    }

    try {
        $now = new DateTime();
        $now->setTime(0, 0, 0);
        $expiration = new DateTime($rawStr);
        $expiration->setTime(0, 0, 0);
        $diffDays = (int) $now->diff($expiration)->format('%r%a');

        if ($diffDays < 0) {
            return [
                'expiration_date' => $rawStr,
                'days_until_expiration' => $diffDays,
                'expiration_hint' => 'Expired',
                'expiration_status' => 'expired',
            ];
        }
        if ($diffDays === 0) {
            $status = function_exists('company_expiration_status')
                ? company_expiration_status(0)
                : 'exp-critical';
            return [
                'expiration_date' => $rawStr,
                'days_until_expiration' => 0,
                'expiration_hint' => 'Expires today',
                'expiration_status' => $status,
            ];
        }
        if ($diffDays <= 30) {
            $status = function_exists('company_expiration_status')
                ? company_expiration_status($diffDays)
                : 'exp-yellow';
            return [
                'expiration_date' => $rawStr,
                'days_until_expiration' => $diffDays,
                'expiration_hint' => $diffDays . ' day' . ($diffDays > 1 ? 's' : '') . ' left',
                'expiration_status' => $status,
            ];
        }
        $months = (int) floor($diffDays / 30);
        $days = $diffDays % 30;
        $hint = $days === 0
            ? ($months . ' month' . ($months > 1 ? 's' : '') . ' left')
            : ($months . 'm ' . $days . 'd left');
        return [
            'expiration_date' => $rawStr,
            'days_until_expiration' => $diffDays,
            'expiration_hint' => $hint,
            'expiration_status' => 'normal',
        ];
    } catch (Throwable $e) {
        return [
            'expiration_date' => $rawStr,
            'days_until_expiration' => null,
            'expiration_hint' => 'No expiration date',
            'expiration_status' => 'normal',
        ];
    }
}
