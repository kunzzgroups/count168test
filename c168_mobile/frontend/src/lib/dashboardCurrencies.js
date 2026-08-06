import { buildApiUrl } from "../utils/apiUrl.js";
import { fetchJson } from "./fetchJson.js";
import { orderCurrencyCodesForCompany } from "./currencyOrder.js";
import {
  companiesForPicker,
  normalizeGroupId,
  resolveViewGroupForCompany,
} from "./dashboardScope.js";

function normalizeCodes(rows) {
  return [
    ...new Set(
      (rows || [])
        .map((row) => String(row?.code ?? row ?? "")
          .trim()
          .toUpperCase())
        // ISO-like: exactly 3 letters. Drops junk such as "1", "AA", "AAAAAA".
        .filter((code) => /^[A-Z]{3}$/.test(code)),
    ),
  ];
}

async function fetchCompanyCurrencySettingCodes(companyId, viewGroup = "", signal) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return [];

  const vg = normalizeGroupId(viewGroup);
  const queries = [];
  if (vg) {
    queries.push(
      new URLSearchParams({
        company_id: String(cid),
        subsidiary_accounts_only: "1",
        view_group: vg,
      }),
    );
  }
  queries.push(new URLSearchParams({ company_id: String(cid) }));

  for (const q of queries) {
    if (signal?.aborted) return [];
    try {
      const { res, json } = await fetchJson(
        buildApiUrl(`api/transactions/get_company_currencies_api.php?${q}`),
        { signal },
      );
      if (res.ok && json?.success && Array.isArray(json.data) && json.data.length) {
        return normalizeCodes(json.data);
      }
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      /* try next */
    }
  }
  return [];
}

async function mapPool(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const pool = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return results;
}

function resolveOrderCompanyId(companyId, companies, selectedGroup, groupsAllMode) {
  const cid = Number(companyId);
  if (Number.isFinite(cid) && cid > 0) return cid;
  const rows = companiesForPicker(companies, { selectedGroup, groupsAllMode });
  const first = Number(rows?.[0]?.id);
  return Number.isFinite(first) && first > 0 ? first : null;
}

/**
 * Load currency pills like desktop: company Currency Setting (+ subsidiary scope when Group selected).
 * Company/Group "All" unions codes from visible companies.
 * Group-only uses scope account currencies (group ledger books).
 * Final order matches desktop per-company order (not A–Z).
 */
export async function fetchMobileCurrencyCodes({
  companyId,
  selectedGroup,
  groupAllMode,
  groupsAllMode,
  companies,
  signal,
}) {
  const group = normalizeGroupId(selectedGroup);
  const hasCompany = Number.isFinite(Number(companyId)) && Number(companyId) > 0;
  const groupOnly = Boolean(group && !groupAllMode && !groupsAllMode && !hasCompany);
  let codes = [];
  let orderCompanyId = resolveOrderCompanyId(companyId, companies, selectedGroup, groupsAllMode);

  if (groupOnly) {
    // Prefer company Currency Setting union for the group (stable, no 403 spam).
    // Scope-account currencies with group_aggregate often 403 for partnership users.
    try {
      const rows = companiesForPicker(companies, { selectedGroup: group, groupsAllMode: false });
      const ids = rows
        .map((c) => Number(c.id))
        .filter((id) => Number.isFinite(id) && id > 0)
        .slice(0, 20);
      if (ids.length) {
        orderCompanyId = ids[0];
        const parts = await mapPool(ids, 5, async (id) => {
          if (signal?.aborted) return [];
          return fetchCompanyCurrencySettingCodes(id, group, signal);
        });
        const merged = [...new Set(parts.flat())];
        if (merged.length) codes = merged;
      }
    } catch (e) {
      if (e?.name === "AbortError") throw e;
    }

    if (!codes.length) {
      try {
        const q = new URLSearchParams({
          view_group: group,
          group_id: group,
          group_only: "1",
        });
        const { res, json } = await fetchJson(
          buildApiUrl(`api/transactions/get_scope_account_currencies_api.php?${q}`),
          { signal },
        );
        // Soft-fail 403/5xx — browser may still log the network line; avoid retry storms.
        if (res.ok && json?.success && Array.isArray(json.data) && json.data.length) {
          codes = normalizeCodes(json.data);
        }
      } catch (e) {
        if (e?.name === "AbortError") throw e;
      }
    }
  } else if (groupsAllMode || groupAllMode) {
    const rows = companiesForPicker(companies, { selectedGroup, groupsAllMode });
    const ids = rows
      .map((c) => Number(c.id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, 30);
    if (!ids.length) return ["MYR"];
    orderCompanyId = ids[0];

    // Cap concurrency so All-mode does not stall bootstrap on weak networks.
    const parts = await mapPool(ids, 6, async (id) => {
      if (signal?.aborted) return [];
      const row = (companies || []).find((c) => Number(c.id) === id);
      const vg = groupsAllMode ? resolveViewGroupForCompany(row, selectedGroup) : group;
      return fetchCompanyCurrencySettingCodes(id, vg, signal);
    });
    codes = [...new Set(parts.flat())];
  } else {
    codes = await fetchCompanyCurrencySettingCodes(companyId, group, signal);
    orderCompanyId = Number(companyId);
  }

  if (!codes.length) return ["MYR"];
  return orderCurrencyCodesForCompany(codes, orderCompanyId, signal);
}
