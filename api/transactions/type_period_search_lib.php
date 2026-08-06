<?php
/**
 * Type Search × Capture Date: period-scoped metrics with all-time account eligibility.
 * Phase 1: CONTRA / PAYMENT / CLAIM / CLEAR (Cr/Dr) + RATE / ADJUSTMENT + PROFIT (Win/Loss).
 */

require_once __DIR__ . '/transaction_scope.php';
require_once __DIR__ . '/type_pure_manual_filter_lib.php';
require_once __DIR__ . '/type_account_search_lib.php';
require_once __DIR__ . '/dcd_processed_quant.php';
require_once __DIR__ . '/../includes/transaction_approval.php';
require_once __DIR__ . '/../includes/money_decimal.php';

function typePeriodSearchTxnHasCurrencyId(PDO $pdo): bool
{
    static $has = null;
    if ($has !== null) {
        return $has;
    }
    try {
        $st = $pdo->query("SHOW COLUMNS FROM transactions LIKE 'currency_id'");
        $has = $st && $st->rowCount() > 0;
    } catch (Throwable $e) {
        $has = false;
    }

    return $has;
}

/**
 * @return array{sql: string, bind: int}
 */
function typePeriodSearchCurrencyJoin(PDO $pdo, array $listScope): array
{
    $isGroup = (($listScope['mode'] ?? '') === 'group');
    $groupScopeId = (int) ($listScope['group_scope_id'] ?? 0);
    if (
        $isGroup
        && function_exists('tenant_table_has_scope_columns')
        && tenant_table_has_scope_columns($pdo, 'currency')
        && $groupScopeId > 0
    ) {
        return [
            'sql' => "INNER JOIN currency c ON t.currency_id = c.id AND c.scope_type = 'group' AND c.scope_id = ?",
            'bind' => $groupScopeId,
        ];
    }

    $permId = tx_permission_company_id_for_scope($pdo, $listScope);
    $subsidiarySql = function_exists('tenant_sql_currency_subsidiary_only')
        ? tenant_sql_currency_subsidiary_only($pdo, 'c')
        : '';

    return [
        'sql' => "INNER JOIN currency c ON t.currency_id = c.id AND c.company_id = ?{$subsidiarySql}",
        'bind' => $permId > 0 ? $permId : (int) ($listScope['company_id'] ?? 0),
    ];
}

/**
 * @return string[]
 */
function typePeriodSearchSupportedFormTypes(): array
{
    return ['CONTRA', 'PAYMENT', 'CLAIM', 'CLEAR', 'RATE', 'ADJUSTMENT', 'PROFIT', 'ALL'];
}

function typePeriodSearchIsDualSideManualType(string $formType): bool
{
    return in_array(strtoupper(trim($formType)), ['CONTRA', 'PAYMENT', 'CLAIM', 'CLEAR'], true);
}

function typePeriodSearchIsAdjustmentType(string $formType): bool
{
    return strtoupper(trim($formType)) === 'ADJUSTMENT';
}

function typePeriodSearchIsRateType(string $formType): bool
{
    return strtoupper(trim($formType)) === 'RATE';
}

function typePeriodSearchIsProfitType(string $formType): bool
{
    return strtoupper(trim($formType)) === 'PROFIT';
}

function typePeriodSearchIsPeriodTypeSearch(string $formType): bool
{
    return typePeriodSearchIsSupported($formType);
}

function typePeriodSearchIsSupported(string $formType): bool
{
    return in_array(strtoupper(trim($formType)), typePeriodSearchSupportedFormTypes(), true);
}

/**
 * List visibility: only accounts with type activity inside Capture Date (B/F still type-only before period).
 */
function typePeriodSearchFilterByPeriodActivityOnly(string $formType): bool
{
    return typePeriodSearchIsPeriodTypeSearch($formType);
}

/**
 * Type Search grid metrics from full account ledger (aligned with Payment History).
 * B/F, Win/Loss, Cr/Dr use calculateBFByCurrency + history-column alignment.
 * RATE (−amount) / ADJUSTMENT (+amount) sign rules in typePeriodSearchBulk*Metrics remain for period_txn_count only.
 * List visibility uses Capture Date union of all pure manual types (see BulkUnionPeriodActivityMetrics).
 * ALL = Type Search ignores right-side form type for metrics (same native ledger path).
 */
function typePeriodSearchUsesAccountNativeBf(string $formType): bool
{
    return in_array(strtoupper(trim($formType)), ['PAYMENT', 'CONTRA', 'CLAIM', 'CLEAR', 'RATE', 'ADJUSTMENT', 'PROFIT', 'ALL'], true);
}

/**
 * PROFIT Type Search: Win/Loss = pure PROFIT period total; Cr/Dr = Balance − B/F − Win/Loss; Balance = History closing.
 */
function typePeriodSearchUsesProfitWinLossColumn(string $formType): bool
{
    return typePeriodSearchIsProfitType($formType);
}

/**
 * Accounts that ever had pure manual CONTRA, PAYMENT, CLAIM, or PROFIT (To or From side).
 *
 * @return int[]
 */
