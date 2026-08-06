<?php
/**
 * Backfill groups.permissions = ["Games"] for legacy NULL/empty/non-Games rows.
 * Usage: php scripts/_migrate_groups_permissions_games.php
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/config.php';
require_once __DIR__ . '/../api/domain/domain_groups_helpers.php';

echo 'pdo_db=' . $pdo->query('SELECT DATABASE()')->fetchColumn() . PHP_EOL;

$before = $pdo->query("SELECT id, group_code, permissions FROM `groups` ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
echo 'before_count=' . count($before) . PHP_EOL;
foreach ($before as $row) {
    if (domainApiGroupPermissionsNeedGamesHeal($row['permissions'] ?? null)) {
        echo 'heal_candidate=' . ($row['group_code'] ?? '') . ' id=' . ($row['id'] ?? '') . ' raw=' . json_encode($row['permissions']) . PHP_EOL;
    }
}

$n = domainApiHealGroupGamesPermissions($pdo, 0);
echo "updated_rows={$n}" . PHP_EOL;

$kk = $pdo->query("SELECT id, group_code, permissions FROM `groups` WHERE UPPER(TRIM(group_code))='KK' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
echo 'kk=' . json_encode($kk, JSON_UNESCAPED_UNICODE) . PHP_EOL;

if (!$kk || domainApiGroupPermissionsNeedGamesHeal($kk['permissions'] ?? null)) {
    fwrite(STDERR, "FAIL: KK permissions not Games\n");
    exit(1);
}

echo "GREEN\n";
exit(0);
