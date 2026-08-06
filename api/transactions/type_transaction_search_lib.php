<?php
/**
 * Build Transaction Payment grid rows for right-side type search.
 * Final payload is aggregated to one row per account + currency.
 */

require_once __DIR__ . '/type_account_search_lib.php';
require_once __DIR__ . '/type_pure_manual_filter_lib.php';
require_once __DIR__ . '/../../includes/permissions.php';
require_once __DIR__ . '/../includes/money_decimal.php';

if (!defined('SEARCH_API_LIBRARY_MODE')) {
    define('SEARCH_API_LIBRARY_MODE', true);
}
require_once __DIR__ . '/search_api.php';

/**
 * @return array{has_currency_id: bool, currency_join: string, currency_filter_field: ?string}
 */
function typeTxSearchCurrencySchema(PDO $pdo): array
{
    static $schema = null;
    if ($schema !== null) {
        return $schema;
    }
    $hasCurrencyId = false;
    try {
        $st = $pdo->query("SHOW COLUMNS FROM transactions LIKE 'currency_id'");
        $hasCurrencyId = $st && $st->rowCount() > 0;
    } catch (Throwable $e) {
        $hasCurrencyId = false;
    }
    if ($hasCurrencyId) {
        $schema = [
            'has_currency_id' => true,
            'currency_join' => 'LEFT JOIN currency c ON t.currency_id = c.id',
            'currency_filter_field' => 'c.code',
        ];
    } else {
        $schema = [
            'has_currency_id' => false,
            'currency_join' => '',
            'currency_filter_field' => null,
        ];
    }

    return $schema;
}

function typeTxSearchFormatDateYmd(?string $ymd): string
{
    $ymd = trim((string) $ymd);
    if ($ymd === '') {
        return '';
    }
    $ts = strtotime($ymd);
    if ($ts === false) {
        return $ymd;
    }

    return date('d/m/Y', $ts);
}

function typeTxSearchSignedCrDrToAccount(string $type, string $amount, string $sms = '', string $description = ''): string
{
    $amt = money_out($amount ?? '0');
    $type = strtoupper(trim($type));
    $sms = (string) $sms;
    $desc = strtoupper(trim($description));

    if (in_array($type, ['RECEIVE', 'CLAIM', 'CLEAR', 'CONTRA'], true)) {
        return searchMoneyNeg($amt);
    }
    if ($type === 'PAYMENT') {
        if (typeTxSearchIsExcludedNonManualPayment($sms, $desc)) {
            return stripos($sms, '[DOMAIN_NET_PROFIT|') === 0 || stripos($sms, '[AUTO_RENEW|NET_PROFIT|') === 0
                ? '0.00'
                : $amt;
        }

        return searchMoneyNeg($amt);
    }

    return '0.00';
}

function typeTxSearchSignedWinLoss(string $type, string $amount): string
{
    $type = strtoupper(trim($type));
    $amt = money_out($amount ?? '0');
    if ($type === 'WIN') {
        return $amt;
    }
    if ($type === 'LOSE') {
        return searchMoneyNeg($amt);
    }
    if ($type === 'ADJUSTMENT') {
        return $amt;
    }

    return '0.00';
}

