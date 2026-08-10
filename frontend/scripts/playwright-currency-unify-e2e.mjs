/**
 * E2E: Currency filter row + currency card should expand uniformly with Group/Company.
 *
 * Usage:
 *   node scripts/playwright-currency-unify-e2e.mjs
 *
 * Env: PW_DASH_COMPANY PW_DASH_USER PW_DASH_PASS PW_SECONDARY_PASS
 */
import { chromium } from "playwright";

const BASE = process.argv.find((a) => a.startsWith("--url="))?.slice(6) || "https://count168.site";
const DASH =
  process.argv.find((a) => a.startsWith("--dashboard="))?.slice(12) ||
  "/dashboard/f758d9be-bed3-4576-87c0-7c4c39331b87";
const COMPANY = process.env.PW_DASH_COMPANY || "test";
const USER = process.env.PW_DASH_USER || "test";
const PASS = process.env.PW_DASH_PASS || "1";
const SECONDARY = process.env.PW_SECONDARY_PASS || "222222";

const PASS_GAP_MS = 150; // group/company vs currency filter row first paint
const PASS_CARD_GAP_MS = 100; // top row vs currency list is-revealed

function log(s) {
  console.log(`  · ${s}`);
}

function assert(cond, msg, failures) {
  if (!cond) {
    failures.push(msg);
    console.log(`  ✗ FAIL: ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const failures = [];

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#company-id", { timeout: 30000 });
  await page.locator("#company-id").fill(COMPANY);
  await page.locator("#user-id").fill(USER);
  await page.locator("#password").fill(PASS);
  await Promise.all([
    page.waitForURL(/dashboard|home|member|secondary-password/, { timeout: 60000 }).catch(() => {}),
    page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first().click(),
  ]);
  await page.waitForTimeout(600);
  if (page.url().includes("secondary-password")) {
    const sec = page.locator("#secondary_password, input[name='secondary_password']").first();
    await sec.waitFor({ timeout: 15000 });
    await sec.fill(SECONDARY);
    await Promise.all([
      page.waitForURL(/dashboard|home|member/, { timeout: 60000 }).catch(() => {}),
      page.locator('button[type="submit"]').first().click(),
    ]);
    await page.waitForTimeout(600);
  }
}

function startFilterTimeline() {
  return page.evaluate(() => {
    window.__filterTL = [];
    window.__filterMarks = {
      groupAt: null,
      companyAt: null,
      currencyAt: null,
      currencyCount: 0,
      topRowRevealedAt: null,
      currencyListRevealedAt: null,
      start: performance.now(),
    };
    if (window.__filterPoll) clearInterval(window.__filterPoll);
    const push = (e, d = {}) => window.__filterTL.push({ t: performance.now(), e, ...d });
    window.__filterPoll = setInterval(() => {
      const rows = [...document.querySelectorAll(".user-gc-inline-row")];
      const findRow = (re) =>
        rows.find((r) => re.test((r.querySelector(".user-gc-inline-label")?.innerText || "").trim()));

      const g = findRow(/group/i);
      const c = findRow(/^company$/i);
      const cur = findRow(/^currency$/i);

      if (g && !window.__filterMarks.groupAt) {
        window.__filterMarks.groupAt = performance.now();
        push("group_row");
      }
      if (c && !window.__filterMarks.companyAt) {
        window.__filterMarks.companyAt = performance.now();
        push("company_row");
      }
      if (cur) {
        const pills = cur.querySelectorAll("[data-currency-code]");
        if (pills.length > 0 && !window.__filterMarks.currencyAt) {
          window.__filterMarks.currencyAt = performance.now();
          window.__filterMarks.currencyCount = pills.length;
          push("currency_row", { count: pills.length });
        }
      }

      const top = document.querySelector(".dashboard-summary-top-row");
      const list = document.querySelector(".dashboard-summary-currency-list");
      if (top?.classList.contains("is-revealed") && !window.__filterMarks.topRowRevealedAt) {
        window.__filterMarks.topRowRevealedAt = performance.now();
        push("top_row_revealed");
      }
      if (list?.classList.contains("is-revealed") && !window.__filterMarks.currencyListRevealedAt) {
        window.__filterMarks.currencyListRevealedAt = performance.now();
        push("currency_list_revealed", { classes: list.className });
      }
    }, 16);
  });
}

async function stopAndRead() {
  return page.evaluate(() => {
    if (window.__filterPoll) clearInterval(window.__filterPoll);
    const m = window.__filterMarks || {};
    const base = m.start || 0;
    const rel = (t) => (t == null ? null : Math.round(t - base));
    return {
      groupMs: rel(m.groupAt),
      companyMs: rel(m.companyAt),
      currencyMs: rel(m.currencyAt),
      currencyCount: m.currencyCount || 0,
      topRowMs: rel(m.topRowRevealedAt),
      currencyListMs: rel(m.currencyListRevealedAt),
      timeline: (window.__filterTL || []).map((x) => ({
        e: x.e,
        ms: Math.round(x.t - base),
        count: x.count,
      })),
      snaps: {
        currencyPills: (() => {
          const row = [...document.querySelectorAll(".user-gc-inline-row")].find((r) =>
            /^currency$/i.test((r.querySelector(".user-gc-inline-label")?.innerText || "").trim())
          );
          if (!row) return [];
          return [...row.querySelectorAll("[data-currency-code]")].map((b) => ({
            code: b.getAttribute("data-currency-code"),
            on: b.classList.contains("is-on"),
          }));
        })(),
        listRevealed: !!document
          .querySelector(".dashboard-summary-currency-list")
          ?.classList.contains("is-revealed"),
        topRevealed: !!document
          .querySelector(".dashboard-summary-top-row")
          ?.classList.contains("is-revealed"),
        hero: (document.querySelector(".dashboard-summary-hero-value")?.innerText || "").trim(),
        groupActive: (
          document.querySelector(".user-gc-inline-row .user-gc-segment.is-on")?.innerText || ""
        ).trim(),
      },
    };
  });
}

async function clickCompanyPill(label) {
  const companyRow = page
    .locator(".user-gc-inline-row")
    .filter({ has: page.locator(".user-gc-inline-label", { hasText: /^company$/i }) })
    .first();
  const btn = companyRow.locator("button.user-gc-segment", { hasText: new RegExp(`^${label}$`, "i") }).first();
  if ((await btn.count()) === 0) return false;
  await btn.click();
  return true;
}

async function waitForCurrencyPills(timeoutMs = 20000) {
  await page.waitForFunction(
    () => {
      const row = [...document.querySelectorAll(".user-gc-inline-row")].find((r) =>
        /^currency$/i.test((r.querySelector(".user-gc-inline-label")?.innerText || "").trim())
      );
      return row && row.querySelectorAll("[data-currency-code]").length > 0;
    },
    { timeout: timeoutMs }
  );
}

// ---------- RUN ----------
console.log("\n=== CURRENCY UNIFY E2E ===");
console.log(`URL: ${BASE}${DASH}`);
console.log(`Account: ${COMPANY} / ${USER}\n`);

await login();
log(`logged in → ${page.url()}`);

// Cold-ish reload of target dashboard
const dashUrl = `${BASE}${DASH.startsWith("/") ? DASH : `/${DASH}`}`;
if (!page.url().includes(DASH.replace(/^\//, "").slice(0, 20))) {
  await page.goto(dashUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
}
await startFilterTimeline();
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
log("reloaded dashboard (measure 1: first paint after login)");

await page.waitForSelector(".dashboard-filter-panel, .user-gc-inline-row", { timeout: 45000 });
await waitForCurrencyPills().catch(() => {});
await page.waitForTimeout(2500); // settle KPI/currency card
const m1 = await stopAndRead();

console.log("\n--- Measure 1: reload after login ---");
console.log(
  `  group=${m1.groupMs}ms company=${m1.companyMs}ms currencyPills=${m1.currencyMs}ms (n=${m1.currencyCount})`
);
console.log(`  topRow=${m1.topRowMs}ms currencyList=${m1.currencyListMs}ms`);
console.log(`  pills: ${m1.snaps.currencyPills.map((p) => p.code + (p.on ? "*" : "")).join(", ")}`);
console.log(`  hero=${m1.snaps.hero}`);

if (m1.companyMs != null && m1.currencyMs != null) {
  const gap = m1.currencyMs - m1.companyMs;
  assert(
    gap <= PASS_GAP_MS,
    `filter Currency vs Company gap ${gap}ms ≤ ${PASS_GAP_MS}ms`,
    failures
  );
} else {
  assert(m1.currencyMs != null, "Currency filter row appeared", failures);
}

assert(m1.snaps.listRevealed, "Currency summary list is-revealed", failures);
assert(m1.snaps.topRevealed, "Summary top row is-revealed", failures);
if (m1.topRowMs != null && m1.currencyListMs != null) {
  const cg = Math.abs(m1.currencyListMs - m1.topRowMs);
  assert(cg <= PASS_CARD_GAP_MS, `summary top vs currency list gap ${cg}ms ≤ ${PASS_CARD_GAP_MS}ms`, failures);
}
assert(m1.currencyCount >= 1, `currency pill count ≥1 (got ${m1.currencyCount})`, failures);

// Measure 2: switch company TEST02 then back to TEST — re-measure currency lag
console.log("\n--- Measure 2: company switch TEST → TEST02 → TEST ---");
const switchedAway = await clickCompanyPill("TEST02");
if (switchedAway) {
  await page.waitForTimeout(2000);
  await startFilterTimeline();
  const back = await clickCompanyPill("TEST");
  assert(back, "clicked back to TEST company", failures);
  await waitForCurrencyPills().catch(() => {});
  await page.waitForTimeout(2000);
  const m2 = await stopAndRead();
  console.log(
    `  group=${m2.groupMs}ms company=${m2.companyMs}ms currencyPills=${m2.currencyMs}ms (n=${m2.currencyCount})`
  );
  if (m2.companyMs != null && m2.currencyMs != null) {
    const gap2 = m2.currencyMs - m2.companyMs;
    // On switch, company row already exists; currency row should already be visible or reappear fast
    assert(
      gap2 <= PASS_GAP_MS || m2.currencyMs <= 100,
      `after company switch Currency gap ${gap2}ms (currency@${m2.currencyMs}ms) ≤ ${PASS_GAP_MS}ms`,
      failures
    );
  } else {
    assert(m2.currencyCount > 0 || m2.snaps.currencyPills.length > 0, "Currency pills after company switch", failures);
  }
  assert(m2.snaps.listRevealed, "Currency list revealed after company switch", failures);
} else {
  log("TEST02 pill not found — skip company switch case");
}

// Measure 3: second reload (warm sessionStorage path)
console.log("\n--- Measure 3: second reload (warm currency session cache) ---");
await startFilterTimeline();
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".user-gc-inline-row", { timeout: 45000 });
await waitForCurrencyPills().catch(() => {});
await page.waitForTimeout(1500);
const m3 = await stopAndRead();
console.log(
  `  group=${m3.groupMs}ms company=${m3.companyMs}ms currencyPills=${m3.currencyMs}ms (n=${m3.currencyCount})`
);
if (m3.companyMs != null && m3.currencyMs != null) {
  const gap3 = m3.currencyMs - m3.companyMs;
  assert(gap3 <= PASS_GAP_MS, `warm reload Currency vs Company gap ${gap3}ms ≤ ${PASS_GAP_MS}ms`, failures);
}

// Deploy footprint heuristic: session key + displayCurrencies plumbing can't be seen remotely;
// check that currency list starts already revealed (currencyCardReady=true deploy marker).
const alwaysRevealed = await page.evaluate(() => {
  const list = document.querySelector(".dashboard-summary-currency-list");
  return {
    hasList: !!list,
    revealed: list?.classList.contains("is-revealed") ?? false,
    rowAnimDelays: list
      ? [...list.querySelectorAll(".dashboard-summary-currency-row")]
          .slice(0, 4)
          .map((r) => getComputedStyle(r).animationDelay)
      : [],
  };
});
console.log("\n--- Deploy markers ---");
console.log(`  currency list is-revealed: ${alwaysRevealed.revealed}`);
console.log(`  row animation-delay (first 4): ${JSON.stringify(alwaysRevealed.rowAnimDelays)}`);

console.log("\n=== SUMMARY ===");
if (failures.length === 0) {
  console.log("RESULT: PASS — Currency filter/card expand looks unified.");
} else {
  console.log(`RESULT: FAIL — ${failures.length} issue(s):`);
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exitCode = 1;
}

await browser.close();
