import { pickGroupAnchorCompany, sortedUniqueGroupIds } from "./dashboardScope.js";

export function accountScopeIsGroupOnly(scope) {
  return Boolean(
    scope?.selectedGroup &&
      !scope?.groupsAllMode &&
      !scope?.groupAllMode &&
      !(Number(scope?.companyId) > 0),
  );
}

/** Normalize getaccount_api `ledger_scope` for edit mutations. */
export function normalizeAccountLedgerScope(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mode = String(raw.mode || "").trim().toLowerCase();
  const groupCode = String(raw.group_code || "").trim().toUpperCase();
  if (mode === "group" && groupCode) return { mode: "group", group_code: groupCode };
  return null;
}

/**
 * Mutation/query scope: account's own group ledger overrides page company filter.
 * @returns {Record<string,string>}
 */
export function mutationScopePayload(pageScope, modalLedgerScope = null) {
  const groupCode =
    modalLedgerScope?.mode === "group"
      ? String(modalLedgerScope.group_code || "")
          .trim()
          .toUpperCase()
      : "";
  if (groupCode) {
    return { group_id: groupCode, group_only: "1" };
  }
  return accountScopePayload(pageScope);
}

/** Groups-All aggregate: unique group codes (desktop groupIdsForGroupsAllAggregate). */
export function groupIdsForGroupsAllAggregate(companies = [], groupIds = []) {
  if (Array.isArray(groupIds) && groupIds.length) {
    return sortedUniqueGroupIds(
      groupIds.map((g) => ({ group_id: g })),
    );
  }
  return sortedUniqueGroupIds(companies);
}

export function appendAccountScope(params, scope) {
  const group = String(scope?.selectedGroup || "").trim().toUpperCase();
  const companyId = Number(scope?.companyId);
  if (group) params.set("group_id", group);
  if (accountScopeIsGroupOnly(scope)) {
    params.set("group_only", "1");
  } else if (Number.isFinite(companyId) && companyId > 0) {
    params.set("company_id", String(companyId));
  }
  return params;
}

export function accountScopeQuery(scope, filters = {}) {
  const params = appendAccountScope(new URLSearchParams(), scope);
  if (filters.search) params.set("search", String(filters.search).trim());
  if (filters.showInactive) params.set("showInactive", "1");
  if (filters.showAll) params.set("showAll", "1");
  return params;
}

export function accountScopePayload(scope) {
  const params = appendAccountScope(new URLSearchParams(), scope);
  return Object.fromEntries(params.entries());
}

export function buildAccountScopeDraft(scope) {
  return {
    companyId: scope?.companyId ?? null,
    selectedGroup: scope?.selectedGroup ?? null,
    groupsAllMode: Boolean(scope?.groupsAllMode),
    groupAllMode: Boolean(scope?.groupAllMode),
  };
}

export function resolveAccountScopeDraft(draft, companies) {
  const selectedGroup = draft?.selectedGroup
    ? String(draft.selectedGroup).trim().toUpperCase()
    : null;
  let companyId = Number(draft?.companyId);
  if (!Number.isFinite(companyId) || companyId <= 0) companyId = null;
  if (draft?.groupsAllMode) {
    const fallback = companies?.find((row) => Number(row?.id) > 0);
    return {
      selectedGroup: null,
      groupsAllMode: true,
      groupAllMode: false,
      companyId: fallback?.id ? Number(fallback.id) : null,
    };
  }
  if (selectedGroup && draft?.groupAllMode && !companyId) {
    const anchor = pickGroupAnchorCompany(companies, selectedGroup);
    companyId = anchor?.id ? Number(anchor.id) : null;
  }
  return {
    selectedGroup,
    groupsAllMode: false,
    groupAllMode: Boolean(selectedGroup && draft?.groupAllMode),
    companyId,
  };
}