/**
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function typeTxSearchRowToGrid(array $row): array
{
    $type = strtoupper(trim((string) ($row['transaction_type'] ?? '')));
    $amount = money_out($row['amount'] ?? '0');
    $description = typeTxSearchBuildDescription($row);
    $dateLabel = typeTxSearchFormatDateYmd((string) ($row['transaction_date_raw'] ?? ''));

    $crDr = '0.00';
    $winLoss = '0.00';
    if (in_array($type, ['WIN', 'LOSE', 'ADJUSTMENT'], true)) {
        $winLoss = typeTxSearchSignedWinLoss($type, $amount);
    } else {
        $crDr = typeTxSearchSignedCrDrToAccount(
            $type,
            $amount,
            (string) ($row['sms'] ?? ''),
            $description
        );
    }
    $balance = in_array($type, ['WIN', 'LOSE', 'ADJUSTMENT'], true) ? $winLoss : $crDr;

    return [
        'account_id' => (string) ($row['account_code'] ?? ''),
        'account_name' => trim((string) ($row['account_name_raw'] ?? '')),
        'account_db_id' => (int) ($row['account_db_id'] ?? 0),
        'role' => (string) ($row['account_role'] ?? ''),
        'currency' => strtoupper(trim((string) ($row['currency_code'] ?? ''))),
        'bf' => '0.00',
        'win_loss' => searchMoneyHalfUp2($winLoss),
        'win_loss_full' => searchMoney2($winLoss),
        'cr_dr' => searchMoneyHalfUp2($crDr),
        'balance' => searchMoneyHalfUp2($balance),
        'balance_full' => searchMoney2($balance),
        'has_crdr_transactions' => searchMoneyNonZero($crDr) ? 1 : 0,
        'has_win_loss_transactions' => searchMoneyNonZero($winLoss) ? 1 : 0,
        'transaction_id' => (int) ($row['transaction_id'] ?? 0),
        'transaction_date' => $dateLabel,
        'type_search_row' => 1,
        'type_description' => $description,
    ];
}

/**
 * @param string[] $currencyFilters upper currency codes
 * @return array<int, array<string, mixed>>
 */
function typeTxSearchFetchTransactions(
    PDO $pdo,
    array $listScope,
    string $formType,
    array $currencyFilters
): array {
    $resolved = typeAccountSearchResolveQueryMode($formType);
    if (($resolved['mode'] ?? '') === 'rate') {
        return typeTxSearchFetchRateTransactions($pdo, $listScope, $currencyFilters);
    }

    $types = $resolved['types'] ?? [];
    if ($types === []) {
        return [];
    }

    $txnFilter = tx_search_transaction_filter($pdo, $listScope, 't');
    $schema = typeTxSearchCurrencySchema($pdo);
    $inTypes = implode(',', array_map(static fn ($x) => $pdo->quote($x), $types));
    $approvalSql = tx_sql_transaction_approval_where($pdo, 't');
    $bankDescSql = typeAccountSearchBankProcessDescriptionExcludeSql('t');
    $bankSrcSql = typeAccountSearchHasSourceBankProcessColumn($pdo)
        ? typeAccountSearchSourceBankProcessExcludeSql('t')
        : '';
    $pureManualSql = typeTxSearchPureManualSqlFragment($formType, 't');

    $sql = "SELECT
                t.id AS transaction_id,
                t.transaction_date AS transaction_date_raw,
                t.transaction_type,
                t.amount,
                t.description,
                COALESCE(t.sms, '') AS sms,
                t.account_id AS account_db_id,
                to_acc.account_id AS account_code,
                to_acc.name AS account_name_raw,
                to_acc.role AS account_role,
                from_acc.account_id AS from_account_code,
                UPPER(COALESCE(c.code, '')) AS currency_code
            FROM transactions t
            JOIN account to_acc ON t.account_id = to_acc.id
            LEFT JOIN account from_acc ON t.from_account_id = from_acc.id
            {$schema['currency_join']}
            WHERE {$txnFilter['sql']}
              AND t.transaction_type IN ({$inTypes})
              {$approvalSql}
              {$bankDescSql}
              {$bankSrcSql}
              {$pureManualSql}";

    $params = [(int) $txnFilter['bind']];
    if (!empty($currencyFilters) && $schema['currency_filter_field'] !== null) {
        $placeholders = implode(',', array_fill(0, count($currencyFilters), '?'));
        $sql .= " AND {$schema['currency_filter_field']} IN ($placeholders)";
        $params = array_merge($params, array_map('strtoupper', $currencyFilters));
    }
    $sql .= ' ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = [];
    $formTypeUpper = strtoupper(trim($formType));
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        if (!typeTxSearchPassesPureManualFilter($formTypeUpper, $r)) {
            continue;
        }
        $rows[] = typeTxSearchRowToGrid($r);
    }

    return $rows;
}

/**
 * @param string[] $currencyFilters
 * @return array<int, array<string, mixed>>
 */
