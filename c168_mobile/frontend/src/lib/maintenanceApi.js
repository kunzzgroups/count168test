import { buildApiUrl } from "../utils/apiUrl.js";
import { orderCurrencyCodesForCompany } from "./currencyOrder.js";
import { fetchJson, assertApiOk } from "./fetchJson.js";
import {
  appendTransactionMaintenanceScope,
  paymentMaintenanceScopeParams,
} from "./mobileMaintenanceScope.js";

export const OWNER_COMPANIES_API = "api/transactions/get_owner_companies_api.php";

/** Load accessible companies (all=1). */
export async function fetchOwnerCompanies(signal) {
  const { res, json } = await fetchJson(buildApiUrl(`${OWNER_COMPANIES_API}?all=1`), { signal });
  assertApiOk(res, json);
  return Array.isArray(json.data) ? json.data : [];
}

/** Switch PHP session company (company scope). */
export async function updateSessionCompany(companyId, signal) {
  const { res, json } = await fetchJson(
    buildApiUrl(`api/session/update_company_session_api.php?company_id=${companyId}`),
    { signal },
  );
  assertApiOk(res, json);
  return json.data;
}

function uniqueProcessNames(rows, pickName) {
  const names = (Array.isArray(rows) ? rows : [])
    .map((row) => String(pickName(row) ?? "").trim())
    .filter(Boolean);
  return [...new Set(names)];
}

/**
 * Process options for the Transaction Maintenance filter.
 * Group scope → domain report processes; company scope → processlist_api.
 * @returns {Promise<string[]>} process names
 */
export async function fetchMaintenanceProcessOptions({ scope, signal }) {
  if (scope?.mode === "group" && scope.groupId) {
    const params = new URLSearchParams();
    params.set("action", "processes");
    params.set("view_group", scope.groupId);
    params.set("group_id", scope.groupId);
    params.set("group_aggregate", "1");
    params.set("report_scope", "group");
    const { res, json } = await fetchJson(
      buildApiUrl(`api/reports/domain_report_api.php?${params.toString()}`),
      { signal },
    );
    assertApiOk(res, json);
    return uniqueProcessNames(json.data, (r) => r.process ?? r.process_id ?? r.display_text);
  }
  if (!(Number(scope?.companyId) > 0)) return [];
  const params = new URLSearchParams();
  params.set("company_id", String(scope.companyId));
  const { res, json } = await fetchJson(
    buildApiUrl(`api/processes/processlist_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json);
  return uniqueProcessNames(json.data, (r) => r.process_name ?? r.process);
}

/**
 * Transaction Maintenance search (read-only audit list).
 * @returns {Promise<Array>} rows
 */
export async function searchTransactionMaintenance({
  scope,
  dateFrom,
  dateTo,
  category,
  process,
  signal,
}) {
  const params = new URLSearchParams();
  params.set("date_from", dateFrom);
  params.set("date_to", dateTo);
  // Desktop resolveTransactionMaintenanceCategory: Gambling data is stored under Games.
  const apiCategory = String(category).toLowerCase() === "gambling" ? "Games" : category;
  if (apiCategory) params.set("category", apiCategory);
  if (process) params.set("process", process);
  appendTransactionMaintenanceScope(params, scope);

  const { res, json } = await fetchJson(
    buildApiUrl(`api/transactions/maintenance_search_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json, "Search failed");
  return Array.isArray(json.data) ? json.data : [];
}

/** Virtual rollup rows use transaction_id 0 — not real DB rows, not selectable for delete. */
export function isPaymentRowSelectable(row) {
  const id = row?.transaction_id;
  if (id === null || id === undefined || id === "") return false;
  const n = Number(id);
  return Number.isFinite(n) && n !== 0;
}

export function paymentRowKey(row, index) {
  if (isPaymentRowSelectable(row)) return `t-${row.transaction_id}`;
  return `v-${index}-${String(row.dts_created ?? "")}-${String(row.amount ?? "")}`;
}

function parsePaymentSortTime(row) {
  const m = String(row?.dts_created || "").match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})$/,
  );
  if (!m) return 0;
  const ts = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}`);
  return Number.isFinite(ts) ? ts : 0;
}

function sortPaymentRows(rows) {
  return [...rows].sort((a, b) => {
    const cmp = parsePaymentSortTime(b) - parsePaymentSortTime(a);
    if (cmp !== 0) return cmp;
    return Number(b?.transaction_id || 0) - Number(a?.transaction_id || 0);
  });
}

/**
 * Payment Maintenance search (payment/rate rows + deleted history + virtual rollups).
 * @returns {Promise<Array>} rows
 */
export async function searchPaymentMaintenance({
  scope,
  dateFrom,
  dateTo,
  transactionType,
  query,
  currency,
  signal,
}) {
  const params = new URLSearchParams();
  params.set("date_from", dateFrom);
  params.set("date_to", dateTo);
  if (transactionType) params.set("transaction_type", transactionType);
  if (query && query.trim()) params.set("q", query.trim().toUpperCase());
  if (currency) params.set("currency", currency);
  Object.entries(paymentMaintenanceScopeParams(scope)).forEach(([k, v]) => params.set(k, v));

  const { res, json } = await fetchJson(
    buildApiUrl(`api/payment_maintenance/search_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json, "Search failed");
  return sortPaymentRows(Array.isArray(json.data) ? json.data : []);
}

