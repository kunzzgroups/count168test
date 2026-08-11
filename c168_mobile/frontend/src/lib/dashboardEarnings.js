import {
  computeDisplayConvertedAmount,
  formatFrankfurterUnitRate,
} from "./frankfurterRates.js";
import {
  DASHBOARD_CURRENCY_COLORS,
  DASHBOARD_CURRENCY_FALLBACK_PALETTE,
} from "./dashboardConstants.js";

export function getCurrencyColor(code, fallbackIndex = 0) {
  const key = String(code || "").toUpperCase();
  if (DASHBOARD_CURRENCY_COLORS[key]) return DASHBOARD_CURRENCY_COLORS[key];
  return DASHBOARD_CURRENCY_FALLBACK_PALETTE[fallbackIndex % DASHBOARD_CURRENCY_FALLBACK_PALETTE.length];
}

/** Dual-metric rows → pie/table shape for Currency (net profit) vs Earning tab. */
export function mapPanelCurrencyRows(rows, view, { useConverted = false } = {}) {
  const earningTab = view === "earning";
  return (rows || []).map((row) => {
    const native = earningTab ? row.earnings : row.netProfit;
    const converted = earningTab ? row.earningsConverted : row.netProfitConverted;
    const amount = useConverted && converted != null ? converted : native;
    return {
      ...row,
      earnings: amount,
      originalEarnings: native,
      earningsConverted: converted,
    };
  });
}

export function buildEarningsPieSlices(rows, { useConverted = false, baseCode = "" } = {}) {
  const base = String(baseCode || "").toUpperCase();
  const sourceRows = (() => {
    // Without FX conversion, native multi-currency amounts are not comparable —
    // only the display-base slice belongs on the pie.
    if (!useConverted && base) {
      const codes = new Set(
        (rows || []).map((row) => String(row.code || "").toUpperCase()).filter(Boolean),
      );
      if (codes.size > 1 && codes.has(base)) {
        return (rows || []).filter((row) => String(row.code || "").toUpperCase() === base);
      }
    }
    return rows || [];
  })();

  return sourceRows
    .filter((row) => row.earnings != null)
    .map((row, index) => {
      const earnings = useConverted
        ? row.earningsConverted != null
          ? row.earningsConverted
          : null
        : row.earnings;
      if (earnings == null) return null;
      const value = Math.abs(earnings);
      if (value < 0.0001) return null;
      return {
        code: row.code,
        earnings,
        value,
        fill: getCurrencyColor(row.code, index),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value);
}

function resolveRowShareAmount(row, useConverted) {
  if (useConverted) {
    if (row.earningsConverted == null) return null;
    return parseFloat(row.earningsConverted) || 0;
  }
  if (row.earnings == null) return null;
  return parseFloat(row.earnings) || 0;
}

export function buildEarningsShareByCode(rows, baseCode, { useConverted = false } = {}) {
  const base = String(baseCode || "").toUpperCase();
  const entries = (rows || [])
    .map((row) => {
      const code = String(row.code || "").toUpperCase();
      const amount = resolveRowShareAmount(row, useConverted);
      if (amount == null) return null;
      return { code, abs: Math.abs(amount) };
    })
    .filter(Boolean);

  const shareByCode = {};
  for (const row of rows || []) {
    shareByCode[String(row.code || "").toUpperCase()] = 0;
  }

  const absTotal = entries.reduce((sum, entry) => sum + entry.abs, 0);
  if (!absTotal) return shareByCode;

  let othersSum = 0;
  for (const { code, abs } of entries) {
    if (code === base) continue;
    const pct = (abs / absTotal) * 100;
    shareByCode[code] = pct;
    othersSum += pct;
  }

  if (entries.some((entry) => entry.code === base)) {
    shareByCode[base] = Math.max(0, 100 - othersSum);
  }

  return shareByCode;
}

export function computePieCenterMetrics(rows, selectedCode, { useConverted = false } = {}) {
  const selected = String(selectedCode || "").toUpperCase();
  const shareByCode = buildEarningsShareByCode(rows, selectedCode, { useConverted });
  const pct = (shareByCode[selected] ?? 0).toFixed(1);
  return { pct, code: selected || "—" };
}

export function resolveEarningsRowDisplayAmounts(row, baseCode, rates, useConverted) {
  const code = String(row?.code || "").toUpperCase();
  const base = String(baseCode || "").toUpperCase();
  const native = row?.earnings;
  if (native == null) return { primary: null, native: null };
  if (!useConverted || code === base) {
    return { primary: native, native: null };
  }
  const converted =
    row.earningsConverted != null
      ? row.earningsConverted
      : computeDisplayConvertedAmount(native, code, base, rates);
  if (converted == null) return { primary: null, native };
  return { primary: converted, native };
}

export { formatFrankfurterUnitRate };
