import { buildApiUrl } from "../utils/apiUrl.js";
import { orderCurrencyCodesForCompany } from "./currencyOrder.js";
import { fetchJson, assertApiOk } from "./fetchJson.js";

export function normalizeBankIssueFlag(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!s) return "";
  if (s.includes("e_invoice") || s.includes("einvoice") || s.includes("e invoice")) return "e_invoice";
  if (s.includes("official")) return "official";
  if (s.includes("block")) return "block";
  return "";
}

export function normalizeBankProcessStatus(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "active";
  if (s.includes("inactive")) return "inactive";
  if (s.includes("waiting")) return "waiting";
  if (s.includes("active")) return "active";
  return "active";
}

export function normalizeBankProcessRows(data) {
  if (!Array.isArray(data)) return [];
  return data.map((row) => ({
    ...row,
    type: String(row?.type || row?.types || "").trim(),
    status: normalizeBankProcessStatus(row?.status),
    issue_flag: normalizeBankIssueFlag(row?.issue_flag),
  }));
}

/** UI status pill — issue_flag wins over active/inactive. */
export function bankProcessDisplayStatus(row) {
  const flag = normalizeBankIssueFlag(row?.issue_flag);
  if (flag === "official") return "OFFICIAL";
  if (flag === "e_invoice") return "E-INVOICE";
  if (flag === "block") return "BLOCK";
  return normalizeBankProcessStatus(row?.status) === "inactive" ? "INACTIVE" : "ACTIVE";
}

export function matchesBankProcessStatusFilters(row, filters) {
  if (!row) return false;
  const { showActive, showInactive, showOfficial, showEInvoice, showBlock } = filters || {};
  const status = normalizeBankProcessStatus(row.status);
  const issueFlag = normalizeBankIssueFlag(row.issue_flag);
  const isPlainInactive =
    status === "inactive" &&
    issueFlag !== "official" &&
    issueFlag !== "e_invoice" &&
    issueFlag !== "block";
  const isDefaultActive =
    status === "active" &&
    issueFlag !== "official" &&
    issueFlag !== "e_invoice" &&
    issueFlag !== "block";
  const matches = [];
  if (showActive) matches.push(isDefaultActive);
  if (showInactive) matches.push(isPlainInactive);
  if (showOfficial) matches.push(issueFlag === "official");
  if (showEInvoice) matches.push(issueFlag === "e_invoice");
  if (showBlock) matches.push(issueFlag === "block");
  if (matches.length === 0) return isDefaultActive;
  return matches.some(Boolean);
}

export function filterBankProcessRowsBySearch(rows, searchTerm) {
  const q = String(searchTerm || "").trim().toUpperCase();
  if (!q || !Array.isArray(rows)) return rows || [];
  return rows.filter((r) => {
    const hay = [
      r?.country,
      r?.bank,
      r?.type,
      r?.types,
      r?.supplier,
      r?.card_lower,
      r?.customer,
      r?.name,
      r?.card_merchant_name,
      r?.card_merchant_account_id,
    ]
      .map((x) => String(x || "").toUpperCase())
      .join(" ");
    return hay.includes(q);
  });
}