function typePeriodSearchFetchEligibleAccountIds(PDO $pdo, array $listScope, string $formType): array
{
    $formType = strtoupper(trim($formType));
    if (!typePeriodSearchIsSupported($formType)) {
        return typeAccountSearchFetchAccountIds($pdo, $listScope, $formType);
    }
    if (typePeriodSearchIsRateType($formType)) {
        return typePeriodSearchFetchRateEligibleAccountIds($pdo, $listScope);
    }

    $txnFilter = tx_search_transaction_filter($pdo, $listScope, 't');
    $approvalSql = tx_sql_transaction_approval_where($pdo, 't');
    $bankDescSql = typeAccountSearchBankProcessDescriptionExcludeSql('t');
    $bankSrcSql = typeAccountSearchHasSourceBankProcessColumn($pdo)
        ? typeAccountSearchSourceBankProcessExcludeSql('t')
        : '';
    $pureManualSql = typeTxSearchPureManualSqlFragment($formType, 't');
    $txnTypeSql = typePeriodSearchIsProfitType($formType)
        ? "t.transaction_type IN ('WIN', 'LOSE')"
        : ($formType === 'ALL'
            ? "t.transaction_type IN ('CONTRA', 'PAYMENT', 'CLAIM', 'CLEAR', 'RATE', 'ADJUSTMENT')"
            : 't.transaction_type = ' . $pdo->quote($formType));

    $queries = [
        "SELECT DISTINCT t.account_id AS account_id
         FROM transactions t
         WHERE {$txnFilter['sql']}
           AND t.account_id IS NOT NULL
           AND t.account_id > 0
           AND {$txnTypeSql}
           {$approvalSql}
           {$bankDescSql}
           {$bankSrcSql}
           {$pureManualSql}",
    ];
    if (!typePeriodSearchIsAdjustmentType($formType)) {
        $queries[] = "SELECT DISTINCT t.from_account_id AS account_id
         FROM transactions t
         WHERE {$txnFilter['sql']}
           AND t.from_account_id IS NOT NULL
           AND t.from_account_id > 0
           AND {$txnTypeSql}
           {$approvalSql}
           {$bankDescSql}
           {$bankSrcSql}
           {$pureManualSql}";
    }

    $ids = [];
    foreach ($queries as $sql) {
        $stmt = $pdo->prepare($sql);
        $stmt->execute([(int) $txnFilter['bind']]);
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $id = (int) ($row['account_id'] ?? 0);
            if ($id > 0) {
                $ids[$id] = true;
            }
        }
    }

    $result = array_map('intval', array_keys($ids));
    if ($formType === 'ALL') {
        // PROFIT (WIN/LOSE) + RATE (transaction_entry) are not covered by the ALL
        // description filter on transactions — merge like dedicated type fetches.
        $extraIds = array_merge(
            typePeriodSearchFetchEligibleAccountIds($pdo, $listScope, 'PROFIT'),
            typePeriodSearchFetchRateEligibleAccountIds($pdo, $listScope)
        );
        if ($extraIds !== []) {
            $merged = [];
            foreach (array_merge($result, $extraIds) as $id) {
                $merged[(int) $id] = true;
            }
            $result = array_map('intval', array_keys($merged));
        }
    }

    return $result;
}

/**
 * @param array<int, array<int, string>> $bucket
 */
function typePeriodSearchAccumulateBucketRow(array &$bucket, int $accountId, int $currencyId, string $amount): void
{
    if ($accountId <= 0 || $currencyId <= 0) {
        return;
    }
    $bucket[$accountId][$currencyId] = money_add($bucket[$accountId][$currencyId] ?? '0', money_out($amount), 8);
}

/**
 * @param 'to'|'from' $side
 * @param int[] $accountIds
 * @param string[] $currencyCodes
 * @return array{
 *   bf: array<int, array<int, string>>,
 *   cr_dr: array<int, array<int, string>>,
 *   currencies: array<int, array<int, string>>,
 *   period_txn_count: array<int, array<int, int>>
 * }
 */
