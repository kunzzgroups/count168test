<?php
/**
 * Promote Group payroll formula templates (SALARY/BONUS/COMMISSION/PROFIT)
 * that were written as company ledger onto group ledger (scope_type=group).
 *
 * For each group: process.company_id on group entity OR group anchor,
 * templates still company-scoped → set scope_type=group, scope_id=groups.id.
 *
 * Usage:
 *   php scripts/_migrate_formula_templates_group_scope.php
 *   php scripts/_migrate_formula_templates_group_scope.php --dry-run
 */

require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../includes/tenant_scope.php';
require_once __DIR__ . '/../includes/group_company_access.php';
require_once __DIR__ . '/../api/transactions/transaction_scope.php';

$dryRun = in_array('--dry-run', $argv ?? [], true);

echo 'pdo_db=' . $pdo->query('SELECT DATABASE()')->fetchColumn() . PHP_EOL;
echo 'dry_run=' . ($dryRun ? '1' : '0') . PHP_EOL;

if (!tenant_table_has_scope_columns($pdo, 'data_capture_templates')) {
    echo "SKIP: data_capture_templates has no scope columns\n";
    exit(0);
}

$payrollCodes = ['SALARY', 'BONUS', 'COMMISSION', 'PROFIT'];
$codePlaceholders = implode(',', array_fill(0, count($payrollCodes), '?'));

$groups = $pdo->query("SELECT id, UPPER(TRIM(group_code)) AS group_code FROM `groups` WHERE TRIM(COALESCE(group_code, '')) <> ''")->fetchAll(PDO::FETCH_ASSOC);
echo 'groups=' . count($groups) . PHP_EOL;

$upd = $pdo->prepare("
    UPDATE data_capture_templates
    SET scope_type = 'group', scope_id = ?
    WHERE id = ?
      AND (COALESCE(scope_type, '') = '' OR scope_type = 'company')
");

$findTpl = $pdo->prepare("
    SELECT dct.id
    FROM data_capture_templates dct
    INNER JOIN process p ON p.id = dct.process_id
    WHERE p.company_id = ?
      AND UPPER(TRIM(p.process_id)) IN ({$codePlaceholders})
      AND (COALESCE(dct.scope_type, '') = '' OR dct.scope_type = 'company')
");

$updated = 0;
$skipped = 0;
$byGroup = [];

foreach ($groups as $gRow) {
    $groupPk = (int) $gRow['id'];
    $groupCode = (string) $gRow['group_code'];
    if ($groupPk <= 0 || $groupCode === '') {
        continue;
    }

    $companyIds = [];
    $entityId = (int) tx_resolve_group_entity_company_id($pdo, $groupCode);
    if ($entityId > 0) {
        $companyIds[$entityId] = true;
    }
    $anchorId = (int) gc_resolve_group_anchor_company_id($pdo, $groupCode);
    if ($anchorId > 0) {
        $companyIds[$anchorId] = true;
    }

    // Also: processes whose currency is already on this group ledger.
    $curProc = $pdo->prepare("
        SELECT DISTINCT p.company_id
        FROM process p
        INNER JOIN currency cur ON cur.id = p.currency_id
        WHERE UPPER(TRIM(p.process_id)) IN ({$codePlaceholders})
          AND cur.scope_type = 'group'
          AND cur.scope_id = ?
    ");
    $curProc->execute(array_merge($payrollCodes, [$groupPk]));
    while ($cid = $curProc->fetchColumn()) {
        $cid = (int) $cid;
        if ($cid > 0) {
            $companyIds[$cid] = true;
        }
    }

    foreach (array_keys($companyIds) as $companyId) {
        $findTpl->execute(array_merge([$companyId], $payrollCodes));
        $ids = $findTpl->fetchAll(PDO::FETCH_COLUMN);
        foreach ($ids as $tid) {
            $tid = (int) $tid;
            if ($tid <= 0) {
                continue;
            }
            if ($dryRun) {
                $updated++;
                $byGroup[$groupCode] = ($byGroup[$groupCode] ?? 0) + 1;
                continue;
            }
            $upd->execute([$groupPk, $tid]);
            if ($upd->rowCount() > 0) {
                $updated++;
                $byGroup[$groupCode] = ($byGroup[$groupCode] ?? 0) + 1;
            } else {
                $skipped++;
            }
        }
    }
}

echo 'updated=' . $updated . ' skipped=' . $skipped . PHP_EOL;
echo 'by_group=' . json_encode($byGroup, JSON_UNESCAPED_UNICODE) . PHP_EOL;

// Backfill process_id NULL on group-ledger templates → group's SALARY process.id
$orphans = $pdo->query("
    SELECT dct.id AS template_id, dct.scope_id AS group_pk, dct.company_id
    FROM data_capture_templates dct
    WHERE dct.scope_type = 'group'
      AND dct.scope_id > 0
      AND (dct.process_id IS NULL OR dct.process_id = 0)
")->fetchAll(PDO::FETCH_ASSOC);

echo 'orphan_null_process=' . count($orphans) . PHP_EOL;

$findSalary = $pdo->prepare("
    SELECT p.id
    FROM process p
    WHERE p.company_id = ?
      AND UPPER(TRIM(p.process_id)) = 'SALARY'
    ORDER BY p.id ASC
    LIMIT 1
");
$setProcess = $pdo->prepare("
    UPDATE data_capture_templates
    SET process_id = ?
    WHERE id = ?
      AND (process_id IS NULL OR process_id = 0)
");

$processFilled = 0;
$processSkipped = 0;
foreach ($orphans as $row) {
    $groupPk = (int) $row['group_pk'];
    $templateId = (int) $row['template_id'];
    $companyId = (int) $row['company_id'];
    $gStmt = $pdo->prepare('SELECT UPPER(TRIM(group_code)) FROM `groups` WHERE id = ? LIMIT 1');
    $gStmt->execute([$groupPk]);
    $groupCode = (string) ($gStmt->fetchColumn() ?: '');
    if ($groupCode === '') {
        $processSkipped++;
        continue;
    }
    $candidateCompanies = [];
    if ($companyId > 0) {
        $candidateCompanies[] = $companyId;
    }
    $entityId = (int) tx_resolve_group_entity_company_id($pdo, $groupCode);
    if ($entityId > 0) {
        $candidateCompanies[] = $entityId;
    }
    $anchorId = (int) gc_resolve_group_anchor_company_id($pdo, $groupCode);
    if ($anchorId > 0) {
        $candidateCompanies[] = $anchorId;
    }
    $salaryId = 0;
    foreach (array_values(array_unique($candidateCompanies)) as $cid) {
        $findSalary->execute([$cid]);
        $salaryId = (int) ($findSalary->fetchColumn() ?: 0);
        if ($salaryId > 0) {
            break;
        }
    }
    if ($salaryId <= 0) {
        $processSkipped++;
        continue;
    }
    if ($dryRun) {
        $processFilled++;
        continue;
    }
    $setProcess->execute([$salaryId, $templateId]);
    if ($setProcess->rowCount() > 0) {
        $processFilled++;
    } else {
        $processSkipped++;
    }
}

echo 'process_id_filled=' . $processFilled . ' process_skipped=' . $processSkipped . PHP_EOL;
echo $dryRun ? "DRY-RUN OK\n" : "GREEN\n";
