<?php
/**
 * Pure manual type filters shared by Type Search grid and Payment History drill-down.
 * Kept separate from type_transaction_search_lib.php so history_api.php does not pull in search_api.php
 * (both define calculateBF / calculateBFByCurrency).
 */

function typeTxSearchBuildDescription(array $row): string
{
    $type = strtoupper(trim((string) ($row['transaction_type'] ?? '')));
    $description = trim((string) ($row['description'] ?? ''));
    $fromCode = trim((string) ($row['from_account_code'] ?? ''));
    if ($description === '' && $type === 'ADJUSTMENT') {
        $description = 'ADJUSTMENT - WIN/LOSS';
    } elseif ($description === '' && in_array($type, ['WIN', 'LOSE'], true)) {
        $description = ($type === 'WIN' ? 'PROFIT FROM ' : 'PROFIT TO ')
            . ($fromCode !== '' ? $fromCode : 'N/A');
    } elseif ($description === '' && in_array($type, ['CONTRA', 'PAYMENT', 'RECEIVE', 'CLAIM', 'CLEAR'], true)) {
        $description = $type . ' FROM ' . ($fromCode !== '' ? $fromCode : 'N/A');
    }

    return strtoupper(trim($description));
}

/**
 * Type Search Phase 1: only manual settlement rows per form type (account To-side canonical description).
 */
function typeTxSearchSupportsPureManualFilter(string $formType): bool
{
    return in_array(strtoupper(trim($formType)), ['PAYMENT', 'CONTRA', 'CLAIM', 'CLEAR', 'ADJUSTMENT', 'RATE', 'PROFIT', 'ALL'], true);
}

/**
 * Payment History from Type Search: show full account ledger (no pure-type row filter).
 */
function typeTxSearchHistoryUsesFullAccountLedger(string $formType): bool
{
    return in_array(strtoupper(trim($formType)), ['PAYMENT', 'CONTRA', 'CLAIM', 'CLEAR', 'RATE', 'ADJUSTMENT', 'PROFIT', 'ALL'], true);
}

/**
 * Manual PROFIT (WIN/LOSE): exclude Bank Process, Process:/Auto: descriptions, compensation rows.
 *
 * @param array<string, mixed> $row
 */
function typeTxSearchIsManualProfitTransaction(array $row): bool
{
    $type = strtoupper(trim((string) ($row['transaction_type'] ?? '')));
    if (!in_array($type, ['WIN', 'LOSE'], true)) {
        return false;
    }
    $desc = trim((string) ($row['description'] ?? ''));
    if (stripos($desc, 'Process: ') === 0 || stripos($desc, 'Auto: ') === 0) {
        return false;
    }

    return preg_match('/^(Inactive\s+Compensation|Compensation)\s*/i', $desc) !== 1;
}

function typeTxSearchManualProfitDescriptionExcludeSql(string $alias = 't'): string
{
    $desc = "UPPER(TRIM(COALESCE({$alias}.description, '')))";

    return " AND {$desc} NOT LIKE 'PROCESS:%'
              AND {$desc} NOT LIKE 'AUTO:%'
              AND {$desc} NOT LIKE 'INACTIVE COMPENSATION%'
              AND {$desc} NOT LIKE 'COMPENSATION%'";
}

function typeTxSearchIsExcludedNonManualPayment(string $sms, string $canonicalUpper): bool
{
    $sms = (string) $sms;
    $desc = strtoupper(trim($canonicalUpper));
    if (stripos($sms, '[DOMAIN_SHARE_COMMISSION|') === 0 || stripos($sms, '[AUTO_RENEW|COMMISSION|') === 0) {
        return true;
    }
    if (stripos($sms, '[DOMAIN_NET_PROFIT|') === 0 || stripos($sms, '[AUTO_RENEW|NET_PROFIT|') === 0) {
        return true;
    }
    if (
        stripos($sms, '[DOMAIN_LIST_FEE|') === 0
        || strpos($desc, 'DOMAIN LIST FEE FROM ') === 0
        || strpos($desc, 'PAY DOMAIN FEE') === 0
        || (stripos($sms, '[AUTO_RENEW|') === 0
            && stripos($sms, '[AUTO_RENEW|COMMISSION|') !== 0
            && stripos($sms, '[AUTO_RENEW|NET_PROFIT|') !== 0)
    ) {
        return true;
    }

    return false;
}