function parseRowDateMs(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setHours(0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(s)) {
    const p = s.split(/[/-]/);
    const dd = Number(p[0]);
    const mm = Number(p[1]);
    const yy = Number(p[2]);
    const dt = new Date(yy, mm - 1, dd);
    dt.setHours(0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  }
  return null;
}

export function filterBankProcessRowsByDate(rows, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return rows;
  const fromMs = dateFrom ? parseRowDateMs(dateFrom) : null;
  const toMs = dateTo ? parseRowDateMs(dateTo) : null;
  const toEnd = toMs != null ? toMs + 86400000 - 1 : null;
  return rows.filter((r) => {
    const ts = parseRowDateMs(r.date || r.day_start);
    if (ts == null) return false;
    if (fromMs !== null && ts < fromMs) return false;
    if (toEnd !== null && ts > toEnd) return false;
    return true;
  });
}

export function formatBankMoney(value) {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (!raw) return "0.00";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function bankTypeLabel(row) {
  const bank = String(row?.bank || "").trim() || "—";
  const type = String(row?.type || row?.types || "").trim();
  return type ? `${bank} (${type})` : bank;
}

/** Whether company code has Bank category (desktop domain_api). */
export async function companyHasBankPermission(companyCode, signal) {
  const code = String(companyCode || "").trim();
  if (!code) return false;
  try {
    const { res, json } = await fetchJson(buildApiUrl("api/domain/domain_api.php"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_company_permissions", company_id: code }),
      signal,
    });
    if (!res.ok || !json?.success) return false;
    const permissions = Array.isArray(json?.data?.permissions) ? json.data.permissions : [];
    return permissions.map((p) => String(p || "").toLowerCase()).includes("bank");
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    return false;
  }
}

/**
 * Fetch bank process list for a numeric company id (desktop processlist_api).
 * @returns {{ rows: object[], currencyCodes: string[] }}
 */
export async function fetchBankProcessList(companyId, { signal } = {}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    throw new Error("Missing company");
  }

  const listUrl = new URL(buildApiUrl("api/processes/processlist_api.php"));
  listUrl.searchParams.set("permission", "Bank");
  listUrl.searchParams.set("company_id", String(cid));
  listUrl.searchParams.set("showAll", "1");

  const curUrl = buildApiUrl(`api/transactions/get_company_currencies_api.php?company_id=${cid}`);

  const [listRes, curPack] = await Promise.all([
    fetchJson(listUrl.toString(), { signal }),
    fetchJson(curUrl, { signal }).catch((e) => {
      if (e?.name === "AbortError") throw e;
      return { res: { ok: false }, json: null };
    }),
  ]);

  assertApiOk(listRes.res, listRes.json, "Failed to load bank processes");
  const rows = normalizeBankProcessRows(listRes.json.data);

  let currencyCodes = [];
  if (curPack.res?.ok && curPack.json?.success && Array.isArray(curPack.json.data)) {
    currencyCodes = [
      ...new Set(curPack.json.data.map((r) => String(r.code || "").toUpperCase()).filter(Boolean)),
    ];
  } else {
    currencyCodes = [
      ...new Set(rows.map((r) => String(r.country || "").trim().toUpperCase()).filter(Boolean)),
    ];
  }

  // Align filter chips with desktop per-company order (not A–Z).
  try {
    currencyCodes = await orderCurrencyCodesForCompany(currencyCodes, cid, signal);
  } catch (e) {
    if (e?.name === "AbortError") throw e;
  }

  return { rows, currencyCodes };
}

export function isBankInactiveLike(status, issueFlag) {
  const s = normalizeBankProcessStatus(status);
  const f = normalizeBankIssueFlag(issueFlag);
  return s === "inactive" || f === "official" || f === "e_invoice" || f === "block";
}

export function canShowBankResend(row) {
  const s = normalizeBankProcessStatus(row?.status);
  return s === "active" && !isBankInactiveLike(row?.status, row?.issue_flag);
}

/** Normalize UI status key used in menus (E_INVOICE, not E-INVOICE). */
export function bankProcessUiStatusKey(row) {
  const flag = normalizeBankIssueFlag(row?.issue_flag);
  if (flag === "official") return "OFFICIAL";
  if (flag === "e_invoice") return "E_INVOICE";
  if (flag === "block") return "BLOCK";
  return normalizeBankProcessStatus(row?.status) === "inactive" ? "INACTIVE" : "ACTIVE";
}

export function bankProcessStatusTargetPatch(target) {
  switch (String(target || "").toUpperCase().replace(/-/g, "_")) {
    case "ACTIVE":
      return { status: "active", issue_flag: "" };
    case "INACTIVE":
      return { status: "inactive", issue_flag: "" };
    case "OFFICIAL":
      return { issue_flag: "official" };
    case "E_INVOICE":
      return { issue_flag: "e_invoice" };
    case "BLOCK":
      return { issue_flag: "block" };
    default:
      return {};
  }
}

export function bankProcessFrequencyNormalized(v) {
  if (v === "monthly") return "monthly";
  if (v === "week") return "week";
  if (v === "day") return "day";
  if (v === "once") return "once";
  return "1st_of_every_month";
}

export function accountingDuePeriodType(r) {
  if (r.is_once_one_off) return "once_one_off";
  if (r.is_weekly) return "weekly";
  if (r.is_daily && r.is_daily_consolidated) return "daily_consolidated";
  if (r.is_daily) return "daily";
  if (r.is_manual_inactive) return "manual_inactive";
  if (r.is_resend_consolidated_range) return "resend_consolidated_range";
  if (r.is_resend_monthly_reopen) return "resend_monthly_reopen";
  if (r.is_partial_first_month) return "partial_first_month";
  if (r.is_day_end_tail) return "day_end_tail";
  return "monthly";
}

export function accountingDueBillingMonth(r) {
  if (r.is_daily || r.is_daily_consolidated) {
    return String(r.monthly_billing_month || r.daily_billing_start || "").trim();
  }
  return String(r.weekly_billing_start || r.monthly_billing_month || "").trim();
}

export function accountingDueRowKey(r) {
  const id = Number(r?.id);
  if (!Number.isFinite(id) || id <= 0) return "";
  return `${id}|${accountingDuePeriodType(r)}|${accountingDueBillingMonth(r)}`;
}

function apiErrorMessage(json, fallback) {
  return String(json?.message || json?.error || fallback || "Request failed");
}

async function postForm(path, fields) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    fd.append(k, String(v));
  });
  const { res, json } = await fetchJson(buildApiUrl(path), { method: "POST", body: fd });
  if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json));
  return json;
}

