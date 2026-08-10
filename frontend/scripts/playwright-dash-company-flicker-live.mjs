/**
 * Headed (no screenshots): measure company pill churn on live dashboard.
 * Usage: node scripts/playwright-dash-company-flicker-live.mjs
 */
import { chromium } from "playwright";

const BASE = "https://count168.site";
const DASH = "/dashboard/f758d9be-bed3-4576-87c0-7c4c39331b87";
const COMPANY = process.env.PW_DASH_COMPANY || "test";
const USER = process.env.PW_DASH_USER || "test";
const PASS = process.env.PW_DASH_PASS || "1";
const SECONDARY = process.env.PW_SECONDARY_PASS || "222222";
const HEADLESS = process.argv.includes("--headless") || process.env.PW_HEADLESS === "1";

const browser = await chromium.launch({
  headless: HEADLESS,
  slowMo: HEADLESS ? 0 : 120,
});
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();

await page.addInitScript(() => {
  window.__coBoot = { start: performance.now(), events: [], last: "" };
  const dig = () => {
    try {
      const rows = [...document.querySelectorAll(".user-gc-inline-row")];
      const row = rows.find((r) =>
        /company|公司/i.test((r.querySelector(".user-gc-inline-label")?.innerText || "").trim())
      );
      let sig = "ABSENT";
      if (row) {
        const btns = [...row.querySelectorAll("button.user-gc-segment")];
        sig = btns.length
          ? btns
              .map((b) => `${(b.innerText || "").trim()}:${b.classList.contains("is-on") ? 1 : 0}`)
              .join("|")
          : "EMPTY_ROW";
      }
      const curN = document.querySelectorAll("#currency-buttons-container [data-currency-code]").length;
      const full = `${sig}||cur=${curN}`;
      if (full !== window.__coBoot.last) {
        window.__coBoot.last = full;
        window.__coBoot.events.push({
          t: Math.round(performance.now() - window.__coBoot.start),
          company: sig,
          currencyPills: curN,
        });
      }
    } catch {
      /* ignore */
    }
  };
  const start = () => {
    dig();
    new MutationObserver(dig).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    setInterval(dig, 32);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
});

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#company-id").fill(COMPANY);
  await page.locator("#user-id").fill(USER);
  await page.locator("#password").fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(800);
  if (page.url().includes("secondary-password")) {
    await page.locator("#secondary_password, input[name='secondary_password']").first().fill(SECONDARY);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(800);
  }
}

function printBoot(title, boot) {
  console.log(`\n=== ${title} ===`);
  (boot?.events || []).forEach((e) => {
    console.log(`  +${e.t}ms  company=[${e.company}]  currency=${e.currencyPills}`);
  });
}

console.log(`\n=== Company pill flicker live ===`);
console.log(`Mode: ${HEADLESS ? "headless" : "HEADED"}  (no screenshots)`);
console.log(`URL: ${BASE}${DASH}`);

await login();
console.log(`  · logged in → ${page.url()}`);

