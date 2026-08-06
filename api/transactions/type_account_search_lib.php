<?php
/**
 * Shared helpers for type_account_search_api — accounts that ever had a given transaction type.
 * Classification aligns with Payment Maintenance (transaction_type + bank-process exclusions).
 */

require_once __DIR__ . '/transaction_scope.php';
require_once __DIR__ . '/../../includes/permissions.php';
require_once __DIR__ . '/../includes/transaction_approval.php';

/**
 * @return array{sql: string, bind: int, is_group: bool}
 */
function typeAccountSearchScopeFilter(PDO $pdo, array $listScope, string $alias, string $table = 'transactions'): array
{
    $isGroup = (($listScope['mode'] ?? '') === 'group');
    if (tx_table_has_scope_column($pdo, $table)) {
        $sql = tx_sql_transaction_scope_where($listScope, $alias);
        if (!$isGroup) {
            $sql .= tx_sql_transaction_company_ledger_only($alias);
        }

        return [
            'sql' => $sql,
            'bind' => tx_bind_transaction_scope_id($listScope),
            'is_group' => $isGroup,
        ];
    }
    $permId = tx_permission_company_id_for_scope($pdo, $listScope);

    return [
        'sql' => "{$alias}.company_id = ?",
        'bind' => $permId,
        'is_group' => $isGroup,
    ];
}

function typeAccountSearchBankProcessDescriptionExcludeSql(string $alias = 't'): string
{
    return " AND NOT (
        UPPER(TRIM(COALESCE({$alias}.description, ''))) LIKE 'PROCESS: BUY PRICE%'
        OR UPPER(TRIM(COALESCE({$alias}.description, ''))) LIKE 'PROCESS: SELL PRICE%'
        OR UPPER(TRIM(COALESCE({$alias}.description, ''))) LIKE 'PROCESS: PROFIT FOR%'
        OR UPPER(TRIM(COALESCE({$alias}.description, ''))) LIKE 'PROCESS: PROFIT SHARING%'
        OR UPPER(TRIM(COALESCE({$alias}.description, ''))) LIKE 'AUTO: BUY PRICE%'
        OR UPPER(TRIM(COALESCE({$alias}.description, ''))) LIKE 'AUTO: SELL PRICE%'
        OR UPPER(TRIM(COALESCE({$alias}.description, ''))) LIKE 'AUTO: PROFIT FOR%'
    )";
}

function typeAccountSearchHasSourceBankProcessColumn(PDO $pdo): bool
{
    static $has = null;
    if ($has !== null) {
        return $has;
    }
    try {
        $st = $pdo->query("SHOW COLUMNS FROM transactions LIKE 'source_bank_process_id'");
        $has = $st && $st->rowCount() > 0;
    } catch (Throwable $e) {
        $has = false;
    }

    return $has;
}

function typeAccountSearchSourceBankProcessExcludeSql(string $alias = 't'): string
{
    return " AND ({$alias}.source_bank_process_id IS NULL OR {$alias}.source_bank_process_id = 0)";
}

/**
 * Map Transaction Payment form type → DB transaction_type list (PM-aligned; RECEIVE excluded from CONTRA).
 *
 * @return array{mode: 'transactions', types: string[]}|array{mode: 'rate'}
 */
function typeAccountSearchResolveQueryMode(string $formType): array
{
    $t = strtoupper(trim($formType));
    switch ($t) {
        case 'CONTRA':
            return ['mode' => 'transactions', 'types' => ['CONTRA']];
        case 'PAYMENT':
            return ['mode' => 'transactions', 'types' => ['PAYMENT']];
        case 'CLAIM':
            return ['mode' => 'transactions', 'types' => ['CLAIM']];
        case 'ADJUSTMENT':
            return ['mode' => 'transactions', 'types' => ['ADJUSTMENT']];
        case 'CLEAR':
            return ['mode' => 'transactions', 'types' => ['CLEAR']];
        case 'ALL':
            return ['mode' => 'transactions', 'types' => ['CONTRA', 'PAYMENT', 'CLAIM', 'ADJUSTMENT', 'CLEAR', 'RATE']];
        case 'PROFIT':
            return ['mode' => 'transactions', 'types' => ['WIN', 'LOSE']];
        case 'RATE':
            return ['mode' => 'rate', 'types' => []];
        default:
            throw new InvalidArgumentException('不支持的 transaction_type');
    }
}