export async function applyBankProcessStatus(row, target) {
  const id = row?.id;
  if (id == null) throw new Error("Missing process id");
  const key = String(target || "").toUpperCase().replace(/-/g, "_");
  const st = normalizeBankProcessStatus(row?.status);
  const hasFlag = !!normalizeBankIssueFlag(row?.issue_flag);

  if (key === "ACTIVE") {
    if (hasFlag) await postForm("api/processes/update_bank_issue_flag_api.php", { id, issue_flag: "" });
    if (st !== "active") {
      await postForm("api/processes/toggle_process_status_api.php", { id, permission: "Bank" });
    }
  } else if (key === "INACTIVE") {
    if (hasFlag) await postForm("api/processes/update_bank_issue_flag_api.php", { id, issue_flag: "" });
    if (st === "active") {
      await postForm("api/processes/toggle_process_status_api.php", { id, permission: "Bank" });
    }
  } else if (key === "OFFICIAL") {
    await postForm("api/processes/update_bank_issue_flag_api.php", { id, issue_flag: "official" });
  } else if (key === "E_INVOICE") {
    await postForm("api/processes/update_bank_issue_flag_api.php", { id, issue_flag: "e_invoice" });
  } else if (key === "BLOCK") {
    await postForm("api/processes/update_bank_issue_flag_api.php", { id, issue_flag: "block" });
  } else {
    throw new Error("Unknown status");
  }
  return bankProcessStatusTargetPatch(key);
}

export async function updateBankRemark(id, remark) {
  return postForm("api/processes/update_bank_remark_api.php", { id, remark: remark ?? "" });
}

export async function fetchAccountingInbox(companyId, { restoreDismissed = false, signal } = {}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];
  const url = new URL(buildApiUrl("api/processes/process_accounting_inbox_api.php"));
  url.searchParams.set("company_id", String(cid));
  if (restoreDismissed) url.searchParams.set("restore_dismissed", "1");
  const { res, json } = await fetchJson(url.toString(), { signal });
  if (!res.ok || !json?.success) return [];
  return Array.isArray(json.data) ? json.data : [];
}

function appendDueSelection(fd, rows) {
  rows.forEach((r) => {
    fd.append("ids[]", String(r.id));
    fd.append("period_types[]", accountingDuePeriodType(r));
    fd.append("billing_months[]", accountingDueBillingMonth(r));
  });
}

export async function postAccountingDueRows(rows) {
  const fd = new FormData();
  appendDueSelection(fd, rows);
  fd.append("allow_future_monthly", "1");
  const { res, json } = await fetchJson(buildApiUrl("api/processes/process_post_to_transaction_api.php"), {
    method: "POST",
    body: fd,
  });
  if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, "Post failed"));
  return json;
}

export async function dismissAccountingDueRows(rows) {
  const fd = new FormData();
  appendDueSelection(fd, rows);
  const { res, json } = await fetchJson(buildApiUrl("api/processes/dismiss_accounting_due_api.php"), {
    method: "POST",
    body: fd,
  });
  if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, "Dismiss failed"));
  return json;
}

