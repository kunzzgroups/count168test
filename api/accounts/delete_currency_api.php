<?php
/**
 * 删除货币 API（规范化版）
 * 路径：api/accounts/delete_currency_api.php
 * 统一响应格式：{ success: bool, message: string, data: mixed }
 * Group / company scope via tenant_resolve_currency_context_from_request (group_only).
 */
session_start();
session_write_close();
header('Content-Type: application/json');
require_once __DIR__ . '/../../includes/config.php';
require_once __DIR__ . '/../../includes/group_company_access.php';
require_once __DIR__ . '/../../includes/tenant_scope.php';
require_once __DIR__ . '/../deleted_log/deleted_log.php';
require_once __DIR__ . '/../includes/partnership_audit_readonly.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['success' => false, 'message' => 'Invalid request method', 'data' => null]);
    exit;
}

function jsonResponse(bool $success, string $message, $data = null): void
{
    $out = ['success' => $success, 'message' => $message, 'data' => $data];
    if (!$success) {
        $out['error'] = $message;
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
}

function tableExists(PDO $pdo, string $tableName): bool
{
    $stmt = $pdo->query('SHOW TABLES LIKE ' . $pdo->quote($tableName));

    return $stmt !== false && $stmt->rowCount() > 0;
}

function columnExists(PDO $pdo, string $table, string $column): bool
{
    $safeTable = str_replace(['`', ';', ' '], '', $table);
    $stmt = $pdo->query('SHOW COLUMNS FROM `' . $safeTable . '` LIKE ' . $pdo->quote($column));

    return $stmt !== false && $stmt->rowCount() > 0;
}

/**
 * @param array<string, mixed> $input
 * @return array{mode: 'group'|'company', group_pk: int, company_id: int, group_code: string}
 */
function resolveDeleteCurrencyContext(PDO $pdo, array $input): array
{
    $groupOnly = !empty($input['group_only'])
        && filter_var($input['group_only'], FILTER_VALIDATE_BOOLEAN);

    $explicitCompanyId = 0;
    if (isset($input['company_id']) && $input['company_id'] !== '' && $input['company_id'] !== null) {
        $explicitCompanyId = (int) $input['company_id'];
    } elseif (isset($_GET['company_id']) && $_GET['company_id'] !== '' && $_GET['company_id'] !== null) {
        $explicitCompanyId = (int) $_GET['company_id'];
    }

    if (gc_is_group_login()) {
        if ($explicitCompanyId > 0) {
            $groupOnly = false;
        } else {
            $groupOnly = true;
        }
    }

    if ($groupOnly) {
        unset($input['company_id']);
    }

    $params = [
        'group_id' => $input['group_id'] ?? ($_GET['group_id'] ?? null),
        'company_id' => $groupOnly ? null : ($input['company_id'] ?? ($_GET['company_id'] ?? null)),
        'group_only' => $groupOnly ? '1' : ($input['group_only'] ?? ($_GET['group_only'] ?? null)),
        'session_company_id' => $_SESSION['company_id'] ?? null,
    ];

    if (gc_is_group_login() && trim((string) ($params['group_id'] ?? '')) === '') {
        $params['group_id'] = $_SESSION['login_identifier'] ?? null;
    }

    return tenant_resolve_currency_context_from_request($pdo, $params);
}

/**
 * Resolve another currency in the same scope to reassign NOT NULL FK rows before delete.
 */
function resolveFallbackCurrencyIdForDetach(PDO $pdo, int $currencyId, array $ctx): ?int
{
    foreach (tenant_fetch_currencies($pdo, $ctx) as $row) {
        $id = (int) ($row['id'] ?? 0);
        if ($id > 0 && $id !== $currencyId) {
            return $id;
        }
    }

    return null;
}

/**
 * On force delete: detach historical references so FK constraints allow currency row removal.
 *
 * @return string|null Error message when detach cannot complete
 */
function detachCurrencyHistoricalReferences(PDO $pdo, int $currencyId, array $ctx): ?string
{
    $companyId = (int) ($ctx['company_id'] ?? 0);
    if ($companyId <= 0) {
        return 'Missing company scope';
    }

    $fallbackId = resolveFallbackCurrencyIdForDetach($pdo, $currencyId, $ctx);

    $reassignCompanyScoped = static function (PDO $pdo, string $table, int $currencyId, int $companyId, ?int $fallbackId) use (&$blockingError): bool {
        if (!tableExists($pdo, $table) || !columnExists($pdo, $table, 'currency_id') || !columnExists($pdo, $table, 'company_id')) {
            return true;
        }
        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM `{$table}` WHERE currency_id = ? AND company_id = ?");
        $countStmt->execute([$currencyId, $companyId]);
        $n = (int) $countStmt->fetchColumn();
        if ($n === 0) {
            return true;
        }
        if ($fallbackId === null) {
            $blockingError = 'Cannot force delete: ' . $n . ' ' . $table . ' record(s) require another currency in this company';

            return false;
        }
        $upd = $pdo->prepare("UPDATE `{$table}` SET currency_id = ? WHERE currency_id = ? AND company_id = ?");
        $upd->execute([$fallbackId, $currencyId, $companyId]);

        return true;
    };

    $blockingError = null;
    foreach (['process', 'data_captures', 'data_capture_details', 'data_capture_templates'] as $table) {
        if (!$reassignCompanyScoped($pdo, $table, $currencyId, $companyId, $fallbackId)) {
            return $blockingError;
        }
    }

    try {
        if (columnExists($pdo, 'transactions', 'currency_id')) {
            $stmt = $pdo->prepare('UPDATE transactions SET currency_id = NULL WHERE currency_id = ? AND company_id = ?');
            $stmt->execute([$currencyId, $companyId]);
        }
    } catch (PDOException $e) {
        return 'Failed to detach transactions: ' . $e->getMessage();
    }

    try {
        if (tableExists($pdo, 'transactions_rate')) {
            if ($fallbackId === null) {
                $chk = $pdo->prepare("
                    SELECT COUNT(*)
                    FROM transactions_rate tr
                    INNER JOIN transactions t ON tr.transaction_id = t.id
                    WHERE (tr.rate_from_currency_id = ? OR tr.rate_to_currency_id = ?) AND t.company_id = ?
                ");
                $chk->execute([$currencyId, $currencyId, $companyId]);
                if ((int) $chk->fetchColumn() > 0) {
                    return 'Cannot force delete: rate transactions require another currency in this company';
                }
            } else {
                $stmt = $pdo->prepare("
                    UPDATE transactions_rate tr
                    INNER JOIN transactions t ON tr.transaction_id = t.id
                    SET tr.rate_from_currency_id = CASE WHEN tr.rate_from_currency_id = ? THEN ? ELSE tr.rate_from_currency_id END,
                        tr.rate_to_currency_id = CASE WHEN tr.rate_to_currency_id = ? THEN ? ELSE tr.rate_to_currency_id END
                    WHERE (tr.rate_from_currency_id = ? OR tr.rate_to_currency_id = ?) AND t.company_id = ?
                ");
                $stmt->execute([$currencyId, $fallbackId, $currencyId, $fallbackId, $currencyId, $currencyId, $companyId]);
            }
        }
    } catch (PDOException $e) {
        return 'Failed to detach rate transactions: ' . $e->getMessage();
    }

    try {
        if (tableExists($pdo, 'transactions_rate_details') && columnExists($pdo, 'transactions_rate_details', 'currency_id')) {
            if ($fallbackId === null) {
                $chk = $pdo->prepare("
                    SELECT COUNT(*)
                    FROM transactions_rate_details trd
                    INNER JOIN transactions_rate tr ON trd.rate_group_id = tr.rate_group_id
                    INNER JOIN transactions t ON tr.transaction_id = t.id
                    WHERE trd.currency_id = ? AND t.company_id = ?
                ");
                $chk->execute([$currencyId, $companyId]);
                if ((int) $chk->fetchColumn() > 0) {
                    return 'Cannot force delete: rate transaction details require another currency in this company';
                }
            } else {
                $stmt = $pdo->prepare("
                    UPDATE transactions_rate_details trd
                    INNER JOIN transactions_rate tr ON trd.rate_group_id = tr.rate_group_id
                    INNER JOIN transactions t ON tr.transaction_id = t.id
                    SET trd.currency_id = ?
                    WHERE trd.currency_id = ? AND t.company_id = ?
                ");
                $stmt->execute([$fallbackId, $currencyId, $companyId]);
            }
        }
    } catch (PDOException $e) {
        return 'Failed to detach rate transaction details: ' . $e->getMessage();
    }

    try {
        if (tableExists($pdo, 'transaction_entry') && columnExists($pdo, 'transaction_entry', 'currency_id')) {
            if ($fallbackId === null) {
                $chk = $pdo->prepare('SELECT COUNT(*) FROM transaction_entry WHERE currency_id = ? AND company_id = ?');
                $chk->execute([$currencyId, $companyId]);
                if ((int) $chk->fetchColumn() > 0) {
                    return 'Cannot force delete: transaction entries require another currency in this company';
                }
            } else {
                $stmt = $pdo->prepare('UPDATE transaction_entry SET currency_id = ? WHERE currency_id = ? AND company_id = ?');
                $stmt->execute([$fallbackId, $currencyId, $companyId]);
            }
        }
    } catch (PDOException $e) {
        return 'Failed to detach transaction entries: ' . $e->getMessage();
    }

    return null;
}

try {
    if (!isset($_SESSION['user_id'])) {
        jsonResponse(false, '用户未登录或缺少公司信息', null);
        exit;
    }

    if (is_partnership_audit_read_only_active($pdo)) {
        jsonResponse(false, '只读账号无法删除币种', null);
        exit;
    }

    $rawInput = file_get_contents('php://input');
    $input = json_decode($rawInput, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonResponse(false, 'Invalid JSON input: ' . json_last_error_msg(), null);
        exit;
    }
    if (!is_array($input)) {
        $input = [];
    }

    try {
        $currencyCtx = resolveDeleteCurrencyContext($pdo, $input);
    } catch (Exception $e) {
        http_response_code(400);
        jsonResponse(false, $e->getMessage(), null);
        exit;
    }

    $company_id = (int) ($currencyCtx['company_id'] ?? 0);
    $groupPk = (int) ($currencyCtx['group_pk'] ?? 0);
    $isPureGroup = ($currencyCtx['mode'] ?? '') === 'group' && $groupPk > 0;
    if ($company_id <= 0 && !$isPureGroup) {
        jsonResponse(false, '用户未登录或缺少公司信息', null);
        exit;
    }

    $groupCode = (string) ($currencyCtx['group_code'] ?? '');
    if ($company_id > 0 && $groupCode !== '' && gc_is_group_login()) {
        gc_assert_company_id_allowed_for_login_scope($pdo, $company_id, $groupCode);
    } elseif ($isPureGroup && $groupCode !== '') {
        if (!gc_session_can_access_group_ledger($pdo, $groupCode)) {
            jsonResponse(false, '无权限访问该集团', null);
            exit;
        }
    }

    if (!isset($input['id']) || empty($input['id'])) {
        jsonResponse(false, 'Currency ID is required', null);
        exit;
    }

    $currencyId = (int) $input['id'];
    $forceDelete = isset($input['force']) && $input['force'] === true;

    $currency = tenant_get_currency_row($pdo, $currencyId, $currencyCtx);
    if (!$currency) {
        jsonResponse(false, 'Currency not found or access denied', null);
        exit;
    }

    if (
        ($currencyCtx['mode'] ?? '') === 'group'
        && tenant_table_has_sync_source_column($pdo)
        && strtolower(trim((string) ($currency['sync_source'] ?? 'manual'))) === 'subsidiary'
    ) {
        jsonResponse(
            false,
            'Cannot delete currency synced from subsidiary companies',
            ['sync_source' => 'subsidiary', 'deletable' => false]
        );
        exit;
    }

    [$usageMessages, $debugInfo] = tenant_collect_currency_usage($pdo, $currencyId, $currencyCtx, (string) $currency['code']);

    // force=true: skip historical usage (data capture, templates); still hard-block on
    // linked accounts, transactions (incl. rate transactions/entries), and Bank Process usage.
    if ($forceDelete) {
        $usageMessages = array_filter($usageMessages, static function ($msg) {
            return strpos($msg, 'account(s)') !== false
                || strpos($msg, 'transaction') !== false
                || strpos($msg, 'process(es)') !== false;
        });
    }

    if ($usageMessages !== []) {
        $accountsInUse = tenant_get_accounts_using_currency($pdo, $currencyId, $currencyCtx);
        $responseData = ['accounts_in_use' => $accountsInUse];

        if ($accountsInUse !== []) {
            $accountLabels = array_map(static function ($acc) {
                $name = trim((string) ($acc['name'] ?? ''));
                $code = trim((string) ($acc['account_id'] ?? ''));
                if ($name !== '' && $code !== '') {
                    return $name . ' (' . $code . ')';
                }

                return $name !== '' ? $name : $code;
            }, $accountsInUse);
            $errorMsg = 'Cannot delete currency. The following accounts are using it: ' . implode(', ', $accountLabels);
        } else {
            $errorMsg = 'Cannot delete currency that is being used by: ' . implode(', ', $usageMessages);
        }

        if ($debugInfo !== []) {
            $errorMsg .= ' [Debug: ' . implode(', ', $debugInfo) . ']';
        }
        jsonResponse(false, $errorMsg, $responseData);
        exit;
    }

    if ($forceDelete) {
        $detachError = detachCurrencyHistoricalReferences($pdo, $currencyId, $currencyCtx);
        if ($detachError !== null) {
            jsonResponse(false, $detachError, null);
            exit;
        }
    }

    deletedLog(
        $pdo,
        '',
        '/api/accounts/delete_currency_api.php',
        'currency',
        (string) $currencyId,
        'DELETE',
        null,
        (string) $company_id
    );

    $deleted = tenant_delete_currency($pdo, $currencyId, $currencyCtx);
    if ($deleted === 0) {
        if (!tenant_currency_belongs_to_context($pdo, $currencyId, $currencyCtx)) {
            jsonResponse(false, 'Currency not found or does not belong to current company', null);
        } else {
            jsonResponse(false, 'Failed to delete currency. Please check database constraints or permissions.', null);
        }
        exit;
    }

    require_once __DIR__ . '/../includes/realtime.php';

    if (($currencyCtx['mode'] ?? '') === 'company') {
        tenant_reconcile_groups_after_company_currency_deleted(
            $pdo,
            (int) ($currencyCtx['company_id'] ?? $company_id),
            (string) ($currency['code'] ?? '')
        );
        tenant_remove_currency_from_company_countries($pdo, (int) ($currencyCtx['company_id'] ?? $company_id), (string) ($currency['code'] ?? ''));
        if ($company_id > 0) {
            realtime_publish_companies([$company_id], 'processes', 'remove_country');
        }
    }

    if ($company_id > 0) {
        realtime_publish_companies([$company_id], 'accounts', 'delete_currency');
    }

    jsonResponse(true, 'Currency deleted successfully', null);
} catch (PDOException $e) {
    error_log('DeleteCurrencyAPI - PDO: ' . $e->getMessage());
    if ($e->getCode() === '23000') {
        http_response_code(409);
        jsonResponse(false, 'Cannot delete currency: it is still referenced by existing records. Please remove or reassign those records first.', null);
    } else {
        http_response_code(500);
        jsonResponse(false, 'Database error: ' . $e->getMessage(), null);
    }
} catch (Exception $e) {
    error_log('DeleteCurrencyAPI - Exception: ' . $e->getMessage());
    http_response_code(400);
    jsonResponse(false, $e->getMessage(), null);
} catch (Error $e) {
    error_log('DeleteCurrencyAPI - Fatal: ' . $e->getMessage());
    http_response_code(500);
    jsonResponse(false, 'Fatal error: ' . $e->getMessage(), null);
}
