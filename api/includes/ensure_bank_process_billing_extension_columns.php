<?php
/**
 * Idempotent: add bank_process.issue_flag_locked_end_ymd and
 * bank_process.accounting_reactivated_floor_ymd when missing.
 * Called from API entrypoints; requires DB user with ALTER on bank_process.
 *
 * - issue_flag_locked_end_ymd: frozen contract-end date for a process while its
 *   issue_flag is official/e_invoice/block. Set once (lazily, on first read past
 *   the naturally-computed expiry) so later edits to day_end/contract can't
 *   reopen billing for that process.
 * - accounting_reactivated_floor_ymd: first day of the month in which a process
 *   was most recently switched from inactive back to active. Used as a floor so
 *   periods skipped during the inactive gap are never backfilled.
 */
function ensureBankProcessBillingExtensionColumns(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $columns = [
        'issue_flag_locked_end_ymd' => 'ALTER TABLE bank_process ADD COLUMN issue_flag_locked_end_ymd DATE NULL DEFAULT NULL AFTER day_end',
        'accounting_reactivated_floor_ymd' => 'ALTER TABLE bank_process ADD COLUMN accounting_reactivated_floor_ymd DATE NULL DEFAULT NULL AFTER day_end',
    ];

    foreach ($columns as $column => $alterSql) {
        try {
            $stmt = $pdo->prepare('SHOW COLUMNS FROM bank_process LIKE ?');
            $stmt->execute([$column]);
            if ($stmt && $stmt->rowCount() > 0) {
                continue;
            }
        } catch (Throwable $e) {
            error_log('ensureBankProcessBillingExtensionColumns read (' . $column . '): ' . $e->getMessage());
            continue;
        }
        try {
            $pdo->exec($alterSql);
        } catch (Throwable $e) {
            try {
                $pdo->exec(str_replace(' AFTER day_end', '', $alterSql));
            } catch (Throwable $e2) {
                error_log('ensureBankProcessBillingExtensionColumns alter (' . $column . '): ' . $e2->getMessage());
                continue;
            }
        }
        if (isset($GLOBALS['__bank_process_column_exists_cache']) && is_array($GLOBALS['__bank_process_column_exists_cache'])) {
            unset($GLOBALS['__bank_process_column_exists_cache'][$column]);
        }
    }
}