export async function resendAccountingDue({ bankProcessId, dayStart, dayEnd, frequency }) {
  const fq = bankProcessFrequencyNormalized(frequency);
  const omitDayEnd = fq === "once" || fq === "week" || fq === "day" || fq === "monthly";
  const { res, json } = await fetchJson(buildApiUrl("api/bankprocess_maintenance/resend_accounting_due_api.php"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bank_process_id: Number(bankProcessId),
      day_start: dayStart || null,
      day_end: omitDayEnd ? null : dayEnd || null,
      day_start_frequency: fq,
    }),
  });
  if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, "Resend failed"));
  return json;
}

export function formatDueDisplayDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
}

/** Roles allowed in Bank Process account picks (desktop BANK_PICK_ACCOUNT_ROLES). */
export const BANK_PICK_ACCOUNT_ROLES = [
  "PARTNER",
  "SUPPLIER",
  "UPLINE",
  "STAFF",
  "AGENT",
  "MEMBER",
  "PROFIT",
];

export const BANK_PROCESS_TYPES = ["PERSONAL", "ENTERPRISE", "BUSINESS"];

export const BANK_PROCESS_CONTRACT_OPTIONS = [
  "1 MONTH",
  "2 MONTHS",
  "3 MONTHS",
  "6 MONTHS",
  "1+1",
  "1+2",
  "1+3",
];

export const EMPTY_BANK_FORM = {
  id: "",
  country: "",
  bank: "",
  type: "",
  name: "",
  card_merchant_id: "",
  customer_id: "",
  profit_account_id: "",
  contract: "",
  insurance: "",
  cost: "",
  price: "",
  profit: "",
  profit_sharing: "",
  day_start: "",
  day_end: "",
  day_end_monthly_cap_enabled: false,
  day_start_frequency: "1st_of_every_month",
  status: "active",
  remark: "",
  sop: "",
};

export function formatBankMoneyFixed2(value, { emptyAsZero = true } = {}) {
  const raw = String(value ?? "")
    .trim()
    .replace(/,/g, "");
  if (!raw) return emptyAsZero ? "0.00" : "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return emptyAsZero ? "0.00" : "";
  return n.toFixed(2);
}

export function sanitizeBankMoneyTyping(value) {
  return String(value ?? "").replace(/,/g, "");
}

function sumProfitSharingAmounts(profitSharingStr) {
  const str = String(profitSharingStr || "").trim();
  if (!str) return 0;
  let sum = 0;
  for (const part of str.split(",")) {
    const t = part.trim();
    const dash = t.lastIndexOf(" - ");
    if (dash === -1) continue;
    const amt = Number(String(t.slice(dash + 3).trim()).replace(/,/g, ""));
    if (Number.isFinite(amt)) sum += amt;
  }
  return sum;
}

/** Profit = max(0, sell - buy - sharing); empty when all blank. */
export function calcBankNetProfitDisplay(cost, price, profitSharingStr) {
  const costStr = String(cost ?? "").trim();
  const priceStr = String(price ?? "").trim();
  const psStr = String(profitSharingStr ?? "").trim();
  if (!costStr && !priceStr && !psStr) return "";
  const costN = Number(String(costStr).replace(/,/g, "")) || 0;
  const priceN = Number(String(priceStr).replace(/,/g, "")) || 0;
  const net = Math.max(0, priceN - costN - sumProfitSharingAmounts(psStr));
  return formatBankMoneyFixed2(net);
}

export function formatProfitSharingStringFixed2(s) {
  const str = String(s || "").trim();
  if (!str) return "";
  return str
    .split(",")
    .map((part) => {
      const t = part.trim();
      const dash = t.lastIndexOf(" - ");
      if (dash === -1) return t;
      const label = t.slice(0, dash).trim();
      const amt = formatBankMoneyFixed2(t.slice(dash + 3).trim());
      return label ? `${label} - ${amt}` : null;
    })
    .filter(Boolean)
    .join(", ");
}

/** Match desktop parseProfitSharingToRows — label is account_id (code). */
export function parseProfitSharingToRows(s, accounts) {
  const out = [];
  const str = String(s || "").trim();
  if (!str) return out;
  for (const part of str.split(",")) {
    const t = part.trim();
    const dash = t.lastIndexOf(" - ");
    if (dash === -1) continue;
    const label = t.slice(0, dash).trim();
    const amountRaw = t.slice(dash + 3).trim();
    const amountN = Number(String(amountRaw).replace(/,/g, ""));
    if (!label || !Number.isFinite(amountN)) continue;
    const acc = (accounts || []).find(
      (a) =>
        String(a.account_id || a.code || "")
          .toLowerCase() === label.toLowerCase() ||
        String(a.name || "")
          .toLowerCase() === label.toLowerCase(),
    );
    out.push({
      accountId: acc ? String(acc.id) : "",
      accountLabel: label,
      amount: formatBankMoneyFixed2(String(amountN), { emptyAsZero: false }),
    });
  }
  return out;
}

