<?php
/**
 * Dashboard bootstrap: one HTTP request returns current KPI, previous period, and multi-currency earnings.
 * Reuses dashboard_api.php in-process via dashboard_api_capture() — same logic as
 * GET /api/transactions/dashboard_api.php (not a separate calculation path).
 *
 * Performance (multi-currency):
 * - Primary currency on bootstrap_scope=full runs the chart-capable capture once.
 * - Secondary currencies always use kpi_only + earnings_only (pie/sidebar totals only).
 * - full no longer runs chart GROUP BY for secondary currencies then strips daily_data.
 * - full skips previous-period capture (FE loads MoM via bootstrap_scope=previous after paint).
 * - full skips secondary earnings.previous (primary MoM reuses KPI previous payload when filled).
 * - prefetch=1 uses the same slim full path (no previous) so company warm stays cheap.
 * - Live pie prefers FE-parallel per-currency earnings (avoids this file's serial currencies= loop).
 * - group_all live packs should omit currencies=; FE fills pie via parallel single-currency calls.
 *
 * Company All (group_all=1 + company_ids=…):
 * - One HTTP runs per-company packs in-process (same capture rules); FE still mergeGroupData.
 * - Cuts N client round-trips to 1 while keeping ownership merge semantics on the client.
 */

session_start();
session_write_close();
header('Content-Type: application/json');
require_once __DIR__ . '/../../includes/config.php';

