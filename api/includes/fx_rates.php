<?php
/**
 * Dashboard FX rates: DB cache + Frankfurter upstream.
 * Shape matches Frankfurter v2 rows: { date, base, quote, rate }.
 */

declare(strict_types=1);

if (!function_exists('fx_rates_excluded_codes')) {
    /** Crypto / custom codes Frankfurter cannot price. */
    function fx_rates_excluded_codes(): array
    {
        return [
            'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD', 'USDD',
            'BTC', 'ETH', 'BNB', 'XRP', 'SOL',
        ];
    }
}

if (!function_exists('fx_rates_latest_ttl_seconds')) {
    function fx_rates_latest_ttl_seconds(): int
    {
        return 3600;
    }
}

if (!function_exists('fx_rates_normalize_code')) {
    function fx_rates_normalize_code($code): string
    {
        return strtoupper(trim((string) $code));
    }
}

if (!function_exists('fx_rates_normalize_quotes')) {
    /**
     * @param string[] $quoteCodes
     * @return string[]
     */
    function fx_rates_normalize_quotes(string $baseCode, array $quoteCodes): array
    {
        $out = [];
        $seen = [];
        foreach ($quoteCodes as $raw) {
            $q = fx_rates_normalize_code($raw);
            if ($q === '' || $q === $baseCode || isset($seen[$q])) {
                continue;
            }
            $seen[$q] = true;
            $out[] = $q;
        }
        return $out;
    }
}

if (!function_exists('fx_rates_partition_quotes')) {
    /**
     * @param string[] $quoteCodes
     * @return array{quotes: string[], apiQuotes: string[], excluded: string[]}
     */
    function fx_rates_partition_quotes(string $baseCode, array $quoteCodes): array
    {
        $quotes = fx_rates_normalize_quotes($baseCode, $quoteCodes);
        $excludedSet = array_fill_keys(fx_rates_excluded_codes(), true);
        // Crypto/custom base cannot be a Frankfurter `base=` — skip upstream entirely.
        if ($baseCode !== '' && isset($excludedSet[$baseCode])) {
            return ['quotes' => $quotes, 'apiQuotes' => [], 'excluded' => $quotes];
        }
        $apiQuotes = [];
        $excluded = [];
        foreach ($quotes as $q) {
            if (isset($excludedSet[$q])) {
                $excluded[] = $q;
            } else {
                $apiQuotes[] = $q;
            }
        }
        return ['quotes' => $quotes, 'apiQuotes' => $apiQuotes, 'excluded' => $excluded];
    }
}

if (!function_exists('fx_rates_table_exists')) {
    function fx_rates_table_exists(PDO $pdo): bool
    {
        static $exists = null;
        if ($exists !== null) {
            return $exists;
        }
        try {
            $stmt = $pdo->query("SHOW TABLES LIKE 'fx_daily_rates'");
            $exists = $stmt !== false && (bool) $stmt->fetchColumn();
        } catch (Throwable $e) {
            $exists = false;
        }
        return $exists;
    }
}

if (!function_exists('fx_rates_http_get_json')) {
    /**
     * @return array{ok: bool, status: int, body: mixed, error: string}
     */
    function fx_rates_http_get_json(string $url, int $timeoutSec = 8): array
    {
        $status = 0;
        $raw = null;
        $error = '';

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            if ($ch === false) {
                return ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'curl_init failed'];
            }
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_CONNECTTIMEOUT => min(5, $timeoutSec),
                CURLOPT_TIMEOUT => $timeoutSec,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
            ]);
            $raw = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            if ($raw === false) {
                $error = curl_error($ch) ?: 'curl_exec failed';
            }
            curl_close($ch);
        } else {
            $ctx = stream_context_create([
                'http' => [
                    'method' => 'GET',
                    'header' => "Accept: application/json\r\n",
                    'timeout' => $timeoutSec,
                    'ignore_errors' => true,
                ],
            ]);
            $raw = @file_get_contents($url, false, $ctx);
            if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
                $status = (int) $m[1];
            }
            if ($raw === false) {
                $error = 'file_get_contents failed';
            }
        }

        if ($raw === false || $raw === null) {
            return ['ok' => false, 'status' => $status, 'body' => null, 'error' => $error ?: 'empty response'];
        }
        if ($status < 200 || $status >= 300) {
            return ['ok' => false, 'status' => $status, 'body' => null, 'error' => "HTTP {$status}"];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return ['ok' => false, 'status' => $status, 'body' => null, 'error' => 'invalid JSON'];
        }

        return ['ok' => true, 'status' => $status, 'body' => $decoded, 'error' => ''];
    }
}

