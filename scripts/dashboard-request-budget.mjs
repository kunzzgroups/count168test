/**
 * Dashboard HTTP budget model (static — mirrors useDashboardPage.js fan-out).
 * Run: node scripts/dashboard-request-budget.mjs
 *
 * After currencies= pack fix:
 * - Company All critical-path ≈ 2C (primary + multi pie) + C previous
 * - Single multi-currency ≈ 3 bootstrap + 1 multi earnings
 */

/** @typedef {{ companies: number, currencies: number, mode: 'single'|'companyAll'|'groupLedger' }} Scope */

function criticalPathBudget(scope) {
  const C = Math.max(1, scope.companies | 0);
  const M = Math.max(1, scope.currencies | 0);
  const detail = [];

  if (scope.mode === 'single' || scope.mode === 'groupLedger') {
    detail.push({ name: 'bootstrap kpi', n: 1 });
    detail.push({ name: 'bootstrap chart', n: 1 });
    detail.push({ name: 'bootstrap previous', n: 1 });
    if (M > 1) {
      detail.push({ name: 'earnings_only currencies= pack (1 HTTP)', n: 1 });
    }
  } else if (scope.mode === 'companyAll') {
    detail.push({ name: 'primary KPI per company', n: C });
    if (M > 1) {
      detail.push({ name: 'multi-currency pie pack per company', n: C });
    }
    detail.push({ name: 'previous period per company', n: C });
  }

  const total = detail.reduce((s, d) => s + d.n, 0);
  return { total, detail, C, M };
}

function layoutOverheadEstimate() {
  return {
    total: 6,
    detail: [
      { name: 'current_user / session', n: 1 },
      { name: 'get_owner_companies', n: 1 },
      { name: 'get_*_currencies (deduped)', n: 1 },
      { name: 'user_currency_order', n: 1 },
      { name: 'update_company_session + ticket', n: 2 },
    ],
  };
}

const scenarios = [
  { label: 'Single company, 1 currency (MYR)', companies: 1, currencies: 1, mode: 'single' },
  { label: 'Single company, 6 currencies', companies: 1, currencies: 6, mode: 'single' },
  { label: 'Company All, 5 cos × 6 currencies', companies: 5, currencies: 6, mode: 'companyAll' },
  { label: 'Company All, 9 cos × 8 currencies', companies: 9, currencies: 8, mode: 'companyAll' },
];

// Post-fix ceilings (critical-path only)
const BUDGET = {
  single_1: 6,
  single_6: 6,
  companyAll_5x6: 20, // 5+5+5=15
  companyAll_9x8: 30, // 9+9+9=27
};

let failed = 0;
console.log('Dashboard critical-path HTTP budget model (post currencies= fix)\n');

for (const s of scenarios) {
  const crit = criticalPathBudget(s);
  const layout = layoutOverheadEstimate();
  const grand = crit.total + layout.total;

  let ceiling;
  if (s.mode === 'single' && s.currencies === 1) ceiling = BUDGET.single_1;
  else if (s.mode === 'single') ceiling = BUDGET.single_6;
  else if (s.companies === 5) ceiling = BUDGET.companyAll_5x6;
  else ceiling = BUDGET.companyAll_9x8;

  const red = crit.total > ceiling;
  if (red) failed += 1;

  console.log(`## ${s.label}`);
  console.log(`  critical-path: ${crit.total}  (budget ≤ ${ceiling})  ${red ? 'RED' : 'ok'}`);
  for (const d of crit.detail) console.log(`    - ${d.name}: ${d.n}`);
  console.log(`  + layout overhead ~${layout.total} → ~${grand} API calls first ~10s`);
  console.log('');
}

console.log(
  failed
    ? `FAIL: ${failed} scenario(s) over budget.`
    : 'PASS: all scenarios within budget.'
);
process.exit(failed ? 1 : 0);