// Cold navigation
await page.evaluate(() => {
  window.__coBoot = { start: performance.now(), events: [], last: "" };
});
await page.goto(`${BASE}${DASH}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4500);
const boot1 = await page.evaluate(() => window.__coBoot);
printBoot("Cold navigate", boot1);

// Hard reload
await page.evaluate(() => {
  window.__coBoot = { start: performance.now(), events: [], last: "" };
});
await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4500);
const boot2 = await page.evaluate(() => window.__coBoot);
printBoot("Hard reload", boot2);

// Company All → TEST → TEST02 → TEST
async function clickCompany(label) {
  return page.evaluate((lab) => {
    const rows = [...document.querySelectorAll(".user-gc-inline-row")];
    const row = rows.find((r) =>
      /company|公司/i.test((r.querySelector(".user-gc-inline-label")?.innerText || "").trim())
    );
    const btn = [...(row?.querySelectorAll("button.user-gc-segment") || [])].find(
      (b) => (b.innerText || "").trim().toUpperCase() === lab.toUpperCase()
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
}

await page.evaluate(() => {
  window.__coBoot = { start: performance.now(), events: [], last: "" };
});
const okAll = await clickCompany("All");
await page.waitForTimeout(2000);
const okT2 = await clickCompany("TEST02");
await page.waitForTimeout(1800);
const okT = await clickCompany("TEST");
await page.waitForTimeout(2500);
const boot3 = await page.evaluate(() => window.__coBoot);
console.log(`\nclicks: All=${okAll} TEST02=${okT2} TEST=${okT}`);
printBoot("Switch All → TEST02 → TEST", boot3);

// Analyze
function analyze(boot, label) {
  const ev = boot?.events || [];
  const nonAbsent = ev.filter((e) => e.company !== "ABSENT");
  const emptyRow = ev.some((e) => e.company === "EMPTY_ROW");
  const midAbsent = (() => {
    let saw = false;
    for (const e of ev) {
      if (e.company !== "ABSENT" && e.company !== "EMPTY_ROW") saw = true;
      if (saw && (e.company === "ABSENT" || e.company === "EMPTY_ROW")) return true;
    }
    return false;
  })();
  const sigs = [...new Set(nonAbsent.map((e) => e.company))];
  // count is-on pill identity changes among company pills
  let onFlips = 0;
  for (let i = 1; i < nonAbsent.length; i++) {
    const a = nonAbsent[i - 1].company.split("|").find((x) => x.endsWith(":1"));
    const b = nonAbsent[i].company.split("|").find((x) => x.endsWith(":1"));
    if (a && b && a !== b) onFlips++;
  }
  const firstCo = nonAbsent.find((e) => e.company !== "EMPTY_ROW");
  const firstCur = ev.find((e) => e.currencyPills > 0);
  const currencyLag =
    firstCo && firstCur ? firstCur.t - firstCo.t : firstCur ? firstCur.t : null;

  console.log(`\n--- Analysis: ${label} ---`);
  console.log(`  empty company row seen: ${emptyRow}`);
  console.log(`  mid-stream company gone: ${midAbsent}`);
  console.log(`  unique company sigs (${sigs.length}): ${sigs.join("  ||  ")}`);
  console.log(`  is-on flips: ${onFlips}`);
  console.log(`  currency lag after company pills: ${currencyLag}ms`);

  const issues = [];
  if (emptyRow) issues.push("EMPTY_ROW");
  if (midAbsent) issues.push("MID_ABSENT");
  // cold boot: more than 1 is-on without user click is flicker
  if (label.startsWith("Cold") || label.startsWith("Hard")) {
    if (onFlips > 1) issues.push(`BOOT_ON_FLIPS_${onFlips}`);
    if (sigs.length > 2) issues.push(`BOOT_SIGS_${sigs.length}`);
  }
  return issues;
}

const issues = [
  ...analyze(boot1, "Cold navigate").map((x) => `cold:${x}`),
  ...analyze(boot2, "Hard reload").map((x) => `reload:${x}`),
  ...analyze(boot3, "Switch path").map((x) => `switch:${x}`),
];

// intentional flips on switch: All, TEST02, TEST = up to 3
const switchOn = boot3?.events || [];
// don't flag switch for intentional flips

console.log("\n=== LIVE VERDICT ===");
const bootIssues = issues.filter((i) => !i.startsWith("switch:"));
if (bootIssues.length === 0) {
  console.log("AUTOMATED: no empty-row / mid-absent / multi is-on bounce on cold/reload");
  console.log("NOTE: user-visible flicker may still be CSS reflow or sub-frame is-on not captured");
} else {
  console.log("AUTOMATED FAILURES:");
  bootIssues.forEach((i) => console.log(`  - ${i}`));
}
console.log("ALL flags:", issues.join(", ") || "(none)");

if (!HEADLESS) {
  console.log("\nBrowser open 3s…");
  await page.waitForTimeout(3000);
}
await browser.close();
process.exitCode = bootIssues.length ? 1 : 0;
