<?php
/**
 * Transaction ledger realtime (compat wrappers).
 * Prefer api/includes/realtime.php for new domains.
 */

require_once __DIR__ . '/realtime.php';

if (!function_exists('tx_ledger_realtime_config')) {
    /**
     * @return array{enabled: bool, publish_url: string, secret: string}
     */
    function tx_ledger_realtime_config(): array
    {
        return realtime_config();
    }
}

if (!function_exists('tx_ledger_realtime_channels_from_scope')) {
    /**
     * @param array{mode?: string, company_id?: int, group_scope_id?: int} $listScope
     * @return string[]
     */
    function tx_ledger_realtime_channels_from_scope(array $listScope): array
    {
        return realtime_channels_from_scope($listScope);
    }
}

if (!function_exists('tx_ledger_realtime_sign_ticket')) {
    /**
     * @param array<string, mixed> $payload
     */
    function tx_ledger_realtime_sign_ticket(array $payload, string $secret): string
    {
        return realtime_sign_ticket($payload, $secret);
    }
}

if (!function_exists('tx_ledger_realtime_publish')) {
    /**
     * @param string[] $channels
     * @param array<string, mixed> $extra
     */
    function tx_ledger_realtime_publish(array $channels, string $source = 'unknown', array $extra = []): void
    {
        realtime_publish($channels, 'ledger', $source, $extra, 'ledger_changed');
    }
}

if (!function_exists('tx_ledger_realtime_publish_scope')) {
    /**
     * @param array{mode?: string, company_id?: int, group_scope_id?: int} $listScope
     * @param array<string, mixed> $extra
     */
    function tx_ledger_realtime_publish_scope(array $listScope, string $source = 'unknown', array $extra = []): void
    {
        // domain=ledger maps SSE type to ledger_changed inside realtime_publish.
        realtime_publish_scope($listScope, 'ledger', $source, $extra);
    }
}