function typeTxSearchPassesPureManualFilter(string $formType, array $row): bool
{
    $formType = strtoupper(trim($formType));
    if (!typeTxSearchSupportsPureManualFilter($formType)) {
        return true;
    }
    if ($formType === 'RATE') {
        return typeTxSearchIsPureRateEntryDescription((string) ($row['description'] ?? ''));
    }

    $canonical = typeTxSearchBuildDescription($row);
    switch ($formType) {
        case 'PAYMENT':
            if (strpos($canonical, 'PAYMENT FROM ') !== 0) {
                return false;
            }

            return !typeTxSearchIsExcludedNonManualPayment((string) ($row['sms'] ?? ''), $canonical);
        case 'CONTRA':
            return strpos($canonical, 'CONTRA FROM ') === 0;
        case 'CLAIM':
            return strpos($canonical, 'CLAIM FROM ') === 0;
        case 'ADJUSTMENT':
            return strpos($canonical, 'ADJUSTMENT - WIN/LOSS') === 0;
        case 'ALL':
            $isManual = strpos($canonical, 'PAYMENT FROM ') === 0
                || strpos($canonical, 'CONTRA FROM ') === 0
                || strpos($canonical, 'CLAIM FROM ') === 0
                || strpos($canonical, 'CLEAR FROM ') === 0
                || strpos($canonical, 'ADJUSTMENT - WIN/LOSS') === 0;
            if (!$isManual) {
                return false;
            }

            return !typeTxSearchIsExcludedNonManualPayment((string) ($row['sms'] ?? ''), $canonical);
        case 'PROFIT':
            return typeTxSearchIsManualProfitTransaction($row);
        default:
            return true;
    }
}

/**
 * Manual RATE entry descriptions stored as "Transaction from|to X (Rate: n)" per account perspective.
 */
function typeTxSearchIsPureRateEntryDescription(string $description): bool
{
    $description = trim($description);
    if ($description === '' || strtoupper($description) === 'RATE') {
        return false;
    }

    return (bool) preg_match(
        '/^Transaction\s+(?:from|to)\s+.+\s*\((?:Rate|RATE):\s*[^)]+\)\s*$/i',
        $description
    );
}

function typeTxSearchPureRateEntrySqlFragment(string $alias = 'e'): string
{
    $desc = "TRIM(COALESCE({$alias}.description, ''))";

    return " AND {$desc} <> ''
              AND UPPER({$desc}) <> 'RATE'
              AND (
                    {$desc} LIKE 'Transaction from %'
                    OR {$desc} LIKE 'Transaction to %'
              )
              AND (
                    {$desc} LIKE '%(Rate:%'
                    OR {$desc} LIKE '%(RATE:%'
              )";
}

