<?php
require_once __DIR__ . '/../includes/config.php';

function dropFkIfExists(PDO $pdo, string $table, string $constraint): void
{
    $st = $pdo->prepare("
        SELECT CONSTRAINT_NAME
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND CONSTRAINT_NAME = ?
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        LIMIT 1
    ");
    $st->execute([$table, $constraint]);
    if ($st->fetchColumn()) {
        $pdo->exec("ALTER TABLE `{$table}` DROP FOREIGN KEY `{$constraint}`");
        echo "dropped FK {$table}.{$constraint}\n";
    }
}

echo 'pdo_db=' . $pdo->query('SELECT DATABASE()')->fetchColumn() . PHP_EOL;
dropFkIfExists($pdo, 'account_link', 'fk_account_link_company');

$pdo->exec('ALTER TABLE account_link MODIFY COLUMN company_id INT UNSIGNED NULL');
if ($pdo->query("SHOW COLUMNS FROM account_link LIKE 'scope_type'")->rowCount() === 0) {
    $pdo->exec("ALTER TABLE account_link ADD COLUMN scope_type ENUM('company','group') NOT NULL DEFAULT 'company' AFTER company_id");
    echo "added scope_type\n";
}
if ($pdo->query("SHOW COLUMNS FROM account_link LIKE 'scope_id'")->rowCount() === 0) {
    $pdo->exec('ALTER TABLE account_link ADD COLUMN scope_id BIGINT UNSIGNED NULL AFTER scope_type');
    echo "added scope_id\n";
}
try {
    $pdo->exec('ALTER TABLE account_link ADD KEY idx_account_link_scope (scope_type, scope_id)');
} catch (Throwable $e) {
    // index may already exist
}

$pdo->exec("
    UPDATE account_link
    SET scope_type = 'company', scope_id = company_id
    WHERE scope_id IS NULL AND company_id IS NOT NULL
");

echo "GREEN\n";