function typePeriodSearchFetchManualSideMetrics(
    PDO $pdo,
    array $listScope,
    string $formType,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes,
    string $side
): array {
    $formType = strtoupper(trim($formType));
    $empty = ['bf' => [], 'cr_dr' => [], 'currencies' => [], 'period_txn_count' => []];
    $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds), static fn (int $id): bool => $id > 0)));
    if ($accountIds === [] || !in_array($side, ['to', 'from'], true) || !typePeriodSearchIsDualSideManualType($formType)) {
        return $empty;
    }

    $txnFilter = tx_search_transaction_filter($pdo, $listScope, 't');
    $approvalSql = tx_sql_transaction_approval_where($pdo, 't');
    $bankDescSql = typeAccountSearchBankProcessDescriptionExcludeSql('t');
    $bankSrcSql = typeAccountSearchHasSourceBankProcessColumn($pdo)
        ? typeAccountSearchSourceBankProcessExcludeSql('t')
        : '';
    $pureManualSql = typeTxSearchPureManualSqlFragment($formType, 't');
    $signedAmt = $side === 'to'
        ? dcd_processed_amount_sql_quant2('(-t.amount)')
        : dcd_processed_amount_sql_quant2('t.amount');
    $dateExpr = 'DATE(t.transaction_date)';
    $accountCol = $side === 'to' ? 't.account_id' : 't.from_account_id';
    $txnType = $pdo->quote($formType);

    $accPh = implode(',', array_fill(0, count($accountIds), '?'));
    $sql = "SELECT
                {$accountCol} AS account_id,
                t.currency_id,
                COALESCE((
                    SELECT UPPER(TRIM(c2.code))
                    FROM currency c2
                    WHERE c2.id = t.currency_id
                    LIMIT 1
                ), '') AS currency_code,
                COALESCE(SUM(CASE WHEN {$dateExpr} < ? THEN {$signedAmt} ELSE 0 END), 0) AS bf_total,
                COALESCE(SUM(CASE WHEN {$dateExpr} BETWEEN ? AND ? THEN {$signedAmt} ELSE 0 END), 0) AS cr_dr_total,
                COUNT(CASE WHEN {$dateExpr} BETWEEN ? AND ? THEN 1 END) AS period_txn_count
            FROM transactions t
            WHERE {$txnFilter['sql']}
              AND {$accountCol} IN ({$accPh})
              AND t.transaction_type = {$txnType}
              AND t.currency_id IS NOT NULL
              {$approvalSql}
              {$bankDescSql}
              {$bankSrcSql}
              {$pureManualSql}";

    $params = [
        $dateFromDb,
        $dateFromDb,
        $dateToDb,
        $dateFromDb,
        $dateToDb,
        (int) $txnFilter['bind'],
    ];
    $params = array_merge($params, $accountIds);

    if ($currencyCodes !== []) {
        $curPh = implode(',', array_fill(0, count($currencyCodes), '?'));
        $sql .= " AND EXISTS (
            SELECT 1
            FROM currency c
            WHERE c.id = t.currency_id
              AND UPPER(TRIM(c.code)) IN ({$curPh})
        )";
        $params = array_merge($params, $currencyCodes);
    }

    $sql .= " GROUP BY {$accountCol}, t.currency_id";

    $bf = [];
    $crDr = [];
    $currencies = [];
    $periodTxnCount = [];
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $aid = (int) ($row['account_id'] ?? 0);
        $cid = (int) ($row['currency_id'] ?? 0);
        $code = strtoupper(trim((string) ($row['currency_code'] ?? '')));
        if ($aid <= 0 || $cid <= 0 || $code === '') {
            continue;
        }
        $bf[$aid][$cid] = money_out($row['bf_total'] ?? '0');
        $crDr[$aid][$cid] = money_out($row['cr_dr_total'] ?? '0');
        $currencies[$aid][$cid] = $code;
        $periodTxnCount[$aid][$cid] = (int) ($row['period_txn_count'] ?? 0);
    }

    return [
        'bf' => $bf,
        'cr_dr' => $crDr,
        'currencies' => $currencies,
        'period_txn_count' => $periodTxnCount,
    ];
}

/**
 * Manual PROFIT (WIN/LOSE) period metrics — amounts in win_loss bucket (not cr_dr).
 *
 * @param 'to'|'from' $side
 * @param int[] $accountIds
 * @param string[] $currencyCodes
 * @return array{
 *   bf: array<int, array<int, string>>,
 *   win_loss: array<int, array<int, string>>,
 *   currencies: array<int, array<int, string>>,
 *   period_txn_count: array<int, array<int, int>>
 * }
 */
function typePeriodSearchFetchProfitSideMetrics(
    PDO $pdo,
    array $listScope,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes,
    string $side
): array {
    $empty = ['bf' => [], 'win_loss' => [], 'currencies' => [], 'period_txn_count' => []];
    $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds), static fn (int $id): bool => $id > 0)));
    if ($accountIds === [] || !in_array($side, ['to', 'from'], true)) {
        return $empty;
    }

    $txnFilter = tx_search_transaction_filter($pdo, $listScope, 't');
    $approvalSql = tx_sql_transaction_approval_where($pdo, 't');
    $bankDescSql = typeAccountSearchBankProcessDescriptionExcludeSql('t');
    $bankSrcSql = typeAccountSearchHasSourceBankProcessColumn($pdo)
        ? typeAccountSearchSourceBankProcessExcludeSql('t')
        : '';
    $pureManualSql = typeTxSearchPureManualSqlFragment('PROFIT', 't');
    $signedAmt = $side === 'to'
        ? "CASE
                WHEN t.transaction_type = 'WIN' THEN " . dcd_processed_amount_sql_quant2('(-t.amount)') . "
                WHEN t.transaction_type = 'LOSE' THEN " . dcd_processed_amount_sql_quant2('t.amount') . "
                ELSE 0
            END"
        : "CASE
                WHEN t.transaction_type = 'WIN' THEN " . dcd_processed_amount_sql_quant2('t.amount') . "
                WHEN t.transaction_type = 'LOSE' THEN " . dcd_processed_amount_sql_quant2('(-t.amount)') . "
                ELSE 0
            END";
    $dateExpr = 'DATE(t.transaction_date)';
    $accountCol = $side === 'to' ? 't.account_id' : 't.from_account_id';

    $accPh = implode(',', array_fill(0, count($accountIds), '?'));
    $sql = "SELECT
                {$accountCol} AS account_id,
                t.currency_id,
                COALESCE((
                    SELECT UPPER(TRIM(c2.code))
                    FROM currency c2
                    WHERE c2.id = t.currency_id
                    LIMIT 1
                ), '') AS currency_code,
                COALESCE(SUM(CASE WHEN {$dateExpr} < ? THEN {$signedAmt} ELSE 0 END), 0) AS bf_total,
                COALESCE(SUM(CASE WHEN {$dateExpr} BETWEEN ? AND ? THEN {$signedAmt} ELSE 0 END), 0) AS win_loss_total,
                COUNT(CASE WHEN {$dateExpr} BETWEEN ? AND ? THEN 1 END) AS period_txn_count
            FROM transactions t
            WHERE {$txnFilter['sql']}
              AND {$accountCol} IN ({$accPh})
              AND t.transaction_type IN ('WIN', 'LOSE')
              AND t.currency_id IS NOT NULL
              {$approvalSql}
              {$bankDescSql}
              {$bankSrcSql}
              {$pureManualSql}";

    $params = [
        $dateFromDb,
        $dateFromDb,
        $dateToDb,
        $dateFromDb,
        $dateToDb,
        (int) $txnFilter['bind'],
    ];
    $params = array_merge($params, $accountIds);

    if ($currencyCodes !== []) {
        $curPh = implode(',', array_fill(0, count($currencyCodes), '?'));
        $sql .= " AND EXISTS (
            SELECT 1
            FROM currency c
            WHERE c.id = t.currency_id
              AND UPPER(TRIM(c.code)) IN ({$curPh})
        )";
        $params = array_merge($params, $currencyCodes);
    }

    $sql .= " GROUP BY {$accountCol}, t.currency_id";

    $bf = [];
    $winLoss = [];
    $currencies = [];
    $periodTxnCount = [];
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $aid = (int) ($row['account_id'] ?? 0);
        $cid = (int) ($row['currency_id'] ?? 0);
        $code = strtoupper(trim((string) ($row['currency_code'] ?? '')));
        if ($aid <= 0 || $cid <= 0 || $code === '') {
            continue;
        }
        $bf[$aid][$cid] = money_out($row['bf_total'] ?? '0');
        $winLoss[$aid][$cid] = money_out($row['win_loss_total'] ?? '0');
        $currencies[$aid][$cid] = $code;
        $periodTxnCount[$aid][$cid] = (int) ($row['period_txn_count'] ?? 0);
    }

    return [
        'bf' => $bf,
        'win_loss' => $winLoss,
        'currencies' => $currencies,
        'period_txn_count' => $periodTxnCount,
    ];
}

