/**
 * Diagnose Currency card delayed expand on dashboard.
 *
 * Usage:
 *   node scripts/playwright-currency-reveal-diagnose.mjs [--url=https://count168.site] [--dashboard=/dashboard/UUID]
 *
 * Env overrides: PW_DASH_COMPANY, PW_DASH_USER, PW_DASH_PASS, PW_SECONDARY_PASS
 */
import { chromium } from "playwright";

const BASE =
  process.argv.find((a) => a.startsWith("--url="))?.slice(6) || "https://count168.site";
const DASH_PATH =
  process.argv.find((a) => a.startsWith("--dashboard="))?.slice(12) ||
  "/dashboard/f758d9be-bed3-4576-87c0-7c4c39331b87";
const COMPANY = process.env.PW_DASH_COMPANY || "test";
const USER = process.env.PW_DASH_USER || "test";
const PASS = process.env.PW_DASH_PASS || "1";
const SECONDARY = process.env.PW_SECONDARY_PASS || "222222";

function log(msg) {
  console.log(`  · ${msg}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

/** Inject a lightweight timeline observer before navigation settles. */
async function installTimelineProbe() {
  await page.addInitScript(() => {
    window.__dashTimeline = [];
    const push = (event, detail = {}) => {
      window.__dashTimeline.push({ t: performance.now(), event, ...detail });
    };

    const obs = new MutationObserver(() => {
      const hero = document.querySelector(".dashboard-summary-hero-value");
      const heroText = (hero?.innerText || "").trim();
      const kpiCards = document.querySelectorAll(".dashboard-kpi-card");
      const currencyList = document.querySelector(".dashboard-summary-currency-list");
      const topRow = document.querySelector(".dashboard-summary-top-row");

      if (heroText && /[1-9]/.test(heroText.replace(/[.,]/g, ""))) {
        if (!window.__heroReadyAt) {
          window.__heroReadyAt = performance.now();
          push("hero_nonzero", { text: heroText });
        }
      }

      if (currencyList?.classList.contains("is-revealed") && !window.__currencyRevealedAt) {
        window.__currencyRevealedAt = performance.now();
        push("currency_list_is_revealed", {
          classes: currencyList.className,
        });
      }

      if (topRow?.classList.contains("is-revealed") && !window.__topRowRevealedAt) {
        window.__topRowRevealedAt = performance.now();
        push("top_row_is_revealed");
      }

      const rows = currencyList
        ? [...currencyList.querySelectorAll(".dashboard-summary-currency-row")]
        : [];
      rows.forEach((row, i) => {
        const key = `row_${i}`;
        const style = getComputedStyle(row);
        const opacity = parseFloat(style.opacity || "0");
        if (opacity > 0.95 && !window[`__${key}_visible`]) {
          window[`__${key}_visible`] = performance.now();
          const amt = row.querySelector(".dashboard-summary-currency-amount");
          push("currency_row_visible", {
            index: i,
            code: row.querySelector(".dashboard-summary-currency-code")?.innerText?.trim(),
            amount: amt?.innerText?.trim(),
            opacity,
          });
        }
      });

      if (kpiCards.length && !window.__kpiPaintedAt) {
        const anyVal = [...kpiCards].some((c) => {
          const v = c.querySelector(".kpi-card-main .dashboard-animated-value, .kpi-card-main");
          return v && /[0-9]/.test((v.innerText || "").replace(/[.,]/g, ""));
        });
        if (anyVal) {
          window.__kpiPaintedAt = performance.now();
          push("kpi_cards_painted");
        }
      }
    });

    obs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    window.__dashTimelineStart = performance.now();
    push("probe_installed");
  });
}

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
  await page.waitForTimeout(800);

  if (page.url().includes("secondary-password")) {
    log("secondary password page — filling");
    const secInput = page.locator("#secondary_password, input[name='secondary_password']").first();
    await secInput.waitFor({ timeout: 15000 });
    await secInput.fill(SECONDARY);
    await Promise.all([
      page.waitForURL(/dashboard|home|member/, { timeout: 60000 }).catch(() => {}),
      page.locator('button[type="submit"]').first().click(),
    ]);
    await page.waitForTimeout(800);
  }
}

async function readSnapshot(label) {
  return page.evaluate((lbl) => {
    const currencyList = document.querySelector(".dashboard-summary-currency-list");
    const topRow = document.querySelector(".dashboard-summary-top-row");
    const hero = document.querySelector(".dashboard-summary-hero-value");
    const filterCurrencyRow = [...document.querySelectorAll(".user-gc-inline-row")].find((r) =>
      (r.querySelector(".user-gc-inline-label")?.innerText || "").toLowerCase().includes("currency")
    );
    const currencyPills = filterCurrencyRow
      ? [...filterCurrencyRow.querySelectorAll("[data-currency-code]")].map((b) => ({
          code: b.getAttribute("data-currency-code"),
          on: (b.className || "").includes("is-on"),
        }))
      : [];

    const rows = currencyList
      ? [...currencyList.querySelectorAll(".dashboard-summary-currency-row")].map((row, i) => {
          const style = getComputedStyle(row);
          return {
            i,
            code: row.querySelector(".dashboard-summary-currency-code")?.innerText?.trim(),
            amount: row.querySelector(".dashboard-summary-currency-amount")?.innerText?.trim(),
            opacity: style.opacity,
            transform: style.transform,
            animationName: style.animationName,
            animationDelay: style.animationDelay,
          };
        })
      : [];

    const listStyle = currencyList ? getComputedStyle(currencyList) : null;

    return {
      label: lbl,
      url: location.href,
      hero: (hero?.innerText || "").trim(),
      topRowRevealed: topRow?.classList.contains("is-revealed") ?? false,
      currencyListRevealed: currencyList?.classList.contains("is-revealed") ?? false,
      currencyListClasses: currencyList?.className || null,
      currencyListOpacity: listStyle?.opacity,
      currencyListTransform: listStyle?.transform,
      currencyListTransition: listStyle?.transitionProperty,
      currencyPills,
      rowCount: rows.length,
      rows,
      timeline: window.__dashTimeline || [],
      marks: {
        heroReadyAt: window.__heroReadyAt ?? null,
        topRowRevealedAt: window.__topRowRevealedAt ?? null,
        currencyRevealedAt: window.__currencyRevealedAt ?? null,
        scopeLoadingDoneAt: window.__scopeLoadingDoneAt ?? null,
        probeStart: window.__dashTimelineStart ?? null,
      },
    };
  }, label);
}

await installTimelineProbe();
await login();
log(`logged in → ${page.url()}`);

const dashUrl = `${BASE}${DASH_PATH.startsWith("/") ? DASH_PATH : `/${DASH_PATH}`}`;
if (!page.url().includes(DASH_PATH.replace(/^\//, ""))) {
  await page.goto(dashUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
}
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
const navStart = Date.now();
log(`reloaded dashboard for fresh reveal sequence`);

// Wait for filter panel or summary card shell
await page.waitForSelector(".dashboard-filter-panel, .dashboard-panel-card--summary", {
  timeout: 45000,
});
const tShell = Date.now() - navStart;
log(`dashboard shell visible at +${tShell}ms`);

// Trigger a date-range change to re-run KPI → Currency reveal pipeline.
const clickPreset = (key) =>
  page.evaluate((k) => {
    const el = document.getElementById("calendar-popup");
    if (el) el.setAttribute("data-open", "true");
    const btn = document.querySelector(`.transaction-calendar-preset[data-period-key="${k}"]`);
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  }, key);

await clickPreset("lastMonth");
await page.waitForTimeout(800);
const filterChangeStart = Date.now();
await page.evaluate(() => {
  window.__dashTimeline = [];
  window.__heroReadyAt = null;
  window.__currencyRevealedAt = null;
  window.__topRowRevealedAt = null;
  window.__kpiPaintedAt = null;
  window.__scopeLoadingDoneAt = null;
  for (let i = 0; i < 20; i += 1) window[`__row_${i}_visible`] = null;
  window.__dashTimelineStart = performance.now();
  window.__dashTimeline.push({ t: performance.now(), event: "filter_change_thisYear" });
  window.__wasScopeBusy = !!document.querySelector(".dashboard-data-surface[aria-busy='true']");

  if (window.__dashPoll) clearInterval(window.__dashPoll);
  window.__dashPoll = setInterval(() => {
    const push = (event, detail = {}) => {
      window.__dashTimeline.push({ t: performance.now(), event, ...detail });
    };
    const hero = document.querySelector(".dashboard-summary-hero-value");
    const heroText = (hero?.innerText || "").trim();
    const currencyList = document.querySelector(".dashboard-summary-currency-list");
    const topRow = document.querySelector(".dashboard-summary-top-row");
    const busy = document.querySelector(".dashboard-data-surface[aria-busy='true']");
    if (window.__wasScopeBusy && !busy && !window.__scopeLoadingDoneAt) {
      window.__scopeLoadingDoneAt = performance.now();
      push("scope_loading_done_kpiChartReady");
    }
    window.__wasScopeBusy = !!busy;

    if (heroText && /[1-9-]/.test(heroText.replace(/[.,]/g, "")) && heroText !== "0.00") {
      if (!window.__heroReadyAt) {
        window.__heroReadyAt = performance.now();
        push("hero_nonzero", { text: heroText });
      }
    }

    if (topRow?.classList.contains("is-revealed") && !window.__topRowRevealedAt) {
      window.__topRowRevealedAt = performance.now();
      push("top_row_is_revealed");
    }

    if (currencyList?.classList.contains("is-revealed") && !window.__currencyRevealedAt) {
      window.__currencyRevealedAt = performance.now();
      push("currency_list_is_revealed");
    }

    const rows = currencyList
      ? [...currencyList.querySelectorAll(".dashboard-summary-currency-row")]
      : [];
    rows.forEach((row, i) => {
      const key = `row_${i}`;
      const style = getComputedStyle(row);
      const opacity = parseFloat(style.opacity || "0");
      if (opacity > 0.98 && !window[`__${key}_visible`]) {
        window[`__${key}_visible`] = performance.now();
        const amt = row.querySelector(".dashboard-summary-currency-amount");
        push("currency_row_visible", {
          index: i,
          code: row.querySelector(".dashboard-summary-currency-code")?.innerText?.trim(),
          amount: amt?.innerText?.trim(),
        });
      }
    });
  }, 16);
});
const ok = await clickPreset("thisYear");
log(`clicked This Year preset: ${ok}`);
const navStart2 = filterChangeStart;

// Poll snapshots until currency list reveals or timeout
const deadline = Date.now() + 35000;
const snapshots = [];
while (Date.now() < deadline) {
  const snap = await readSnapshot(`t+${Date.now() - navStart2}ms`);
  snapshots.push(snap);
  if (snap.currencyListRevealed && snap.rows.some((r) => parseFloat(r.opacity) > 0.9)) break;
  await page.waitForTimeout(200);
}

const final = snapshots[snapshots.length - 1] || (await readSnapshot("final"));
const marks = final.marks || {};
const base = marks.probeStart ?? 0;

console.log("\n=== CURRENCY REVEAL DIAGNOSIS ===");
console.log(`URL: ${dashUrl}`);
console.log(`Account: company=${COMPANY} user=${USER}`);
console.log(`Shell visible: +${tShell}ms from navigation`);

if (marks.scopeLoadingDoneAt != null) {
  console.log(`Scope loading done (kpiChartReady): +${Math.round(marks.scopeLoadingDoneAt - base)}ms`);
}
if (marks.heroReadyAt != null) {
  console.log(`Hero non-zero value: +${Math.round(marks.heroReadyAt - base)}ms`);
}
if (marks.topRowRevealedAt != null) {
  console.log(`Top row (pie/hero) is-revealed: +${Math.round(marks.topRowRevealedAt - base)}ms`);
}
if (marks.currencyRevealedAt != null) {
  console.log(`Currency list is-revealed: +${Math.round(marks.currencyRevealedAt - base)}ms`);
}

if (marks.scopeLoadingDoneAt != null && marks.currencyRevealedAt != null) {
  const pacedGap = Math.round(marks.currencyRevealedAt - marks.scopeLoadingDoneAt);
  console.log(`Gap scope-ready → currency is-revealed: ${pacedGap}ms (intentional min 450ms + data wait)`);
}

console.log("\n--- Final DOM state ---");
console.log(`Hero: ${final.hero}`);
console.log(`Top row revealed: ${final.topRowRevealed}`);
console.log(`Currency list revealed: ${final.currencyListRevealed}`);
console.log(`Currency list classes: ${final.currencyListClasses}`);
console.log(`Filter currency pills: ${JSON.stringify(final.currencyPills)}`);
console.log(`Currency rows (${final.rowCount}):`);
for (const r of final.rows) {
  console.log(
    `  [${r.i}] ${r.code} amount=${r.amount} opacity=${r.opacity} anim=${r.animationName} delay=${r.animationDelay}`
  );
}

console.log("\n--- Timeline events ---");
for (const ev of final.timeline) {
  console.log(`  +${Math.round(ev.t - base)}ms  ${ev.event}${ev.code ? ` (${ev.code})` : ""}${ev.text ? ` text=${ev.text}` : ""}`);
}

console.log("\n--- Root cause (from codebase) ---");
console.log("1. JS gate: CURRENCY_CARD_MIN_GAP_AFTER_KPI_MS = 450 — currency waits ≥450ms after kpiChartReady");
console.log("2. Data gate: earningsByCurrencyLoading must finish + at least one row with earnings");
console.log("3. CSS: .dashboard-summary-reveal starts opacity:0 scale(0.85); is-revealed animates 0.7s");
console.log("4. CSS: each .dashboard-summary-currency-row staggers in (+0.06s per row, 0.5s animation)");

await browser.close();