function typeTxSearchFetchRateTransactions(PDO $pdo, array $listScope, array $currencyFilters): array
{
    $hFilter = tx_search_transaction_filter($pdo, $listScope, 'h');
    $permCompanyId = tx_permission_company_id_for_scope($pdo, $listScope);
    $isGroup = (($listScope['mode'] ?? '') === 'group');
    $companyJoin = $isGroup
        ? ''
        : ' INNER JOIN account_company ac ON ac.account_id = e.account_id AND ac.company_id = ?';

    $sql = "SELECT
                h.id AS transaction_id,
                h.transaction_date AS transaction_date_raw,
                'RATE' AS transaction_type,
                e.entry_type,
                e.amount,
                COALESCE(e.description, '') AS description,
                COALESCE(h.sms, '') AS sms,
                e.account_id AS account_db_id,
                acc.account_id AS account_code,
                acc.name AS account_name_raw,
                acc.role AS account_role,
                NULL AS from_account_code,
                UPPER(COALESCE(c.code, '')) AS currency_code
            FROM transaction_entry e
            JOIN transactions h ON e.header_id = h.id
            JOIN account acc ON e.account_id = acc.id
            {$companyJoin}
            LEFT JOIN currency c ON e.currency_id = c.id
            WHERE {$hFilter['sql']}
              AND h.transaction_type = 'RATE'
              AND e.entry_type IN ('RATE_FIRST_FROM', 'RATE_FIRST_TO', 'RATE_TRANSFER_FROM', 'RATE_TRANSFER_TO', 'RATE_FEE', 'RATE_PLATFORM_FEE')";

    $params = [(int) $hFilter['bind']];
    if (!$isGroup) {
        $params[] = $permCompanyId > 0 ? $permCompanyId : (int) ($listScope['company_id'] ?? 0);
    }
    if (!empty($currencyFilters)) {
        $placeholders = implode(',', array_fill(0, count($currencyFilters), '?'));
        $sql .= " AND UPPER(COALESCE(c.code, '')) IN ($placeholders)";
        $params = array_merge($params, array_map('strtoupper', $currencyFilters));
    }
    $sql .= ' ORDER BY h.transaction_date DESC, h.created_at DESC, e.id DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = [];
    while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
        if (!typeTxSearchPassesPureManualFilter('RATE', $r)) {
            continue;
        }
        $grid = typeTxSearchRowToGrid($r);
        // Align with history_api / search_api: RATE_FIRST_* and RATE_TRANSFER_* rows use -amount.
        // Fee rows keep their stored sign; current RATE_PLATFORM_FEE rows are negative.
        $entryType = strtoupper(trim((string) ($r['entry_type'] ?? '')));
        $rawAmt = money_out($r['amount'] ?? '0');
        $signedAmount = in_array($entryType, ['RATE_FEE', 'RATE_PLATFORM_FEE'], true)
            ? $rawAmt
            : searchMoneyNeg($rawAmt);
        $grid['cr_dr'] = searchMoneyHalfUp2($signedAmount);
        $grid['balance'] = $grid['cr_dr'];
        $grid['balance_full'] = searchMoney2($signedAmount);
        $grid['has_crdr_transactions'] = searchMoneyNonZero($grid['cr_dr']) ? 1 : 0;
        $rows[] = $grid;
    }

    return $rows;
}

/**
 * @param array<int, array<string, mixed>> $rows
 * @return array<int, array<string, mixed>>
 */