/**
 * Bulk pure manual PROFIT metrics (Win/Loss column; To/From WIN/LOSE signs per history).
 *
 * @param int[] $accountIds
 * @param string[] $currencyCodes upper codes; empty = all
 * @return array{
 *   bf: array<int, array<int, string>>,
 *   win_loss: array<int, array<int, string>>,
 *   cr_dr: array<int, array<int, string>>,
 *   currencies: array<int, array<int, string>>,
 *   period_txn_count: array<int, array<int, int>>
 * }
 */
function typePeriodSearchBulkProfitMetrics(
    PDO $pdo,
    array $listScope,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes = []
): array {
    $empty = ['bf' => [], 'win_loss' => [], 'cr_dr' => [], 'currencies' => [], 'period_txn_count' => []];
    $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds), static fn (int $id): bool => $id > 0)));
    if ($accountIds === []) {
        return $empty;
    }

    if (!typePeriodSearchTxnHasCurrencyId($pdo)) {
        return $empty;
    }

    $currencyCodes = array_values(array_unique(array_filter(array_map(
        static fn ($c) => strtoupper(trim((string) $c)),
        $currencyCodes
    ), static fn (string $c): bool => $c !== '')));

    $toSide = typePeriodSearchFetchProfitSideMetrics(
        $pdo,
        $listScope,
        $dateFromDb,
        $dateToDb,
        $accountIds,
        $currencyCodes,
        'to'
    );
    $fromSide = typePeriodSearchFetchProfitSideMetrics(
        $pdo,
        $listScope,
        $dateFromDb,
        $dateToDb,
        $accountIds,
        $currencyCodes,
        'from'
    );

    $bf = [];
    $winLoss = [];
    $currencies = [];
    $periodTxnCount = [];
    foreach ([$toSide, $fromSide] as $sidePack) {
        foreach ($sidePack['bf'] ?? [] as $aid => $byCur) {
            foreach ($byCur as $cid => $amt) {
                typePeriodSearchAccumulateBucketRow($bf, (int) $aid, (int) $cid, $amt);
            }
        }
        foreach ($sidePack['win_loss'] ?? [] as $aid => $byCur) {
            foreach ($byCur as $cid => $amt) {
                typePeriodSearchAccumulateBucketRow($winLoss, (int) $aid, (int) $cid, $amt);
            }
        }
        foreach ($sidePack['currencies'] ?? [] as $aid => $byCur) {
            foreach ($byCur as $cid => $code) {
                $currencies[(int) $aid][(int) $cid] = (string) $code;
            }
        }
        foreach ($sidePack['period_txn_count'] ?? [] as $aid => $byCur) {
            foreach ($byCur as $cid => $cnt) {
                $aidInt = (int) $aid;
                $cidInt = (int) $cid;
                $periodTxnCount[$aidInt][$cidInt] = ($periodTxnCount[$aidInt][$cidInt] ?? 0) + (int) $cnt;
            }
        }
    }

    return [
        'bf' => $bf,
        'win_loss' => $winLoss,
        'cr_dr' => [],
        'currencies' => $currencies,
        'period_txn_count' => $periodTxnCount,
    ];
}

/**
 * @return int[]
 */