if (!$pdo instanceof PDO) {
    http_response_code(503);
    echo json_encode([
        'success' => false,
        'message' => 'Database connection failed',
        'data' => null,
        'error' => 'Database connection failed',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode([
        'success' => false,
        'message' => '用户未登录',
        'data' => null,
        'error' => '用户未登录',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

define('DASHBOARD_API_SKIP_MAIN', true);
require_once __DIR__ . '/dashboard_api.php';

/**
 * Mirror frontend previousMonthEquivalentRange() — same calendar days one month earlier.
 *
 * @return array{from:string,to:string}
 */
function dashboard_bootstrap_shift_ymd_by_months(string $ymd, int $monthDelta): string
{
    $dt = DateTimeImmutable::createFromFormat('Y-m-d', $ymd);
    if (!$dt) {
        return $ymd;
    }
    $day = (int) $dt->format('j');
    $anchor = $dt->modify('first day of this month')->modify(
        ($monthDelta >= 0 ? '+' : '') . $monthDelta . ' months'
    );
    $lastDay = (int) $anchor->modify('last day of this month')->format('j');
    return $anchor->setDate(
        (int) $anchor->format('Y'),
        (int) $anchor->format('m'),
        min($day, $lastDay)
    )->format('Y-m-d');
}

function dashboard_bootstrap_previous_period(string $fromYmd, string $toYmd): array
{
    return [
        'from' => dashboard_bootstrap_shift_ymd_by_months($fromYmd, -1),
        'to' => dashboard_bootstrap_shift_ymd_by_months($toYmd, -1),
    ];
}

/** Mirror frontend shouldAggregateChartByMonth (>= 3 calendar months). */
function dashboard_bootstrap_should_chart_monthly(string $fromYmd, string $toYmd): bool
{
    $start = DateTimeImmutable::createFromFormat('Y-m-d', $fromYmd);
    $end = DateTimeImmutable::createFromFormat('Y-m-d', $toYmd);
    if (!$start || !$end) {
        return false;
    }
    $months = ((int) $end->format('Y') - (int) $start->format('Y')) * 12
        + ((int) $end->format('n') - (int) $start->format('n'))
        + 1;

    return $months >= 3;
}

/**
 * @return array<string, string>
 */
function dashboard_bootstrap_base_params(): array
{
    $params = [];
    $dateFrom = isset($_GET['date_from']) ? trim((string) $_GET['date_from']) : '';
    $dateTo = isset($_GET['date_to']) ? trim((string) $_GET['date_to']) : '';
    if ($dateFrom !== '') {
        $params['date_from'] = $dateFrom;
    }
    if ($dateTo !== '') {
        $params['date_to'] = $dateTo;
    }

    $companyId = isset($_GET['company_id']) && $_GET['company_id'] !== ''
        ? (string) $_GET['company_id']
        : '';
    $viewGroup = isset($_GET['view_group']) ? trim((string) $_GET['view_group']) : '';
    $groupOnly = isset($_GET['group_only']) && (string) $_GET['group_only'] === '1';

    $subsidiaryOnly = isset($_GET['subsidiary_accounts_only'])
        && (string) $_GET['subsidiary_accounts_only'] === '1';

    if ($companyId !== '') {
        $params['company_id'] = $companyId;
        if ($viewGroup !== '') {
            $params['view_group'] = $viewGroup;
            $params['group_id'] = $viewGroup;
        }
        if ($subsidiaryOnly) {
            $params['subsidiary_accounts_only'] = '1';
        }
    } elseif ($viewGroup !== '') {
        $params['view_group'] = $viewGroup;
        $params['group_id'] = $viewGroup;
    }
    if ($groupOnly) {
        $params['group_only'] = '1';
    }

    return $params;
}

/**
 * Parse company_ids=1,2,3 for group_all batch packs.
 *
 * @return list<int>
 */
function dashboard_bootstrap_parse_company_ids(): array
{
    $raw = isset($_GET['company_ids']) ? trim((string) $_GET['company_ids']) : '';
    if ($raw === '') {
        return [];
    }
    $ids = [];
    foreach (explode(',', $raw) as $part) {
        $id = (int) trim($part);
        if ($id > 0 && !in_array($id, $ids, true)) {
            $ids[] = $id;
        }
    }

    return $ids;
}

/**
 * Strip heavy chart series from earnings-only payloads.
 *
 * @param array<string, mixed>|null $data
 * @return array<string, mixed>|null
 */
function dashboard_bootstrap_slim_payload(?array $data): ?array
{
    if (!is_array($data)) {
        return null;
    }
    unset($data['daily_data']);
    return $data;
}

/**
 * Memoize identical in-process captures (e.g. earnings scope re-fetch).
 *
 * @param array<string, string|null> $params
 * @return array{success:bool,message?:string,data?:mixed,error?:string}
 */
function dashboard_bootstrap_capture(array $params): array
{
    static $cache = [];
    ksort($params);
    $key = http_build_query($params);
    if (isset($cache[$key])) {
        return $cache[$key];
    }
    $cache[$key] = dashboard_api_capture($params);

    return $cache[$key];
}

/** Attach kpi_only for fast KPI paths (skip daily GROUP BY on server). */
function dashboard_bootstrap_capture_scoped(array $params, string $bootstrapScope): array
{
    if (in_array($bootstrapScope, ['kpi', 'previous', 'earnings'], true)) {
        $params['kpi_only'] = '1';
    }
    if ($bootstrapScope === 'earnings') {
        $params['earnings_only'] = '1';
    }

    return dashboard_bootstrap_capture($params);
}

/**
 * Build one scope pack (current / previous / multi-currency earnings) for fixed base params.
 *
 * @param array<string, string> $baseParams
 * @param list<string> $currencyCodes
 * @param array{from:string,to:string} $prevRange
 * @return array{
 *   current:?array,
 *   previous:?array,
 *   earnings:array{current:list<array{code:string,payload:?array}>,previous:list<array{code:string,payload:?array}>},
 *   error:?string
 * }
 */
function dashboard_bootstrap_build_pack(
    array $baseParams,
    string $bootstrapScope,
    string $primaryCurrency,
    array $currencyCodes,
    array $prevRange,
    bool $chartMonthly,
    bool $isPrefetch
): array {
    $currentJson = null;
    $previousData = null;
    $earningsCurrent = [];
    $earningsPrevious = [];

    if ($bootstrapScope === 'full' || $bootstrapScope === 'kpi' || $bootstrapScope === 'chart') {
        $currentParams = $baseParams;
        if ($primaryCurrency !== '') {
            $currentParams['currency'] = $primaryCurrency;
        }
        if (
            ($bootstrapScope === 'chart' || $bootstrapScope === 'full')
            && $chartMonthly
        ) {
            $currentParams['chart_monthly'] = '1';
        }
        $currentJson = $bootstrapScope === 'chart'
            ? dashboard_bootstrap_capture($currentParams)
            : dashboard_bootstrap_capture_scoped($currentParams, $bootstrapScope);
        if (empty($currentJson['success']) || !is_array($currentJson['data'])) {
            $failMsg = $currentJson['message'] ?? $currentJson['error'] ?? 'Failed to load dashboard';
            if ($isPrefetch) {
                return [
                    'current' => null,
                    'previous' => null,
                    'earnings' => ['current' => [], 'previous' => []],
                    'error' => $failMsg,
                ];
            }
            throw new Exception($failMsg);
        }

        // Previous-period MoM is loaded by FE after atomic paint (bootstrap_scope=previous).
        // Keeping it inside full added a full extra capture on the critical path for every
        // company/currency switch (This Month IG+95 felt multi-second even with data).
    } elseif ($bootstrapScope === 'previous') {
        $prevParams = $baseParams;
        $prevParams['date_from'] = $prevRange['from'];
        $prevParams['date_to'] = $prevRange['to'];
        if ($primaryCurrency !== '') {
            $prevParams['currency'] = $primaryCurrency;
        }
        $previousJson = dashboard_bootstrap_capture_scoped($prevParams, 'previous');
        $previousData = (!empty($previousJson['success']) && is_array($previousJson['data']))
            ? $previousJson['data']
            : null;
    }

    if ($bootstrapScope === 'full' || $bootstrapScope === 'earnings') {
        if ($bootstrapScope === 'earnings' && ($currentJson === null || !is_array($currentJson['data'] ?? null))) {
            $currentParams = $baseParams;
            if ($primaryCurrency !== '') {
                $currentParams['currency'] = $primaryCurrency;
            }
            $currentJson = dashboard_bootstrap_capture_scoped($currentParams, 'kpi');
        }

        $skipAllEarningsPrevious = ($bootstrapScope === 'earnings');
        $skipSecondaryEarningsPrevious = ($bootstrapScope === 'full');

        foreach ($currencyCodes as $code) {
            if ($code === $primaryCurrency) {
                $primaryCurrent = is_array($currentJson['data'] ?? null) ? $currentJson['data'] : null;
                $earningsCurrent[] = [
                    'code' => $code,
                    'payload' => dashboard_bootstrap_slim_payload($primaryCurrent),
                ];
                if (!$skipAllEarningsPrevious) {
                    $earningsPrevious[] = [
                        'code' => $code,
                        'payload' => dashboard_bootstrap_slim_payload($previousData),
                    ];
                }
                continue;
            }

            // Prefetch warm: primary currency only — secondary pie fills on live load / earnings scope.
            // Avoids O(companies × currencies) capture storms contending with first paint.
            if ($isPrefetch && $bootstrapScope === 'full') {
                continue;
            }

            $curParams = $baseParams;
            $curParams['currency'] = $code;
            $curJson = dashboard_bootstrap_capture_scoped($curParams, 'earnings');
            $curPayload = (!empty($curJson['success']) && is_array($curJson['data']))
                ? dashboard_bootstrap_slim_payload($curJson['data'])
                : null;

            $earningsCurrent[] = ['code' => $code, 'payload' => $curPayload];

            if ($skipAllEarningsPrevious || $skipSecondaryEarningsPrevious) {
                continue;
            }

            $prevCurParams = $baseParams;
            $prevCurParams['date_from'] = $prevRange['from'];
            $prevCurParams['date_to'] = $prevRange['to'];
            $prevCurParams['currency'] = $code;
            $prevCurJson = dashboard_bootstrap_capture_scoped($prevCurParams, 'earnings');
            $prevCurPayload = (!empty($prevCurJson['success']) && is_array($prevCurJson['data']))
                ? dashboard_bootstrap_slim_payload($prevCurJson['data'])
                : null;

            $earningsPrevious[] = ['code' => $code, 'payload' => $prevCurPayload];
        }
    }

    $current = null;
    $previous = null;
    if ($bootstrapScope === 'full' || $bootstrapScope === 'kpi' || $bootstrapScope === 'chart') {
        $current = is_array($currentJson['data'] ?? null) ? $currentJson['data'] : null;
        // full no longer embeds previous — callers use bootstrap_scope=previous.
        $previous = null;
    } elseif ($bootstrapScope === 'previous') {
        $previous = $previousData;
    } elseif ($bootstrapScope === 'earnings') {
        $current = is_array($currentJson['data'] ?? null) ? $currentJson['data'] : null;
    }

    return [
        'current' => $current,
        'previous' => $previous,
        'earnings' => [
            'current' => $earningsCurrent,
            'previous' => $earningsPrevious,
        ],
        'error' => null,
    ];
}

try {
    dashboard_api_begin_bootstrap_batch();

    $groupAll = isset($_GET['group_all']) && (string) $_GET['group_all'] === '1';
    $companyIds = dashboard_bootstrap_parse_company_ids();
    $viewGroup = isset($_GET['view_group']) ? strtoupper(trim((string) $_GET['view_group'])) : '';

    $primaryCurrency = isset($_GET['currency']) ? strtoupper(trim((string) $_GET['currency'])) : '';
    $currencyListRaw = isset($_GET['currencies']) ? trim((string) $_GET['currencies']) : '';
    $currencyCodes = [];
    if ($currencyListRaw !== '') {
        foreach (explode(',', $currencyListRaw) as $part) {
            $code = strtoupper(trim($part));
            if ($code !== '' && !in_array($code, $currencyCodes, true)) {
                $currencyCodes[] = $code;
            }
        }
    }
    if ($primaryCurrency !== '' && !in_array($primaryCurrency, $currencyCodes, true)) {
        array_unshift($currencyCodes, $primaryCurrency);
    }
    if ($primaryCurrency === '' && $currencyCodes !== []) {
        $primaryCurrency = $currencyCodes[0];
    }

    $bootstrapScope = isset($_GET['bootstrap_scope']) ? strtolower(trim((string) $_GET['bootstrap_scope'])) : 'full';
    if (!in_array($bootstrapScope, ['full', 'kpi', 'earnings', 'previous', 'chart'], true)) {
        $bootstrapScope = 'full';
    }
    $isPrefetch = isset($_GET['prefetch']) && (string) $_GET['prefetch'] === '1';

    $dateFrom = isset($_GET['date_from']) ? trim((string) $_GET['date_from']) : '';
    $dateTo = isset($_GET['date_to']) ? trim((string) $_GET['date_to']) : '';
    if ($dateFrom === '') {
        $dateFrom = date('Y-m-01');
    }
    if ($dateTo === '') {
        $dateTo = date('Y-m-t');
    }
    $prevRange = dashboard_bootstrap_previous_period($dateFrom, $dateTo);
    $chartMonthly = dashboard_bootstrap_should_chart_monthly($dateFrom, $dateTo)
        || (isset($_GET['chart_monthly']) && (string) $_GET['chart_monthly'] === '1');

    if ($groupAll) {
        if ($companyIds === []) {
            throw new Exception('Missing company_ids for group_all');
        }
        // Cap batch size — FE already filters to accessible subsidiaries.
        if (count($companyIds) > 40) {
            throw new Exception('Too many company_ids for group_all');
        }

        $companyPacks = [];
        foreach ($companyIds as $cid) {
            $companyParams = [
                'date_from' => $dateFrom,
                'date_to' => $dateTo,
                'company_id' => (string) $cid,
            ];
            if ($viewGroup !== '') {
                $companyParams['view_group'] = $viewGroup;
                $companyParams['group_id'] = $viewGroup;
                // Company All under a group tab merges subsidiaries, not the group-entity row.
                $companyParams['subsidiary_accounts_only'] = '1';
            }

            $pack = dashboard_bootstrap_build_pack(
                $companyParams,
                $bootstrapScope,
                $primaryCurrency,
                $currencyCodes,
                $prevRange,
                $chartMonthly,
                $isPrefetch
            );
            if ($pack['error'] !== null) {
                // Skip inaccessible / failed companies (same as FE Promise.allSettled filter).
                continue;
            }
            if (
                ($bootstrapScope === 'full' || $bootstrapScope === 'kpi' || $bootstrapScope === 'chart')
                && $pack['current'] === null
            ) {
                continue;
            }
            if ($bootstrapScope === 'previous' && $pack['previous'] === null) {
                continue;
            }

            $companyPacks[] = [
                'company_id' => $cid,
                'current' => $pack['current'],
                'previous' => $pack['previous'],
                'earnings' => $pack['earnings'],
            ];
        }

        if ($companyPacks === []) {
            $failMsg = 'Failed to load dashboard';
            if ($isPrefetch) {
                echo json_encode([
                    'success' => false,
                    'message' => $failMsg,
                    'data' => null,
                    'error' => $failMsg,
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }
            throw new Exception($failMsg);
        }

        echo json_encode([
            'success' => true,
            'data' => [
                'group_all' => true,
                'companies' => $companyPacks,
                'date_range' => [
                    'from' => $dateFrom,
                    'to' => $dateTo,
                ],
                'previous_date_range' => $prevRange,
                'bootstrap_scope' => $bootstrapScope,
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $baseParams = dashboard_bootstrap_base_params();
    if ($baseParams === []) {
        throw new Exception('Missing dashboard scope');
    }
    // Prefer explicit dates from GET (base_params already includes them when set).
    $dateFrom = $baseParams['date_from'] ?? $dateFrom;
    $dateTo = $baseParams['date_to'] ?? $dateTo;
    $prevRange = dashboard_bootstrap_previous_period($dateFrom, $dateTo);

    $pack = dashboard_bootstrap_build_pack(
        $baseParams,
        $bootstrapScope,
        $primaryCurrency,
        $currencyCodes,
        $prevRange,
        $chartMonthly,
        $isPrefetch
    );
    if ($pack['error'] !== null) {
        echo json_encode([
            'success' => false,
            'message' => $pack['error'],
            'data' => null,
            'error' => $pack['error'],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $responseData = [
        'earnings' => $pack['earnings'],
        'date_range' => [
            'from' => $dateFrom,
            'to' => $dateTo,
        ],
        'previous_date_range' => $prevRange,
        'bootstrap_scope' => $bootstrapScope,
    ];

    if ($bootstrapScope === 'full' || $bootstrapScope === 'kpi' || $bootstrapScope === 'chart') {
        $responseData['current'] = $pack['current'];
        $responseData['previous'] = $bootstrapScope === 'full' ? $pack['previous'] : null;
    } elseif ($bootstrapScope === 'previous') {
        $responseData['previous'] = $pack['previous'];
    } elseif ($bootstrapScope === 'earnings') {
        $responseData['current'] = $pack['current'];
    }

    echo json_encode([
        'success' => true,
        'data' => $responseData,
    ], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    error_log('dashboard_bootstrap_api: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => $e->getMessage(),
        'data' => null,
        'error' => $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE);
} finally {
    dashboard_api_end_bootstrap_batch();
}
