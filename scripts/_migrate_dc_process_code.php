<?php
/**
 * Apply 20260731_data_captures_process_code_nullable.sql on local easycount.
 */
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

dropFkIfExists($pdo, 'data_captures', 'fk_data_captures_process');
dropFkIfExists($pdo, 'submitted_processes', 'fk_submitted_processes_process');
dropFkIfExists($pdo, 'submitted_processes', 'fk_sp_process');

$pdo->exec('ALTER TABLE data_captures MODIFY COLUMN company_id INT UNSIGNED NULL');
$pdo->exec('ALTER TABLE data_captures MODIFY COLUMN process_id INT NULL');
if ($pdo->query("SHOW COLUMNS FROM data_captures LIKE 'process_code'")->rowCount() === 0) {
    $pdo->exec('ALTER TABLE data_captures ADD COLUMN process_code VARCHAR(50) NULL AFTER process_id');
    echo "added data_captures.process_code\n";
}

$pdo->exec('ALTER TABLE submitted_processes MODIFY COLUMN company_id INT UNSIGNED NULL');
$pdo->exec('ALTER TABLE submitted_processes MODIFY COLUMN process_id INT NULL');
if ($pdo->query("SHOW COLUMNS FROM submitted_processes LIKE 'process_code'")->rowCount() === 0) {
    $pdo->exec('ALTER TABLE submitted_processes ADD COLUMN process_code VARCHAR(50) NULL AFTER process_id');
    echo "added submitted_processes.process_code\n";
}

echo "GREEN\n";