function typeTxSearchPureManualSqlFragment(string $formType, string $alias = 't'): string
{
    $formType = strtoupper(trim($formType));
    if (!in_array($formType, ['PAYMENT', 'CONTRA', 'CLAIM', 'CLEAR', 'ADJUSTMENT', 'PROFIT', 'ALL'], true)) {
        return '';
    }

    $desc = "UPPER(TRIM(COALESCE({$alias}.description, '')))";
    $sms = "COALESCE({$alias}.sms, '')";
    $emptyDesc = "TRIM(COALESCE({$alias}.description, '')) = ''";
    $hasFrom = "{$alias}.from_account_id IS NOT NULL AND {$alias}.from_account_id > 0";

    switch ($formType) {
        case 'ALL':
            return " AND (
                    ({$emptyDesc} AND {$hasFrom})
                    OR {$desc} LIKE 'PAYMENT FROM %'
                    OR {$desc} LIKE 'CONTRA FROM %'
                    OR {$desc} LIKE 'CLAIM FROM %'
                    OR {$desc} LIKE 'CLEAR FROM %'
                    OR {$desc} LIKE 'ADJUSTMENT - WIN/LOSS%'
                )
                AND {$sms} NOT LIKE '[DOMAIN_SHARE_COMMISSION|%'
                AND {$sms} NOT LIKE '[AUTO_RENEW|COMMISSION|%'
                AND {$sms} NOT LIKE '[DOMAIN_NET_PROFIT|%'
                AND {$sms} NOT LIKE '[AUTO_RENEW|NET_PROFIT|%'
                AND {$sms} NOT LIKE '[DOMAIN_LIST_FEE|%'
                AND {$desc} NOT LIKE 'DOMAIN LIST FEE FROM %'
                AND {$desc} NOT LIKE 'PAY DOMAIN FEE%'
                AND NOT (
                    {$sms} LIKE '[AUTO_RENEW|%'
                    AND {$sms} NOT LIKE '[AUTO_RENEW|COMMISSION|%'
                    AND {$sms} NOT LIKE '[AUTO_RENEW|NET_PROFIT|%'
                )";
        case 'PAYMENT':
            return " AND (
                    ({$emptyDesc} AND {$hasFrom})
                    OR {$desc} LIKE 'PAYMENT FROM %'
                )
                AND {$sms} NOT LIKE '[DOMAIN_SHARE_COMMISSION|%'
                AND {$sms} NOT LIKE '[AUTO_RENEW|COMMISSION|%'
                AND {$sms} NOT LIKE '[DOMAIN_NET_PROFIT|%'
                AND {$sms} NOT LIKE '[AUTO_RENEW|NET_PROFIT|%'
                AND {$sms} NOT LIKE '[DOMAIN_LIST_FEE|%'
                AND {$desc} NOT LIKE 'DOMAIN LIST FEE FROM %'
                AND {$desc} NOT LIKE 'PAY DOMAIN FEE%'
                AND NOT (
                    {$sms} LIKE '[AUTO_RENEW|%'
                    AND {$sms} NOT LIKE '[AUTO_RENEW|COMMISSION|%'
                    AND {$sms} NOT LIKE '[AUTO_RENEW|NET_PROFIT|%'
                )";
        case 'CONTRA':
            return " AND (
                    ({$emptyDesc} AND {$hasFrom})
                    OR {$desc} LIKE 'CONTRA FROM %'
                )";
        case 'CLAIM':
            return " AND (
                    ({$emptyDesc} AND {$hasFrom})
                    OR {$desc} LIKE 'CLAIM FROM %'
                )";
        case 'CLEAR':
            return " AND (
                    ({$emptyDesc} AND {$hasFrom})
                    OR {$desc} LIKE 'CLEAR FROM %'
                )";
        case 'ADJUSTMENT':
            return " AND (
                    {$emptyDesc}
                    OR {$desc} LIKE 'ADJUSTMENT - WIN/LOSS%'
                )";
        case 'PROFIT':
            return " AND {$alias}.transaction_type IN ('WIN', 'LOSE')"
                . typeTxSearchManualProfitDescriptionExcludeSql($alias);
        default:
            return '';
    }
}

function typeTxSearchNormalizeHistoryDescription(string $description): string
{
    $desc = strtoupper(trim($description));
    if (strpos($desc, '[PENDING APPROVAL] ') === 0) {
        $desc = trim(substr($desc, strlen('[PENDING APPROVAL] ')));
    }

    return $desc;
}

function typeTxSearchPureHistoryRowFromEvent(array $event): array
{
    return [
        'transaction_type' => (string) ($event['transaction_type'] ?? ''),
        'description' => (string) ($event['raw_transaction_description'] ?? ($event['description'] ?? '')),
        'sms' => (string) ($event['raw_transaction_sms'] ?? ($event['sms'] ?? '')),
        'from_account_code' => (string) ($event['raw_from_account_code'] ?? ''),
    ];
}

/**
 * Payment History (Type Search drill-down): keep rows that match the same pure manual rules as the grid.
 *
 * @param array<string, mixed> $event
 */