function typePeriodSearchFetchRateEligibleAccountIds(PDO $pdo, array $listScope): array
{
    $hFilter = tx_search_transaction_filter($pdo, $listScope, 'h');
    $permCompanyId = tx_permission_company_id_for_scope($pdo, $listScope);
    $isGroup = (($listScope['mode'] ?? '') === 'group');
    $companyJoin = $isGroup
        ? ''
        : ' INNER JOIN account_company ac ON ac.account_id = e.account_id AND ac.company_id = ?';
    $pureRateSql = typeTxSearchPureRateEntrySqlFragment('e');

    // Exchange legs need pure RATE description; Middle-Man (MARKUP) is RATE_MIDDLEMAN.
    $sql = "SELECT DISTINCT e.account_id AS account_id
            FROM transaction_entry e
            JOIN transactions h ON e.header_id = h.id
            JOIN account acc ON e.account_id = acc.id
            {$companyJoin}
            WHERE {$hFilter['sql']}
              AND h.transaction_type = 'RATE'
              AND e.account_id IS NOT NULL
              AND e.account_id > 0
              AND (
                    (
                      e.entry_type IN ('RATE_FIRST_FROM', 'RATE_FIRST_TO', 'RATE_TRANSFER_FROM', 'RATE_TRANSFER_TO')
                      {$pureRateSql}
                    )
                    OR e.entry_type = 'RATE_MIDDLEMAN'
              )";

    $params = [(int) $hFilter['bind']];
    if (!$isGroup) {
        $params[] = $permCompanyId > 0 ? $permCompanyId : (int) ($listScope['company_id'] ?? 0);
    }

    $ids = [];
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $id = (int) ($row['account_id'] ?? 0);
        if ($id > 0) {
            $ids[$id] = true;
        }
    }

    return array_map('intval', array_keys($ids));
}

/**
 * Pure ADJUSTMENT - WIN/LOSS on To account; +amount in Cr/Dr (not Win/Loss negation).
 *
 * @param int[] $accountIds
 * @param string[] $currencyCodes
 * @return array{
 *   bf: array<int, array<int, string>>,
 *   cr_dr: array<int, array<int, string>>,
 *   currencies: array<int, array<int, string>>,
 *   period_txn_count: array<int, array<int, int>>
 * }
 */
function typePeriodSearchBulkAdjustmentMetrics(
    PDO $pdo,
    array $listScope,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes = []
): array {
    $empty = ['bf' => [], 'cr_dr' => [], 'currencies' => [], 'period_txn_count' => []];
    $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds), static fn (int $id): bool => $id > 0)));
    if ($accountIds === [] || !typePeriodSearchTxnHasCurrencyId($pdo)) {
        return $empty;
    }

    $currencyCodes = array_values(array_unique(array_filter(array_map(
        static fn ($c) => strtoupper(trim((string) $c)),
        $currencyCodes
    ), static fn (string $c): bool => $c !== '')));

    $txnFilter = tx_search_transaction_filter($pdo, $listScope, 't');
    $approvalSql = tx_sql_transaction_approval_where($pdo, 't');
    $bankDescSql = typeAccountSearchBankProcessDescriptionExcludeSql('t');
    $bankSrcSql = typeAccountSearchHasSourceBankProcessColumn($pdo)
        ? typeAccountSearchSourceBankProcessExcludeSql('t')
        : '';
    $pureManualSql = typeTxSearchPureManualSqlFragment('ADJUSTMENT', 't');
    $signedAmt = dcd_processed_amount_sql_quant2('t.amount');
    $dateExpr = 'DATE(t.transaction_date)';
    $accPh = implode(',', array_fill(0, count($accountIds), '?'));

    $sql = "SELECT
                t.account_id AS account_id,
                t.currency_id,
                COALESCE((
                    SELECT UPPER(TRIM(c2.code))
                    FROM currency c2
                    WHERE c2.id = t.currency_id
                    LIMIT 1
                ), '') AS currency_code,
                COALESCE(SUM(CASE WHEN {$dateExpr} < ? THEN {$signedAmt} ELSE 0 END), 0) AS bf_total,
                COALESCE(SUM(CASE WHEN {$dateExpr} BETWEEN ? AND ? THEN {$signedAmt} ELSE 0 END), 0) AS cr_dr_total,
                COUNT(CASE WHEN {$dateExpr} BETWEEN ? AND ? THEN 1 END) AS period_txn_count
            FROM transactions t
            WHERE {$txnFilter['sql']}
              AND t.account_id IN ({$accPh})
              AND t.transaction_type = 'ADJUSTMENT'
              AND t.currency_id IS NOT NULL
              {$approvalSql}
              {$bankDescSql}
              {$bankSrcSql}
              {$pureManualSql}";

    $params = [
        $dateFromDb,
        $dateFromDb,
        $dateToDb,
        $dateFromDb,
        $dateToDb,
        (int) $txnFilter['bind'],
    ];
    $params = array_merge($params, $accountIds);

    if ($currencyCodes !== []) {
        $curPh = implode(',', array_fill(0, count($currencyCodes), '?'));
        $sql .= " AND EXISTS (
            SELECT 1
            FROM currency c
            WHERE c.id = t.currency_id
              AND UPPER(TRIM(c.code)) IN ({$curPh})
        )";
        $params = array_merge($params, $currencyCodes);
    }

    $sql .= ' GROUP BY t.account_id, t.currency_id';

    $bf = [];
    $crDr = [];
    $currencies = [];
    $periodTxnCount = [];
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $aid = (int) ($row['account_id'] ?? 0);
        $cid = (int) ($row['currency_id'] ?? 0);
        $code = strtoupper(trim((string) ($row['currency_code'] ?? '')));
        if ($aid <= 0 || $cid <= 0 || $code === '') {
            continue;
        }
        $bf[$aid][$cid] = money_out($row['bf_total'] ?? '0');
        $crDr[$aid][$cid] = money_out($row['cr_dr_total'] ?? '0');
        $currencies[$aid][$cid] = $code;
        $periodTxnCount[$aid][$cid] = (int) ($row['period_txn_count'] ?? 0);
    }

    return [
        'bf' => $bf,
        'cr_dr' => $crDr,
        'currencies' => $currencies,
        'period_txn_count' => $periodTxnCount,
    ];
}

