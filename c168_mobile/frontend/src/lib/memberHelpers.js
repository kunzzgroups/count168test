import MoneyDecimal from "./money/moneyDecimal.js";

export function scopeQueryFields(compId, gid) {
  return gid ? { group_id: gid } : { company_id: String(compId) };
}

export function hasScope(compId, gid) {
  return Boolean(compId) || Boolean(gid);
}

export function parseJsonResponse(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    if (start === -1) return {};
    try {
      return JSON.parse(raw.slice(start));
    } catch {
      return {};
    }
  }
}

export function mapLinkedAccountsApiList(data) {
  if (!Array.isArray(data)) return [];
  return data.map((acc) => ({
    id: acc.id,
    account_id: acc.account_id || "",
    name: acc.name || "",
  }));
}

export function normalizeNumber(value) {
  try {
    return MoneyDecimal.toDecimal(value || "0", 0);
  } catch {
    return MoneyDecimal.toDecimal("0", 0);
  }
}

export function computeTableTotals(rows) {
  let totalWinLoss = normalizeNumber("0");
  let totalCrDr = normalizeNumber("0");
  let closingBalance = normalizeNumber("0");
  (rows || []).forEach((row) => {
    totalWinLoss = totalWinLoss.plus(normalizeNumber(row.win_loss));
    totalCrDr = totalCrDr.plus(normalizeNumber(row.cr_dr));
    if (row.balance !== "-" && row.balance != null && String(row.balance).trim() !== "") {
      closingBalance = normalizeNumber(row.balance);
    }
  });
  return { totalWinLoss, totalCrDr, closingBalance };
}

export function groupHistoryForDisplay(historyRows, isAllSelected, selectedCurrencies, availableCurrencies) {
  const map = new Map();
  const rows = Array.isArray(historyRows) ? historyRows : [];
  for (const row of rows) {
    const c = String(row.currency || "-").trim() || "-";
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(row);
  }
  if (isAllSelected) {
    const order = availableCurrencies.length > 0 ? availableCurrencies : Array.from(map.keys());
    return order.map((c) => [c, map.get(c) || []]).filter(([, list]) => list.length > 0);
  }
  if (!selectedCurrencies.length) return [];
  return selectedCurrencies.map((c) => [c, map.get(c) || []]);
}

export function applyCurrencyAllToggle() {
  return { isAllSelected: true, selectedCurrencies: [] };
}

export function applyCurrencyToggle(available, isAllSelected, selectedCurrencies, code) {
  const next = new Set(isAllSelected ? available : selectedCurrencies);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  const selected = available.filter((c) => next.has(c));
  if (selected.length === 0) return { isAllSelected: false, selectedCurrencies: [] };
  if (selected.length === available.length) return { isAllSelected: true, selectedCurrencies: [] };
  return { isAllSelected: false, selectedCurrencies: selected };
}

/** YYYY-MM-DD → DD/MM/YYYY for history_api */
export function ymdToDmy(ymd) {
  const [y, m, d] = String(ymd || "").split("-");
  if (!y || !m || !d) return "";
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

export function todayYmd() {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