if (!function_exists('fx_rates_parse_frankfurter_rows')) {
    /**
     * @param mixed $payload
     * @param string[] $apiQuotes
     * @return array{rows: list<array{date: string, base: string, quote: string, rate: float}>, unsupported: string[]}
     */
    function fx_rates_parse_frankfurter_rows($payload, string $baseCode, array $apiQuotes, ?string $dateYmd): array
    {
        $list = [];
        if (isset($payload[0]) || $payload === []) {
            $list = is_array($payload) ? $payload : [];
        } elseif (isset($payload['data']) && is_array($payload['data'])) {
            $list = $payload['data'];
        }

        $rows = [];
        $supported = [];
        foreach ($list as $row) {
            if (!is_array($row)) {
                continue;
            }
            $quote = fx_rates_normalize_code($row['quote'] ?? '');
            $rate = isset($row['rate']) ? (float) $row['rate'] : 0.0;
            $date = isset($row['date']) ? (string) $row['date'] : ($dateYmd ?? '');
            $base = fx_rates_normalize_code($row['base'] ?? $baseCode);
            if ($quote === '' || $base === '' || !is_finite($rate) || $rate <= 0 || $date === '') {
                continue;
            }
            $rows[] = [
                'date' => $date,
                'base' => $base,
                'quote' => $quote,
                'rate' => $rate,
            ];
            $supported[$quote] = true;
        }

        $unsupported = [];
        foreach ($apiQuotes as $q) {
            if (!isset($supported[$q])) {
                $unsupported[] = $q;
            }
        }

        return ['rows' => $rows, 'unsupported' => $unsupported];
    }
}

if (!function_exists('fx_rates_fetch_frankfurter')) {
    /**
     * @param string[] $apiQuotes
     * @return array{rows: list<array{date: string, base: string, quote: string, rate: float}>, unsupported: string[]}
     */
    function fx_rates_fetch_frankfurter(string $baseCode, array $apiQuotes, ?string $dateYmd = null): array
    {
        if ($apiQuotes === []) {
            return ['rows' => [], 'unsupported' => []];
        }

        $params = [
            'base' => $baseCode,
            'quotes' => implode(',', $apiQuotes),
        ];
        if ($dateYmd !== null && $dateYmd !== '') {
            $params['date'] = $dateYmd;
        }
        $url = 'https://api.frankfurter.dev/v2/rates?' . http_build_query($params);
        $res = fx_rates_http_get_json($url, 8);
        if ($res['ok']) {
            return fx_rates_parse_frankfurter_rows($res['body'], $baseCode, $apiQuotes, $dateYmd);
        }

        // Batch often 422 when one quote is invalid (e.g. typo "SG") — recover per quote.
        if (count($apiQuotes) === 1) {
            throw new RuntimeException('Frankfurter: ' . ($res['error'] ?: 'request failed'));
        }

        $rows = [];
        $unsupported = [];
        foreach ($apiQuotes as $quote) {
            try {
                $one = fx_rates_fetch_frankfurter($baseCode, [$quote], $dateYmd);
                if ($one['rows'] !== []) {
                    $rows[] = $one['rows'][0];
                } else {
                    $unsupported[] = $quote;
                }
            } catch (Throwable $e) {
                $unsupported[] = $quote;
            }
        }

        if ($rows === []) {
            throw new RuntimeException('Frankfurter: ' . ($res['error'] ?: 'request failed'));
        }

        return ['rows' => $rows, 'unsupported' => $unsupported];
    }
}