/**
 * Pure manual RATE entries; -amount sign aligned with history_api / type_transaction_search_lib.
 *
 * @param int[] $accountIds
 * @param string[] $currencyCodes
 * @return array{
 *   bf: array<int, array<int, string>>,
 *   cr_dr: array<int, array<int, string>>,
 *   currencies: array<int, array<int, string>>,
 *   period_txn_count: array<int, array<int, int>>
 * }
 */
function typePeriodSearchBulkRateMetrics(
    PDO $pdo,
    array $listScope,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes = []
): array {
    $empty = ['bf' => [], 'cr_dr' => [], 'currencies' => [], 'period_txn_count' => []];
    $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds), static fn (int $id): bool => $id > 0)));
    if ($accountIds === []) {
        return $empty;
    }

    $currencyCodes = array_values(array_unique(array_filter(array_map(
        static fn ($c) => strtoupper(trim((string) $c)),
        $currencyCodes
    ), static fn (string $c): bool => $c !== '')));

    $hFilter = tx_search_transaction_filter($pdo, $listScope, 'h');
    $permCompanyId = tx_permission_company_id_for_scope($pdo, $listScope);
    $isGroup = (($listScope['mode'] ?? '') === 'group');
    $companyJoin = $isGroup
        ? ''
        : ' INNER JOIN account_company ac ON ac.account_id = e.account_id AND ac.company_id = ?';
    $pureRateSql = typeTxSearchPureRateEntrySqlFragment('e');
    $signedAmt = dcd_processed_amount_sql_quant2('(-e.amount)');
    $dateExpr = 'DATE(h.transaction_date)';
    $accPh = implode(',', array_fill(0, count($accountIds), '?'));
    $exchangeLeg = "e.entry_type IN ('RATE_FIRST_FROM', 'RATE_FIRST_TO', 'RATE_TRANSFER_FROM', 'RATE_TRANSFER_TO')";

    $sql = "SELECT
                e.account_id AS account_id,
                e.currency_id,
                COALESCE((
                    SELECT UPPER(TRIM(c2.code))
                    FROM currency c2
                    WHERE c2.id = e.currency_id
                    LIMIT 1
                ), '') AS currency_code,
                COALESCE(SUM(CASE
                    WHEN {$dateExpr} < ? AND {$exchangeLeg} THEN {$signedAmt}
                    ELSE 0
                END), 0) AS bf_total,
                COALESCE(SUM(CASE
                    WHEN {$dateExpr} BETWEEN ? AND ? AND {$exchangeLeg} THEN {$signedAmt}
                    ELSE 0
                END), 0) AS cr_dr_total,
                COUNT(CASE WHEN {$dateExpr} BETWEEN ? AND ? THEN 1 END) AS period_txn_count
            FROM transaction_entry e
            JOIN transactions h ON e.header_id = h.id
            JOIN account acc ON e.account_id = acc.id
            {$companyJoin}
            WHERE {$hFilter['sql']}
              AND e.account_id IN ({$accPh})
              AND h.transaction_type = 'RATE'
              AND e.currency_id IS NOT NULL
              AND (
                    (
                      {$exchangeLeg}
                      {$pureRateSql}
                    )
                    OR e.entry_type = 'RATE_MIDDLEMAN'
              )";

    $params = [
        $dateFromDb,
        $dateFromDb,
        $dateToDb,
        $dateFromDb,
        $dateToDb,
        (int) $hFilter['bind'],
    ];
    if (!$isGroup) {
        $params[] = $permCompanyId > 0 ? $permCompanyId : (int) ($listScope['company_id'] ?? 0);
    }
    $params = array_merge($params, $accountIds);

    if ($currencyCodes !== []) {
        $curPh = implode(',', array_fill(0, count($currencyCodes), '?'));
        $sql .= " AND EXISTS (
            SELECT 1
            FROM currency c
            WHERE c.id = e.currency_id
              AND UPPER(TRIM(c.code)) IN ({$curPh})
        )";
        $params = array_merge($params, $currencyCodes);
    }

    $sql .= ' GROUP BY e.account_id, e.currency_id';

    $bf = [];
    $crDr = [];
    $currencies = [];
    $periodTxnCount = [];
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $aid = (int) ($row['account_id'] ?? 0);
        $cid = (int) ($row['currency_id'] ?? 0);
        $code = strtoupper(trim((string) ($row['currency_code'] ?? '')));
        if ($aid <= 0 || $cid <= 0 || $code === '') {
            continue;
        }
        $bf[$aid][$cid] = money_out($row['bf_total'] ?? '0');
        $crDr[$aid][$cid] = money_out($row['cr_dr_total'] ?? '0');
        $currencies[$aid][$cid] = $code;
        $periodTxnCount[$aid][$cid] = (int) ($row['period_txn_count'] ?? 0);
    }

    return [
        'bf' => $bf,
        'cr_dr' => $crDr,
        'currencies' => $currencies,
        'period_txn_count' => $periodTxnCount,
    ];
}