/** Match desktop serializeProfitSharingRows. */
export function serializeProfitSharingRows(rows, accounts) {
  return (rows || [])
    .map((r) => {
      const acc = (accounts || []).find((a) => String(a.id) === String(r.accountId));
      const label = String(acc?.account_id || acc?.code || r.accountLabel || "")
        .trim();
      const rawAmt = String(r.amount ?? "").trim();
      if (!label || !rawAmt) return null;
      const amtN = Number(rawAmt.replace(/,/g, ""));
      if (!Number.isFinite(amtN) || amtN <= 0) return null;
      return `${label} - ${formatBankMoneyFixed2(rawAmt)}`;
    })
    .filter(Boolean)
    .join(", ");
}

export function profitSharingDisplayLabel(row, accounts) {
  const acc = (accounts || []).find((a) => String(a.id) === String(row?.accountId));
  if (acc) {
    return formatBankAccountDisplay(acc.account_id || acc.code, acc.name, row?.accountLabel);
  }
  return String(row?.accountLabel || "").trim() || "—";
}

/** Day-end rental months: 1+N uses first segment only (1 month). */
export function parseBankContractRentalMonthsForDayEnd(contract) {
  if (!contract || String(contract).trim() === "") return null;
  const c = String(contract).trim();
  if (/^1\+\d+/i.test(c)) return 1;
  let m = c.match(/^1\+(\d+)$/i);
  if (m) return 1 + parseInt(m[1], 10);
  m = c.match(/^(\d+)\s*MONTHS?$/i);
  if (m) return Math.max(1, parseInt(m[1], 10));
  return null;
}

function addCalendarMonthsToYmd(ymd, months) {
  if (!ymd || months == null || months < 1) return null;
  const p = String(ymd).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!p) return null;
  const d = new Date(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10));
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function subtractOneDayFromYmd(ymd) {
  if (!ymd) return null;
  const head = String(ymd).trim().substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
  const p = head.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Auto day_end for bank form (desktop-parity; not used for posting). */
export function contractBillingEndYmdForBankForm(startYmd, termMonths, frequency) {
  if (!startYmd || termMonths == null || termMonths < 1) return null;
  if (frequency === "once") return null;
  const head = String(startYmd).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!head) return null;
  const startDay = parseInt(head[3], 10);
  if (startDay === 1) return addCalendarMonthsToYmd(startYmd, termMonths);
  const exclusiveCal = addCalendarMonthsToYmd(startYmd, termMonths);
  if (!exclusiveCal) return null;
  return subtractOneDayFromYmd(exclusiveCal) || null;
}

export function canDeleteBankProcess(row) {
  return (
    normalizeBankProcessStatus(row?.status) === "inactive" && !row?.has_transactions
  );
}

export async function deleteBankProcesses(ids) {
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!list.length) throw new Error("Missing process id");
  const { res, json } = await fetchJson(buildApiUrl("api/processes/delete_processes_api.php"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: list, permission: "Bank" }),
  });
  if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, "Delete failed"));
  return json;
}

export async function fetchAccountRoles({ companyId, signal } = {}) {
  const url = new URL(buildApiUrl("api/editdata/editdata_api.php"));
  if (companyId) url.searchParams.set("company_id", String(companyId));
  const { res, json } = await fetchJson(url.toString(), { signal });
  if (!res.ok || !json?.success) return [...BANK_PICK_ACCOUNT_ROLES];
  const roles = Array.isArray(json?.data?.roles) ? json.data.roles : [];
  const upper = roles.map((r) => String(r || "").trim().toUpperCase()).filter(Boolean);
  return upper.length ? upper : [...BANK_PICK_ACCOUNT_ROLES];
}

/**
 * Quick-create account for Bank Process form (desktop addaccountapi parity).
 * @returns {{ id: number }}
 */