if (!function_exists('fx_rates_upsert_rows')) {
    /**
     * @param list<array{date: string, base: string, quote: string, rate: float|string}> $rows
     */
    function fx_rates_upsert_rows(PDO $pdo, array $rows, string $source = 'frankfurter'): int
    {
        if ($rows === [] || !fx_rates_table_exists($pdo)) {
            return 0;
        }

        $sql = 'INSERT INTO fx_daily_rates (base_code, quote_code, rate_date, rate, source, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                  rate = VALUES(rate),
                  source = VALUES(source),
                  fetched_at = VALUES(fetched_at)';
        $stmt = $pdo->prepare($sql);
        $now = (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuala_Lumpur')))->format('Y-m-d H:i:s');
        $n = 0;
        foreach ($rows as $row) {
            $base = fx_rates_normalize_code($row['base'] ?? '');
            $quote = fx_rates_normalize_code($row['quote'] ?? '');
            $date = (string) ($row['date'] ?? '');
            $rate = (string) ($row['rate'] ?? '');
            if ($base === '' || $quote === '' || $date === '' || $rate === '') {
                continue;
            }
            $stmt->execute([$base, $quote, $date, $rate, $source, $now]);
            $n++;
        }
        return $n;
    }
}

if (!function_exists('fx_rates_read_cached')) {
    /**
     * @param string[] $apiQuotes
     * @return array{
     *   rows: list<array{date: string, base: string, quote: string, rate: float}>,
     *   missing: string[],
     *   fresh: bool,
     *   rate_date: string|null
     * }
     */
    function fx_rates_read_cached(PDO $pdo, string $baseCode, array $apiQuotes, ?string $dateYmd): array
    {
        $empty = ['rows' => [], 'missing' => $apiQuotes, 'fresh' => false, 'rate_date' => $dateYmd];
        if ($apiQuotes === [] || !fx_rates_table_exists($pdo)) {
            return $empty;
        }

        if ($dateYmd !== null && $dateYmd !== '') {
            $placeholders = implode(',', array_fill(0, count($apiQuotes), '?'));
            $sql = "SELECT base_code, quote_code, rate_date, rate, fetched_at
                    FROM fx_daily_rates
                    WHERE base_code = ?
                      AND rate_date = ?
                      AND quote_code IN ({$placeholders})";
            $params = array_merge([$baseCode, $dateYmd], $apiQuotes);
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $found = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

            $byQuote = [];
            foreach ($found as $row) {
                $q = fx_rates_normalize_code($row['quote_code']);
                $byQuote[$q] = $row;
            }

            $rows = [];
            $missing = [];
            foreach ($apiQuotes as $q) {
                if (!isset($byQuote[$q])) {
                    $missing[] = $q;
                    continue;
                }
                $r = $byQuote[$q];
                $rows[] = [
                    'date' => (string) $r['rate_date'],
                    'base' => $baseCode,
                    'quote' => $q,
                    'rate' => (float) $r['rate'],
                ];
            }

            // Historical dates: once stored, treat as permanently fresh.
            return [
                'rows' => $rows,
                'missing' => $missing,
                'fresh' => $missing === [],
                'rate_date' => $dateYmd,
            ];
        }

        // Latest: pick newest rate_date per quote; freshness from fetched_at TTL.
        $placeholders = implode(',', array_fill(0, count($apiQuotes), '?'));
        $sql = "SELECT f.base_code, f.quote_code, f.rate_date, f.rate, f.fetched_at
                FROM fx_daily_rates f
                INNER JOIN (
                    SELECT quote_code, MAX(rate_date) AS max_date
                    FROM fx_daily_rates
                    WHERE base_code = ?
                      AND quote_code IN ({$placeholders})
                    GROUP BY quote_code
                ) latest
                  ON latest.quote_code = f.quote_code
                 AND latest.max_date = f.rate_date
                WHERE f.base_code = ?";
        $params = array_merge([$baseCode], $apiQuotes, [$baseCode]);
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $found = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $byQuote = [];
        foreach ($found as $row) {
            $q = fx_rates_normalize_code($row['quote_code']);
            $byQuote[$q] = $row;
        }

        $rows = [];
        $missing = [];
        $allFresh = true;
        $ttl = fx_rates_latest_ttl_seconds();
        $nowTs = time();
        $rateDate = null;

        foreach ($apiQuotes as $q) {
            if (!isset($byQuote[$q])) {
                $missing[] = $q;
                $allFresh = false;
                continue;
            }
            $r = $byQuote[$q];
            $fetchedTs = strtotime((string) $r['fetched_at']);
            if ($fetchedTs === false || ($nowTs - $fetchedTs) > $ttl) {
                $allFresh = false;
            }
            $rateDate = (string) $r['rate_date'];
            $rows[] = [
                'date' => $rateDate,
                'base' => $baseCode,
                'quote' => $q,
                'rate' => (float) $r['rate'],
            ];
        }

        return [
            'rows' => $rows,
            'missing' => $missing,
            'fresh' => $allFresh && $missing === [],
            'rate_date' => $rateDate,
        ];
    }
}

if (!function_exists('fx_rates_backfill_missing')) {
    /**
     * @param string[] $missingQuotes
     * @param list<array{date: string, base: string, quote: string, rate: float}> $seedRows
     * @return array{rows: list<array{date: string, base: string, quote: string, rate: float}>, unsupported: string[]}
     */
    function fx_rates_backfill_missing(
        string $baseCode,
        array $missingQuotes,
        ?string $dateYmd,
        array $seedRows = []
    ): array {
        $byQuote = [];
        foreach ($seedRows as $row) {
            $byQuote[fx_rates_normalize_code($row['quote'])] = $row;
        }
        $unsupported = [];

        foreach ($missingQuotes as $quote) {
            $dateCandidates = $dateYmd ? [$dateYmd, null] : [null];
            $got = false;
            foreach ($dateCandidates as $dateTry) {
                try {
                    $one = fx_rates_fetch_frankfurter($baseCode, [$quote], $dateTry);
                    if ($one['rows'] !== []) {
                        $byQuote[$quote] = $one['rows'][0];
                        $got = true;
                        break;
                    }
                } catch (Throwable $e) {
                    // try next date candidate
                }
            }
            if (!$got) {
                $unsupported[] = $quote;
            }
        }

        return [
            'rows' => array_values($byQuote),
            'unsupported' => $unsupported,
        ];
    }
}

if (!function_exists('fx_rates_resolve')) {
    /**
     * Resolve rates: fresh DB → upstream (+ upsert) → stale DB fallback.
     *
     * @param string[] $quoteCodes
     * @return array{
     *   rows: list<array{date: string, base: string, quote: string, rate: float}>,
     *   unsupported: string[],
     *   cache: string,
     *   rate_date: string|null
     * }
     */
    function fx_rates_resolve(PDO $pdo, string $base, array $quoteCodes, ?string $dateYmd = null): array
    {
        $baseCode = fx_rates_normalize_code($base);
        $parts = fx_rates_partition_quotes($baseCode, $quoteCodes);
        $excluded = $parts['excluded'];
        $apiQuotes = $parts['apiQuotes'];

        if ($baseCode === '') {
            return [
                'rows' => [],
                'unsupported' => $parts['quotes'],
                'cache' => 'none',
                'rate_date' => $dateYmd,
            ];
        }

        if ($apiQuotes === []) {
            return [
                'rows' => [],
                'unsupported' => $excluded,
                'cache' => 'skipped',
                'rate_date' => $dateYmd,
            ];
        }

        $cached = fx_rates_read_cached($pdo, $baseCode, $apiQuotes, $dateYmd);
        if ($cached['fresh']) {
            return [
                'rows' => $cached['rows'],
                'unsupported' => $excluded,
                'cache' => 'hit',
                'rate_date' => $cached['rate_date'] ?? $dateYmd,
            ];
        }

        $mergedRows = $cached['rows'];
        $needFetch = $cached['missing'];
        // Latest with stale rows: refresh all api quotes so fetched_at stays coherent.
        if ($dateYmd === null || $dateYmd === '') {
            if (!$cached['fresh']) {
                $needFetch = $apiQuotes;
            }
        }

        try {
            if ($needFetch !== []) {
                $fetched = fx_rates_fetch_frankfurter($baseCode, $needFetch, $dateYmd);
                if ($fetched['unsupported'] !== []) {
                    $backfill = fx_rates_backfill_missing(
                        $baseCode,
                        $fetched['unsupported'],
                        $dateYmd,
                        $fetched['rows']
                    );
                    $fetched = $backfill;
                }

                $byQuote = [];
                foreach ($mergedRows as $row) {
                    $byQuote[fx_rates_normalize_code($row['quote'])] = $row;
                }
                foreach ($fetched['rows'] as $row) {
                    $byQuote[fx_rates_normalize_code($row['quote'])] = $row;
                }
                $mergedRows = array_values($byQuote);

                try {
                    fx_rates_upsert_rows($pdo, $fetched['rows']);
                } catch (Throwable $e) {
                    error_log('fx_rates_upsert_rows: ' . $e->getMessage());
                }

                $have = [];
                foreach ($mergedRows as $row) {
                    $have[fx_rates_normalize_code($row['quote'])] = true;
                }
                $stillMissing = [];
                foreach ($apiQuotes as $q) {
                    if (!isset($have[$q])) {
                        $stillMissing[] = $q;
                    }
                }

                return [
                    'rows' => $mergedRows,
                    'unsupported' => array_values(array_unique(array_merge($excluded, $stillMissing))),
                    'cache' => $cached['rows'] !== [] ? 'refresh' : 'miss',
                    'rate_date' => $mergedRows[0]['date'] ?? $dateYmd,
                ];
            }
        } catch (Throwable $e) {
            error_log('fx_rates_resolve upstream: ' . $e->getMessage());
            if ($cached['rows'] !== []) {
                $have = [];
                foreach ($cached['rows'] as $row) {
                    $have[fx_rates_normalize_code($row['quote'])] = true;
                }
                $stillMissing = [];
                foreach ($apiQuotes as $q) {
                    if (!isset($have[$q])) {
                        $stillMissing[] = $q;
                    }
                }
                return [
                    'rows' => $cached['rows'],
                    'unsupported' => array_values(array_unique(array_merge($excluded, $stillMissing))),
                    'cache' => 'stale',
                    'rate_date' => $cached['rate_date'] ?? $dateYmd,
                ];
            }
            throw $e;
        }

        // Partial cache without needing fetch (should be rare).
        $have = [];
        foreach ($mergedRows as $row) {
            $have[fx_rates_normalize_code($row['quote'])] = true;
        }
        $stillMissing = [];
        foreach ($apiQuotes as $q) {
            if (!isset($have[$q])) {
                $stillMissing[] = $q;
            }
        }

        return [
            'rows' => $mergedRows,
            'unsupported' => array_values(array_unique(array_merge($excluded, $stillMissing))),
            'cache' => $mergedRows !== [] ? 'partial' : 'none',
            'rate_date' => $mergedRows[0]['date'] ?? $dateYmd,
        ];
    }
}

if (!function_exists('fx_rates_list_system_codes')) {
    /**
     * Distinct fiat currency codes present in the system.
     *
     * @return string[]
     */
    function fx_rates_list_system_codes(PDO $pdo): array
    {
        $excluded = array_fill_keys(fx_rates_excluded_codes(), true);
        try {
            $stmt = $pdo->query('SELECT DISTINCT UPPER(TRIM(code)) AS code FROM currency WHERE code IS NOT NULL AND code <> \'\'');
            $rows = $stmt ? ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
        } catch (Throwable $e) {
            return [];
        }
        $codes = [];
        foreach ($rows as $row) {
            $code = fx_rates_normalize_code($row['code'] ?? '');
            // ISO-like fiat codes only (skip typos like "SG", crypto already excluded).
            if ($code === '' || isset($excluded[$code]) || !preg_match('/^[A-Z]{3}$/', $code)) {
                continue;
            }
            $codes[$code] = true;
        }
        $list = array_keys($codes);
        sort($list);
        return $list;
    }
}

if (!function_exists('fx_rates_warm_latest')) {
    /**
     * Prefetch latest rates for preferred bases against system quote set.
     *
     * @param string[]|null $preferredBases
     * @return array{bases: int, upserted: int, errors: string[]}
     */
    function fx_rates_warm_latest(PDO $pdo, ?array $preferredBases = null): array
    {
        $codes = fx_rates_list_system_codes($pdo);
        if (count($codes) < 2) {
            return ['bases' => 0, 'upserted' => 0, 'errors' => []];
        }

        $defaults = ['MYR', 'USD', 'SGD', 'CNY', 'HKD', 'EUR', 'GBP', 'THB', 'IDR', 'VND', 'PHP'];
        $want = $preferredBases !== null && $preferredBases !== []
            ? array_map('fx_rates_normalize_code', $preferredBases)
            : $defaults;

        $bases = [];
        foreach ($want as $b) {
            if (in_array($b, $codes, true)) {
                $bases[] = $b;
            }
        }
        // Always warm at least first system code if none of the defaults exist.
        if ($bases === []) {
            $bases[] = $codes[0];
        }

        $upserted = 0;
        $errors = [];
        foreach ($bases as $base) {
            $quotes = array_values(array_filter($codes, static fn($c) => $c !== $base));
            if ($quotes === []) {
                continue;
            }
            try {
                $resolved = fx_rates_resolve($pdo, $base, $quotes, null);
                $upserted += count($resolved['rows']);
            } catch (Throwable $e) {
                $errors[] = $base . ': ' . $e->getMessage();
            }
        }

        return ['bases' => count($bases), 'upserted' => $upserted, 'errors' => $errors];
    }
}