/**
 * Period Type Search bulk metrics dispatcher (Cr/Dr types + PROFIT Win/Loss).
 *
 * @param int[] $accountIds
 * @param string[] $currencyCodes
 * @return array<string, mixed>
 */
function typePeriodSearchBulkTypeMetrics(
    PDO $pdo,
    array $listScope,
    string $formType,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes = []
): array {
    $formType = strtoupper(trim($formType));
    if (typePeriodSearchIsProfitType($formType)) {
        return typePeriodSearchBulkProfitMetrics(
            $pdo,
            $listScope,
            $dateFromDb,
            $dateToDb,
            $accountIds,
            $currencyCodes
        );
    }
    if (typePeriodSearchIsAdjustmentType($formType)) {
        return typePeriodSearchBulkAdjustmentMetrics(
            $pdo,
            $listScope,
            $dateFromDb,
            $dateToDb,
            $accountIds,
            $currencyCodes
        );
    }
    if (typePeriodSearchIsRateType($formType)) {
        return typePeriodSearchBulkRateMetrics(
            $pdo,
            $listScope,
            $dateFromDb,
            $dateToDb,
            $accountIds,
            $currencyCodes
        );
    }

    return typePeriodSearchBulkManualTypeMetrics(
        $pdo,
        $listScope,
        $formType,
        $dateFromDb,
        $dateToDb,
        $accountIds,
        $currencyCodes
    );
}

/**
 * Bulk pure manual CONTRA/PAYMENT metrics (To: -amount, From: +amount).
 *
 * @param int[] $accountIds
 * @param string[] $currencyCodes upper codes; empty = all
 * @return array{
 *   bf: array<int, array<int, string>>,
 *   cr_dr: array<int, array<int, string>>,
 *   currencies: array<int, array<int, string>>,
 *   period_txn_count: array<int, array<int, int>>
 * }
 */
function typePeriodSearchBulkManualTypeMetrics(
    PDO $pdo,
    array $listScope,
    string $formType,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes = []
): array {
    $formType = strtoupper(trim($formType));
    $empty = ['bf' => [], 'cr_dr' => [], 'currencies' => [], 'period_txn_count' => []];
    $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds), static fn (int $id): bool => $id > 0)));
    if ($accountIds === [] || !typePeriodSearchIsDualSideManualType($formType)) {
        return $empty;
    }

    if (!typePeriodSearchTxnHasCurrencyId($pdo)) {
        return $empty;
    }

    $currencyCodes = array_values(array_unique(array_filter(array_map(
        static fn ($c) => strtoupper(trim((string) $c)),
        $currencyCodes
    ), static fn (string $c): bool => $c !== '')));

    $toSide = typePeriodSearchFetchManualSideMetrics(
        $pdo,
        $listScope,
        $formType,
        $dateFromDb,
        $dateToDb,
        $accountIds,
        $currencyCodes,
        'to'
    );
    $fromSide = typePeriodSearchFetchManualSideMetrics(
        $pdo,
        $listScope,
        $formType,
        $dateFromDb,
        $dateToDb,
        $accountIds,
        $currencyCodes,
        'from'
    );

    $bf = [];
    $crDr = [];
    $currencies = [];
    $periodTxnCount = [];
    foreach ([$toSide, $fromSide] as $sidePack) {
        foreach ($sidePack['bf'] ?? [] as $aid => $byCur) {
            foreach ($byCur as $cid => $amt) {
                typePeriodSearchAccumulateBucketRow($bf, (int) $aid, (int) $cid, $amt);
            }
        }
        foreach ($sidePack['cr_dr'] ?? [] as $aid => $byCur) {
            foreach ($byCur as $cid => $amt) {
                typePeriodSearchAccumulateBucketRow($crDr, (int) $aid, (int) $cid, $amt);
            }
        }
        foreach ($sidePack['currencies'] ?? [] as $aid => $byCur) {
            foreach ($byCur as $cid => $code) {
                $currencies[(int) $aid][(int) $cid] = (string) $code;
            }
        }
        foreach ($sidePack['period_txn_count'] ?? [] as $aid => $byCur) {
            foreach ($byCur as $cid => $cnt) {
                $aidInt = (int) $aid;
                $cidInt = (int) $cid;
                $periodTxnCount[$aidInt][$cidInt] = ($periodTxnCount[$aidInt][$cidInt] ?? 0) + (int) $cnt;
            }
        }
    }

    return [
        'bf' => $bf,
        'cr_dr' => $crDr,
        'currencies' => $currencies,
        'period_txn_count' => $periodTxnCount,
    ];
}

/** @deprecated use typePeriodSearchBulkManualTypeMetrics */
function typePeriodSearchBulkContraMetrics(
    PDO $pdo,
    array $listScope,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes = []
): array {
    return typePeriodSearchBulkManualTypeMetrics(
        $pdo,
        $listScope,
        'CONTRA',
        $dateFromDb,
        $dateToDb,
        $accountIds,
        $currencyCodes
    );
}

/** @deprecated use typePeriodSearchFetchManualSideMetrics */
function typePeriodSearchFetchContraSideMetrics(
    PDO $pdo,
    array $listScope,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes,
    string $side
): array {
    return typePeriodSearchFetchManualSideMetrics(
        $pdo,
        $listScope,
        'CONTRA',
        $dateFromDb,
        $dateToDb,
        $accountIds,
        $currencyCodes,
        $side
    );
}