export async function createBankPickAccount({ companyId, accountId, name, role, password }) {
  const fd = new FormData();
  fd.set("account_id", String(accountId || "").trim().toUpperCase());
  fd.set("name", String(name || "").trim().toUpperCase());
  fd.set("role", String(role || "").trim().toUpperCase());
  fd.set("password", String(password || ""));
  fd.set("payment_alert", "0");
  fd.set("remark", "");
  if (companyId) {
    fd.set("company_id", String(companyId));
    fd.set("company_ids", JSON.stringify([Number(companyId)]));
  }
  const { res, json } = await fetchJson(buildApiUrl("api/accounts/addaccountapi.php"), {
    method: "POST",
    body: fd,
  });
  if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, "Failed to create account"));
  const id = Number(json?.data?.id);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Missing account id");
  return { id, account_id: String(accountId || "").trim().toUpperCase(), name: String(name || "").trim().toUpperCase(), role };
}

export function formatBankAccountDisplay(codeRaw, nameRaw, fallbackRaw) {
  const code = String(codeRaw || "").trim();
  const name = String(nameRaw || "").trim();
  const fallback = String(fallbackRaw || "").trim();
  if (code) return `${code} [${name || code}]`;
  if (name) return name;
  return fallback;
}

export function filterBankPickAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];
  const allow = new Set(BANK_PICK_ACCOUNT_ROLES);
  return accounts.filter((a) => {
    const role = String(a?.role || "")
      .trim()
      .toUpperCase();
    const status = String(a?.status || "")
      .trim()
      .toLowerCase();
    return status === "active" && allow.has(role);
  });
}

export function bankProcessDetailToForm(d) {
  return {
    ...EMPTY_BANK_FORM,
    id: String(d?.id || ""),
    country: d?.country || "",
    bank: d?.bank || "",
    type: d?.type || "",
    name: d?.name || "",
    card_merchant_id: d?.card_merchant_id ? String(d.card_merchant_id) : "",
    customer_id: d?.customer_id ? String(d.customer_id) : "",
    profit_account_id: d?.profit_account_id ? String(d.profit_account_id) : "",
    contract: d?.contract || "",
    insurance: d?.insurance ?? "",
    cost: d?.cost != null && d.cost !== "" ? formatBankMoneyFixed2(d.cost) : "",
    price: d?.price != null && d.price !== "" ? formatBankMoneyFixed2(d.price) : "",
    profit: d?.profit != null && d.profit !== "" ? formatBankMoneyFixed2(d.profit) : "",
    profit_sharing: formatProfitSharingStringFixed2(d?.profit_sharing || ""),
    day_start: d?.day_start ? String(d.day_start).slice(0, 10) : "",
    day_end: d?.day_end ? String(d.day_end).slice(0, 10) : "",
    day_end_monthly_cap_enabled:
      bankProcessFrequencyNormalized(d?.day_start_frequency) === "1st_of_every_month" &&
      (d?.day_end_monthly_cap_enabled === 1 ||
        d?.day_end_monthly_cap_enabled === true ||
        String(d?.day_end_monthly_cap_enabled) === "1"),
    day_start_frequency: bankProcessFrequencyNormalized(d?.day_start_frequency),
    status: d?.status || "active",
    remark: d?.remark || "",
    sop: d?.sop || "",
  };
}

export async function fetchBankProcessDetail(id, { signal } = {}) {
  const url = new URL(buildApiUrl("api/processes/processlist_api.php"));
  url.searchParams.set("action", "get_process");
  url.searchParams.set("id", String(id));
  url.searchParams.set("permission", "Bank");
  const { res, json } = await fetchJson(url.toString(), { signal });
  assertApiOk(res, json, "Failed to load process");
  if (!json?.data) throw new Error("Process not found");
  return bankProcessDetailToForm(json.data);
}

export async function fetchBankPickAccounts(companyId, { signal } = {}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];
  const url = new URL(buildApiUrl("api/accounts/accountlistapi.php"));
  url.searchParams.set("company_id", String(cid));
  url.searchParams.set("roles", BANK_PICK_ACCOUNT_ROLES.join(","));
  url.searchParams.set("showAll", "1");
  const { res, json } = await fetchJson(url.toString(), { signal });
  if (!res.ok || !json?.success) return [];
  return filterBankPickAccounts(Array.isArray(json?.data?.accounts) ? json.data.accounts : []);
}