function typeTxSearchAggregateRows(array $rows): array
{
    $grouped = [];
    foreach ($rows as $row) {
        $accountDbId = (int) ($row['account_db_id'] ?? 0);
        $currency = strtoupper(trim((string) ($row['currency'] ?? '')));
        if ($accountDbId <= 0 || $currency === '') {
            continue;
        }
        $key = $accountDbId . '|' . $currency;
        if (!isset($grouped[$key])) {
            $grouped[$key] = [
                'account_id' => (string) ($row['account_id'] ?? ''),
                'account_name' => (string) ($row['account_name'] ?? ''),
                'account_db_id' => $accountDbId,
                'role' => (string) ($row['role'] ?? ''),
                'currency' => $currency,
                'bf_raw' => '0',
                'win_loss_raw' => '0',
                'cr_dr_raw' => '0',
                'has_crdr_transactions' => 0,
                'has_win_loss_transactions' => 0,
                'type_search_row' => 1,
            ];
        }
        $grouped[$key]['bf_raw'] = money_add($grouped[$key]['bf_raw'], (string) ($row['bf'] ?? '0'), 8);
        $wlFull = (string) ($row['win_loss_full'] ?? ($row['win_loss'] ?? '0'));
        $grouped[$key]['win_loss_raw'] = money_add($grouped[$key]['win_loss_raw'], $wlFull, 8);
        $grouped[$key]['cr_dr_raw'] = money_add($grouped[$key]['cr_dr_raw'], (string) ($row['cr_dr'] ?? '0'), 8);
        $grouped[$key]['has_crdr_transactions'] =
            ($grouped[$key]['has_crdr_transactions'] === 1 || (int) ($row['has_crdr_transactions'] ?? 0) === 1)
                ? 1
                : 0;
        $grouped[$key]['has_win_loss_transactions'] =
            ($grouped[$key]['has_win_loss_transactions'] === 1 || (int) ($row['has_win_loss_transactions'] ?? 0) === 1)
                ? 1
                : 0;
    }

    $out = [];
    foreach ($grouped as $agg) {
        $bf6 = searchMoney2($agg['bf_raw']);
        $wl6 = searchMoney2($agg['win_loss_raw']);
        $cr6 = searchMoney2($agg['cr_dr_raw']);
        $bal6 = searchMoney2(money_add(money_add($bf6, $wl6, 8), $cr6, 8));
        $out[] = [
            'account_id' => $agg['account_id'],
            'account_name' => $agg['account_name'],
            'account_db_id' => $agg['account_db_id'],
            'role' => $agg['role'],
            'currency' => $agg['currency'],
            'bf' => searchMoneyHalfUp2($bf6),
            'win_loss' => searchMoneyHalfUp2($wl6),
            'win_loss_full' => $wl6,
            'cr_dr' => searchMoneyHalfUp2($cr6),
            'balance' => searchMoneyHalfUp2($bal6),
            'balance_full' => $bal6,
            'has_crdr_transactions' => $agg['has_crdr_transactions'],
            'has_win_loss_transactions' => $agg['has_win_loss_transactions'],
            'type_search_row' => 1,
        ];
    }

    usort($out, static function ($a, $b) {
        $curCmp = strcmp((string) ($a['currency'] ?? ''), (string) ($b['currency'] ?? ''));
        if ($curCmp !== 0) return $curCmp;
        return strcmp((string) ($a['account_id'] ?? ''), (string) ($b['account_id'] ?? ''));
    });

    return $out;
}

/**
 * @param array<int, array<string, mixed>> $rows
 * @return array{left_table: array, right_table: array, totals: array, active_currency_codes: array}
 */
function typeTxSearchBuildPayload(array $rows): array
{
    $rows = typeTxSearchAggregateRows($rows);
    $left = [];
    $right = [];
    foreach ($rows as $row) {
        if (money_cmp($row['balance'] ?? '0', '0') >= 0) {
            $left[] = $row;
        } else {
            $right[] = $row;
        }
    }
    $left = normalizeMoneyRows(array_values($left));
    $right = normalizeMoneyRows(array_values($right));
    $all = array_merge($left, $right);
    $currencies = [];
    foreach ($all as $r) {
        $code = strtoupper(trim((string) ($r['currency'] ?? '')));
        if ($code !== '') {
            $currencies[$code] = true;
        }
    }

    return [
        'left_table' => $left,
        'right_table' => $right,
        'totals' => [
            'left' => calculateTotals($left),
            'right' => calculateTotals($right),
            'summary' => calculateTotals($all),
        ],
        'active_currency_codes' => array_keys($currencies),
        'type_search_mode' => 1,
    ];
}