/**
 * @return int[]
 */
function typeAccountSearchFetchAccountIds(PDO $pdo, array $listScope, string $formType): array
{
    $resolved = typeAccountSearchResolveQueryMode($formType);
    if (($resolved['mode'] ?? '') === 'rate') {
        return typeAccountSearchFetchRateAccountIds($pdo, $listScope);
    }

    $types = $resolved['types'] ?? [];
    if ($types === []) {
        return [];
    }

    $txnFilter = tx_search_transaction_filter($pdo, $listScope, 't');
    $txnWhere = $txnFilter['sql'];
    $txnBind = (int) $txnFilter['bind'];
    $inTypes = implode(',', array_map(static fn ($x) => $pdo->quote($x), $types));
    $approvalSql = tx_sql_transaction_approval_where($pdo, 't');
    $bankDescSql = typeAccountSearchBankProcessDescriptionExcludeSql('t');
    $bankSrcSql = typeAccountSearchHasSourceBankProcessColumn($pdo)
        ? typeAccountSearchSourceBankProcessExcludeSql('t')
        : '';

    $ids = [];
    $queries = [
        "SELECT DISTINCT t.account_id AS account_id
         FROM transactions t
         WHERE {$txnWhere}
           AND t.account_id IS NOT NULL
           AND t.account_id > 0
           AND t.transaction_type IN ({$inTypes})
           {$approvalSql}
           {$bankDescSql}
           {$bankSrcSql}",
        "SELECT DISTINCT t.from_account_id AS account_id
         FROM transactions t
         WHERE {$txnWhere}
           AND t.from_account_id IS NOT NULL
           AND t.from_account_id > 0
           AND t.transaction_type IN ({$inTypes})
           {$approvalSql}
           {$bankDescSql}
           {$bankSrcSql}",
    ];

    foreach ($queries as $sql) {
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$txnBind]);
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $id = (int) ($row['account_id'] ?? 0);
            if ($id > 0) {
                $ids[$id] = true;
            }
        }
    }

    return array_map('intval', array_keys($ids));
}

/**
 * RATE accounts from transaction_entry (PM fetchRateTransactionItems alignment).
 * Includes RATE_MIDDLEMAN (Middle-Man / MARKUP Win-Loss legs).
 *
 * @return int[]
 */
function typeAccountSearchFetchRateAccountIds(PDO $pdo, array $listScope): array
{
    $hFilter = tx_search_transaction_filter($pdo, $listScope, 'h');
    $permCompanyId = tx_permission_company_id_for_scope($pdo, $listScope);
    $isGroup = (($listScope['mode'] ?? '') === 'group');

    $companyJoin = $isGroup
        ? ''
        : ' INNER JOIN account_company ac ON ac.account_id = e.account_id AND ac.company_id = ?';

    $sql = "SELECT DISTINCT e.account_id AS account_id
            FROM transaction_entry e
            JOIN transactions h ON e.header_id = h.id
            JOIN account acc ON e.account_id = acc.id
            {$companyJoin}
            WHERE {$hFilter['sql']}
              AND h.transaction_type = 'RATE'
              AND e.entry_type IN (
                    'RATE_FIRST_FROM', 'RATE_FIRST_TO',
                    'RATE_TRANSFER_FROM', 'RATE_TRANSFER_TO',
                    'RATE_MIDDLEMAN',
                    'RATE_FEE',
                    'RATE_PLATFORM_FEE'
              )
              AND e.account_id IS NOT NULL
              AND e.account_id > 0";

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
