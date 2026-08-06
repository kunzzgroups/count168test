import { buildApiUrl } from "../utils/apiUrl.js";
import { fetchJson, assertApiOk } from "./fetchJson.js";
import MoneyDecimal from "./money/moneyDecimal.js";

/** Desktop-aligned report amount display (HALF_UP + abs < 0.005 → 0). */
export function formatReportAmount(value) {
  const zero = () => MoneyDecimal.formatThousands(MoneyDecimal.formatFixedHalfUp("0", 2), 2);
  if (value === null || value === undefined) return zero();
  const raw = String(value).trim();
  if (raw === "" || raw === "-") return zero();
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-") return zero();
  try {
    const absSmall = MoneyDecimal.cmp(MoneyDecimal.abs(cleaned), "0.005") < 0;
    const core = absSmall ? "0" : cleaned;
    return MoneyDecimal.formatThousands(MoneyDecimal.formatFixedHalfUp(core, 2), 2);
  } catch {
    return zero();
  }
}

export function reportAmountTone(value) {
  try {
    const n = MoneyDecimal.cmp(String(value ?? "0").replace(/,/g, ""), "0");
    if (n > 0) return "is-pos";
    if (n < 0) return "is-neg";
  } catch {
    /* ignore */
  }
  return "";
}

/** Append Domain/Customer report scope query params (mobile Maintenance-aligned). */
export function appendReportScopeParams(params, scope) {
  if (!scope) return params;
  if (scope.mode === "group" && scope.groupId) {
    params.set("view_group", scope.groupId);
    params.set("group_id", scope.groupId);
    params.set("group_aggregate", "1");
    params.set("report_scope", "group");
  } else if (Number(scope.companyId) > 0) {
    params.set("company_id", String(scope.companyId));
    params.set("report_scope", "company");
    if (scope.groupId) params.set("view_group", String(scope.groupId).trim().toUpperCase());
    // Match desktop transactionScopeApiParams / customerReportScopeApiParams:
    // company drill-down must use subsidiary currency pool (not group-ledger-only).
    params.set("subsidiary_accounts_only", "1");
  }
  return params;
}

export async function fetchCompanyPermissions(companyCode, signal) {
  const code = String(companyCode || "").trim();
  if (!code) return [];
  try {
    const { res, json } = await fetchJson(buildApiUrl("api/domain/domain_api.php"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_company_permissions", company_id: code }),
      signal,
    });
    if (!res.ok || !json?.success) return [];
    return Array.isArray(json?.data?.permissions) ? json.data.permissions : [];
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    return [];
  }
}

/** Bank-only = has Bank and no Games/Gambling — no Domain/Customer report. */
export function isBankOnlyCategoryCompany(permissions) {
  if (!Array.isArray(permissions) || permissions.length === 0) return false;
  const hasBank = permissions.includes("Bank");
  const hasGames = permissions.includes("Games") || permissions.includes("Gambling");
  return hasBank && !hasGames;
}

export async function companyIsBankOnly(companyCode, signal) {
  const perms = await fetchCompanyPermissions(companyCode, signal);
  return isBankOnlyCategoryCompany(perms);
}

const DOMAIN_GROUP_CODES = ["SALARY", "COMMISSION", "BONUS"];

function normalizeProcessCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s*\(.*$/, "");
}

export function mapDomainGroupProcesses(apiList) {
  const rows = Array.isArray(apiList) ? apiList : [];
  const mapped = DOMAIN_GROUP_CODES.map((code) => {
    const row = rows.find((p) => {
      const fromProcess = normalizeProcessCode(p.process ?? p.process_id);
      const fromDisplay = normalizeProcessCode(p.display_text);
      return fromProcess === code || fromDisplay === code || fromDisplay.startsWith(`${code} `);
    });
    const id = row?.id != null ? Number(row.id) : 0;
    if (!Number.isFinite(id) || id <= 0) return null;
    return { id, process: code, display_text: code };
  }).filter(Boolean);
  return mapped.length > 0 ? mapped : rows;
}

export async function fetchDomainProcesses(scope, { signal } = {}) {
  const params = new URLSearchParams();
  params.set("action", "processes");
  appendReportScopeParams(params, scope);
  const { res, json } = await fetchJson(
    buildApiUrl(`api/reports/domain_report_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json);
  const list = Array.isArray(json.data) ? json.data : [];
  if (scope?.mode === "group") return mapDomainGroupProcesses(list);
  return list;
}

export async function fetchDomainReport(
  { scope, dateFrom, dateTo, processId },
  { signal } = {},
) {
  const params = new URLSearchParams();
  params.set("date_from", dateFrom);
  params.set("date_to", dateTo);
  if (processId) params.set("process_id", String(processId));
  appendReportScopeParams(params, scope);
  const { res, json } = await fetchJson(
    buildApiUrl(`api/reports/domain_report_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json, "Failed to load report");
  return json;
}

export async function fetchCustomerAccounts(scope, { signal } = {}) {
  const params = new URLSearchParams();
  appendReportScopeParams(params, scope);
  const { res, json } = await fetchJson(
    buildApiUrl(`api/transactions/get_accounts_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json);
  return Array.isArray(json.data) ? json.data : [];
}

export async function fetchReportCurrencies(scope, { signal } = {}) {
  const params = new URLSearchParams();
  appendReportScopeParams(params, scope);
  const { res, json } = await fetchJson(
    buildApiUrl(`api/transactions/get_scope_account_currencies_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json);
  return Array.isArray(json.data) ? json.data : [];
}

export async function fetchCustomerReport(
  {
    scope,
    dateFrom,
    dateTo,
    accountId,
    showAll,
    selectedCurrencies,
    showAllCurrencies,
  },
  { signal } = {},
) {
  const params = new URLSearchParams();
  params.set("date_from", dateFrom);
  params.set("date_to", dateTo);
  if (accountId) params.set("account_id", String(accountId));
  if (showAll) params.set("show_all", "1");
  appendReportScopeParams(params, scope);
  if (!showAllCurrencies && Array.isArray(selectedCurrencies) && selectedCurrencies.length > 0) {
    params.set("currency", selectedCurrencies.join(","));
  }
  const { res, json } = await fetchJson(
    buildApiUrl(`api/reports/customer_report_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json, "Failed to load report");
  return json;
}