export async function fetchBankCountries(companyId, { signal } = {}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];
  const url = new URL(buildApiUrl("api/processes/processlist_api.php"));
  url.searchParams.set("action", "get_countries");
  url.searchParams.set("company_id", String(cid));
  const { res, json } = await fetchJson(url.toString(), { signal });
  if (!res.ok || !json?.success || !Array.isArray(json.data)) return [];
  return json.data.map((c) => String(c || "").trim()).filter(Boolean);
}

export async function fetchBanksByCountry(companyId, country, { signal } = {}) {
  const cid = Number(companyId);
  const c = String(country || "").trim();
  if (!Number.isFinite(cid) || cid <= 0 || !c) return [];
  const url = new URL(buildApiUrl("api/processes/processlist_api.php"));
  url.searchParams.set("action", "get_banks_by_country");
  url.searchParams.set("company_id", String(cid));
  url.searchParams.set("country", c);
  const { res, json } = await fetchJson(url.toString(), { signal });
  if (!res.ok || !json?.success || !Array.isArray(json.data)) return [];
  return json.data.map((b) => String(b || "").trim()).filter(Boolean);
}

/**
 * Validate + POST add or update Bank process.
 * @returns {{ editMode: boolean }}
 */
export async function submitBankProcess(form, { companyId, editMode }) {
  const rawFreq = bankProcessFrequencyNormalized(form.day_start_frequency);
  const isOnce = rawFreq === "once";
  const isWeek = rawFreq === "week";
  const isDay = rawFreq === "day";
  const dayStart = String(form.day_start || "").trim();
  const dayEnd = String(form.day_end || "").trim();

  if (dayStart && dayEnd && dayEnd < dayStart) {
    throw new Error("DAY_END_BEFORE_START");
  }

  let dayEndMonthlyCapEnabled = !!form.day_end_monthly_cap_enabled;
  if (rawFreq !== "1st_of_every_month" || !dayEnd) dayEndMonthlyCapEnabled = false;
  if (dayEndMonthlyCapEnabled && !/^\d{4}-\d{2}-\d{2}$/.test(dayEnd)) {
    throw new Error("DAY_END_REQUIRED_FOR_CAP");
  }
  if (!isOnce && !isWeek && !isDay && !String(form.contract || "").trim()) {
    throw new Error("CONTRACT_REQUIRED");
  }
  if (!editMode) {
    if (!String(form.country || "").trim()) throw new Error("SELECT_COUNTRY");
    if (!String(form.type || "").trim()) throw new Error("SELECT_TYPE");
    if (!String(form.bank || "").trim()) throw new Error("SELECT_BANK");
    if (!String(form.name || "").trim()) throw new Error("NAME_REQUIRED");
  }

  const moneyNormalized = {
    ...form,
    name: String(form.name || "").toUpperCase(),
    cost: formatBankMoneyFixed2(form.cost),
    price: formatBankMoneyFixed2(form.price),
    profit: calcBankNetProfitDisplay(form.cost, form.price, form.profit_sharing),
    profit_sharing: formatProfitSharingStringFixed2(form.profit_sharing),
  };

  const fd = new FormData();
  Object.entries(moneyNormalized).forEach(([k, v]) => {
    if (k === "id" && !editMode) return;
    if (k === "day_end_monthly_cap_enabled") return;
    if (k === "day_start_frequency") {
      fd.append(k, rawFreq);
      return;
    }
    if (isOnce && (k === "day_end" || k === "contract" || k === "insurance")) {
      fd.append(k, "");
      return;
    }
    if ((isWeek || isDay) && (k === "day_end" || k === "contract")) {
      fd.append(k, "");
      return;
    }
    if (typeof v === "boolean") {
      fd.append(k, v ? "1" : "0");
      return;
    }
    fd.append(k, v ?? "");
  });
  if (editMode) {
    fd.append("day_end_monthly_cap_enabled", dayEndMonthlyCapEnabled ? "1" : "0");
  }
  if (companyId) fd.append("company_id", String(companyId));
  fd.append("permission", "Bank");

  const endpoint = editMode
    ? "api/processes/processlist_api.php?action=update_process"
    : "api/processes/addprocess_api.php";
  const { res, json } = await fetchJson(buildApiUrl(endpoint), { method: "POST", body: fd });
  if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, "Save failed"));
  return { editMode: !!editMode, json };
}