/** Delete selected payment records (soft-archive + cascade handled server-side). */
export async function deletePaymentRecords({ scope, transactionIds, signal }) {
  const payload = {
    transaction_ids: transactionIds,
    ...paymentMaintenanceScopeParams(scope),
  };
  const { res, json } = await fetchJson(buildApiUrl("api/payment_maintenance/delete_api.php"), {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
  assertApiOk(res, json, "Delete failed");
  return json.data || {};
}

export function formatMaintenanceAmount(value) {
  if (value === null || value === undefined || value === "") return "-";
  const val = parseFloat(value);
  if (Number.isNaN(val)) return "-";
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Soft-deleted bankprocess-maintenance rows cannot be selected. */
export function isBankprocessMaintenanceRowSelectable(row) {
  if (!row) return false;
  return !(row.is_deleted === 1 || row.is_deleted === "1" || row.is_deleted === true);
}

/** One Post/Resend batch: same DTS + bank process + period + transaction date. */
export function bankprocessMaintenanceBatchKey(row) {
  const ts = String(row?.dts_created ?? "").trim();
  const bpId = Number(row?.source_bank_process_id) || 0;
  const pt = String(row?.period_type ?? "monthly").trim().toLowerCase() || "monthly";
  const txDate = String(row?.date ?? "").trim();
  if (ts && bpId > 0) return `${ts}|${bpId}|${pt}|${txDate}`;
  if (ts) return ts;
  const tid = row?.transaction_id;
  return tid != null && tid !== "" ? `__tid_${tid}` : "";
}

function bankprocessMaintenanceIdsInBatch(rows, batchKey) {
  if (!batchKey || !Array.isArray(rows)) return [];
  const ids = [];
  for (const row of rows) {
    if (!isBankprocessMaintenanceRowSelectable(row)) continue;
    if (bankprocessMaintenanceBatchKey(row) !== batchKey) continue;
    const tid = Number(row.transaction_id);
    if (Number.isFinite(tid) && tid > 0) ids.push(tid);
  }
  return ids;
}

/** Toggle all selectable rows in the same Post/Resend batch (desktop parity). */
export function toggleBankprocessMaintenanceBatchSelection(selectedIds, rows, clickedTransactionId) {
  const clickedId = Number(clickedTransactionId);
  if (!Number.isFinite(clickedId) || clickedId <= 0) return selectedIds;

  const clickedRow = rows.find((r) => Number(r.transaction_id) === clickedId);
  if (!clickedRow || !isBankprocessMaintenanceRowSelectable(clickedRow)) return selectedIds;

  const batchKey = bankprocessMaintenanceBatchKey(clickedRow);
  const batchIds = bankprocessMaintenanceIdsInBatch(rows, batchKey);
  if (batchIds.length === 0) return selectedIds;

  const prev = selectedIds instanceof Set ? [...selectedIds] : Array.isArray(selectedIds) ? selectedIds : [];
  const selecting = !prev.includes(clickedId);
  if (selecting) {
    const next = new Set(prev);
    batchIds.forEach((id) => next.add(id));
    return next;
  }
  return new Set(prev.filter((id) => !batchIds.includes(id)));
}

export function bankprocessMaintenanceRowKey(row, index) {
  const id = Number(row?.transaction_id);
  if (Number.isFinite(id) && id > 0) return `bp-${id}`;
  return `bp-v-${index}-${String(row?.dts_created ?? "")}`;
}

/** Company currency codes for Bankprocess Maintenance filter (desktop company order). */
export async function fetchCompanyCurrencies(companyId, signal) {
  const params = new URLSearchParams();
  if (companyId) params.set("company_id", String(companyId));
  const qs = params.toString();
  const { res, json } = await fetchJson(
    buildApiUrl(`api/transactions/get_company_currencies_api.php${qs ? `?${qs}` : ""}`),
    { signal },
  );
  if (!res.ok || !json?.success) return [];
  const raw = Array.isArray(json.data) ? json.data : [];
  const codes = raw
    .map((item) => {
      if (typeof item === "string") return item.trim().toUpperCase();
      return String(item?.code ?? item?.currency ?? item?.currency_code ?? "")
        .trim()
        .toUpperCase();
    })
    .filter(Boolean);
  return orderCurrencyCodesForCompany(codes, companyId, signal);
}

/**
 * Bankprocess Maintenance search (transactions with source_bank_process_id).
 * Company scope only — API does not support group aggregate.
 */
export async function searchBankprocessMaintenance({
  companyId,
  dateFrom,
  dateTo,
  currency,
  query,
  signal,
}) {
  const params = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
  });
  if (companyId) params.set("company_id", String(companyId));
  if (currency) params.set("currency", String(currency).toUpperCase());
  if (query?.trim()) params.set("q", query.trim().toUpperCase());

  const { res, json } = await fetchJson(
    buildApiUrl(`api/bankprocess_maintenance/search_api.php?${params.toString()}`),
    { signal },
  );
  assertApiOk(res, json, "Search failed");
  return Array.isArray(json.data) ? json.data : [];
}

/** Soft-delete bank-process-sourced transactions. */
export async function deleteBankprocessMaintenanceRecords({ transactionIds, signal }) {
  const { res, json } = await fetchJson(buildApiUrl("api/bankprocess_maintenance/delete_api.php"), {
    method: "POST",
    body: JSON.stringify({ transaction_ids: transactionIds }),
    signal,
  });
  assertApiOk(res, json, "Delete failed");
  return json.data || {};
}