function typeTxSearchPassesPureHistoryEvent(string $formType, array $event): bool
{
    $formType = strtoupper(trim($formType));
    if (!typeTxSearchSupportsPureManualFilter($formType)) {
        return true;
    }
    if (($event['row_type'] ?? '') !== 'transaction') {
        return false;
    }

    $txType = strtoupper(trim((string) ($event['transaction_type'] ?? '')));
    $desc = typeTxSearchNormalizeHistoryDescription((string) ($event['description'] ?? ''));
    $rawSms = trim((string) ($event['raw_transaction_sms'] ?? ''));
    $sms = $rawSms !== '' ? $rawSms : (string) ($event['sms'] ?? '');
    if ($sms === '-') {
        $sms = '';
    }

    switch ($formType) {
        case 'PAYMENT':
            if ($txType !== 'PAYMENT') {
                return false;
            }
            if (typeTxSearchPassesPureManualFilter('PAYMENT', typeTxSearchPureHistoryRowFromEvent($event))) {
                return true;
            }
            if (!empty($event['is_view_to_account'])) {
                return strpos($desc, 'PAYMENT FROM ') === 0
                    && !typeTxSearchIsExcludedNonManualPayment($sms, $desc);
            }

            return strpos($desc, 'PAYMENT TO ') === 0
                && !typeTxSearchIsExcludedNonManualPayment($sms, $desc);
        case 'CONTRA':
            if ($txType !== 'CONTRA') {
                return false;
            }
            if (typeTxSearchPassesPureManualFilter('CONTRA', typeTxSearchPureHistoryRowFromEvent($event))) {
                return true;
            }
            if (!empty($event['is_view_to_account'])) {
                return strpos($desc, 'CONTRA FROM ') === 0;
            }

            return strpos($desc, 'CONTRA TO ') === 0;
        case 'CLAIM':
            if ($txType !== 'CLAIM') {
                return false;
            }
            if (typeTxSearchPassesPureManualFilter('CLAIM', typeTxSearchPureHistoryRowFromEvent($event))) {
                return true;
            }
            if (!empty($event['is_view_to_account'])) {
                return strpos($desc, 'CLAIM FROM ') === 0;
            }

            return strpos($desc, 'CLAIM TO ') === 0;
        case 'CLEAR':
            if ($txType !== 'CLEAR') {
                return false;
            }
            if (typeTxSearchPassesPureManualFilter('CLEAR', typeTxSearchPureHistoryRowFromEvent($event))) {
                return true;
            }
            if (!empty($event['is_view_to_account'])) {
                return strpos($desc, 'CLEAR FROM ') === 0;
            }

            return strpos($desc, 'CLEAR TO ') === 0;
        case 'ADJUSTMENT':
            if (typeTxSearchPassesPureManualFilter('ADJUSTMENT', typeTxSearchPureHistoryRowFromEvent($event))) {
                return true;
            }

            return $txType === 'ADJUSTMENT' && strpos($desc, 'ADJUSTMENT - WIN/LOSS') === 0;
        case 'PROFIT':
            if (!in_array($txType, ['WIN', 'LOSE'], true)) {
                return false;
            }
            if (typeTxSearchPassesPureManualFilter('PROFIT', typeTxSearchPureHistoryRowFromEvent($event))) {
                return true;
            }
            if (!empty($event['is_view_to_account'])) {
                return strpos($desc, 'PROFIT FROM ') === 0;
            }

            return strpos($desc, 'PROFIT TO ') === 0;
        case 'RATE':
            if ($txType !== 'RATE' && strtoupper(trim((string) ($event['source'] ?? ''))) !== 'RATE') {
                return false;
            }
            $entryType = strtoupper(trim((string) ($event['entry_type'] ?? '')));
            if ($entryType === 'RATE_MIDDLEMAN') {
                return false;
            }
            $raw = trim((string) ($event['entry_description_raw'] ?? ''));
            if ($raw !== '' && typeTxSearchIsPureRateEntryDescription($raw)) {
                return true;
            }
            if (preg_match('/^TRANSACTION (FROM|TO) .+ \(RATE: .+\)$/i', $desc)) {
                return true;
            }

            return (bool) preg_match('/^EXCH RATE .+ \| (FROM|TO) .+$/i', $desc);
        default:
            return true;
    }
}
