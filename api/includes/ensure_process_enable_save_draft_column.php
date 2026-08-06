<?php
/**
 * Idempotent: add process.enable_save_draft when missing.
 * Games company self-service flag — company admins pick which process(es)
 * get Data Capture save-draft, independent of process name.
 */
function ensureProcessEnableSaveDraftColumn(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    try {
        $stmt = $pdo->prepare('SHOW COLUMNS FROM process LIKE ?');
        $stmt->execute(['enable_save_draft']);
        if ($stmt && $stmt->rowCount() > 0) {
            return;
        }
    } catch (Throwable $e) {
        error_log('ensureProcessEnableSaveDraftColumn read: ' . $e->getMessage());
        return;
    }
    try {
        $pdo->exec('ALTER TABLE process ADD COLUMN enable_save_draft TINYINT(1) NOT NULL DEFAULT 0 AFTER status');
    } catch (Throwable $e) {
        try {
            $pdo->exec('ALTER TABLE process ADD COLUMN enable_save_draft TINYINT(1) NOT NULL DEFAULT 0');
        } catch (Throwable $e2) {
            error_log('ensureProcessEnableSaveDraftColumn alter: ' . $e2->getMessage());
        }
    }
}