/**
 * @param array{
 *   bf?: array<int, array<int, string>>,
 *   cr_dr?: array<int, array<int, string>>,
 *   currencies?: array<int, array<int, string>>,
 *   period_txn_count?: array<int, array<int, int>>
 * } $bulk
 */
function typePeriodSearchPeriodTxnCountForCombo(
    array $bulk,
    int $accountId,
    int $currencyId,
    string $currencyCode = ''
): int {
    $bucket = $bulk['period_txn_count'] ?? [];
    if (isset($bucket[$accountId][$currencyId])) {
        return (int) $bucket[$accountId][$currencyId];
    }

    $wantCode = strtoupper(trim($currencyCode));
    if ($wantCode === '' || empty($bulk['currencies'][$accountId])) {
        return 0;
    }

    $total = 0;
    foreach ($bulk['currencies'][$accountId] as $cid => $code) {
        if (strtoupper(trim((string) $code)) !== $wantCode) {
            continue;
        }
        if (isset($bucket[$accountId][(int) $cid])) {
            $total += (int) $bucket[$accountId][(int) $cid];
        }
    }

    return $total;
}

/**
 * @param array{
 *   bf?: array<int, array<int, string>>,
 *   cr_dr?: array<int, array<int, string>>,
 *   currencies?: array<int, array<int, string>>,
 *   period_txn_count?: array<int, array<int, int>>
 * } $bulk
 */
function typePeriodSearchMetricForCombo(
    array $bulk,
    string $bucketKey,
    int $accountId,
    int $currencyId,
    string $currencyCode = ''
): string {
    $bucket = $bulk[$bucketKey] ?? [];
    if (isset($bucket[$accountId][$currencyId])) {
        return money_out($bucket[$accountId][$currencyId]);
    }

    $wantCode = strtoupper(trim($currencyCode));
    if ($wantCode === '' || empty($bulk['currencies'][$accountId])) {
        return '0.00';
    }

    $total = '0';
    foreach ($bulk['currencies'][$accountId] as $cid => $code) {
        if (strtoupper(trim((string) $code)) !== $wantCode) {
            continue;
        }
        if (isset($bucket[$accountId][(int) $cid])) {
            $total = money_add($total, $bucket[$accountId][(int) $cid], 8);
        }
    }

    return money_out($total);
}

/**
 * @param array<int, array<int, string>> $bucket
 */
function typePeriodSearchMetricFor(array $bucket, int $accountId, int $currencyId): string
{
    return money_out($bucket[$accountId][$currencyId] ?? '0');
}

/**
 * Supported form types for Type Search period-activity union (scheme B).
 *
 * @return string[]
 */
function typePeriodSearchUnionFormTypes(): array
{
    return ['CONTRA', 'PAYMENT', 'CLAIM', 'CLEAR', 'RATE', 'ADJUSTMENT', 'PROFIT'];
}

/**
 * Capture Date union: account+currency visible when ANY pure manual type has period activity.
 * Used for Type Search list visibility — independent of the right-side form type.
 *
 * @param int[] $accountIds
 * @param string[] $currencyCodes
 * @return array{
 *   period_txn_count: array<int, array<int, int>>,
 *   currencies: array<int, array<int, string>>
 * }
 */
function typePeriodSearchBulkUnionPeriodActivityMetrics(
    PDO $pdo,
    array $listScope,
    string $dateFromDb,
    string $dateToDb,
    array $accountIds,
    array $currencyCodes = []
): array {
    $merged = ['period_txn_count' => [], 'currencies' => []];
    $accountIds = array_values(array_unique(array_filter(array_map('intval', $accountIds), static fn (int $id): bool => $id > 0)));
    if ($accountIds === []) {
        return $merged;
    }

    foreach (typePeriodSearchUnionFormTypes() as $formType) {
        if (!typePeriodSearchIsSupported($formType)) {
            continue;
        }
        $pack = typePeriodSearchBulkTypeMetrics(
            $pdo,
            $listScope,
            $formType,
            $dateFromDb,
            $dateToDb,
            $accountIds,
            $currencyCodes
        );
        foreach ($pack['period_txn_count'] ?? [] as $aid => $byCur) {
            $aidInt = (int) $aid;
            foreach ($byCur as $cid => $cnt) {
                $cidInt = (int) $cid;
                $n = (int) $cnt;
                if ($aidInt <= 0 || $cidInt <= 0 || $n <= 0) {
                    continue;
                }
                $merged['period_txn_count'][$aidInt][$cidInt] = ($merged['period_txn_count'][$aidInt][$cidInt] ?? 0) + $n;
            }
        }
        foreach ($pack['currencies'] ?? [] as $aid => $byCur) {
            $aidInt = (int) $aid;
            foreach ($byCur as $cid => $code) {
                $cidInt = (int) $cid;
                $curCode = strtoupper(trim((string) $code));
                if ($aidInt <= 0 || $cidInt <= 0 || $curCode === '') {
                    continue;
                }
                if ((int) ($merged['period_txn_count'][$aidInt][$cidInt] ?? 0) <= 0) {
                    continue;
                }
                $merged['currencies'][$aidInt][$cidInt] = $curCode;
            }
        }
    }

    return $merged;
}
