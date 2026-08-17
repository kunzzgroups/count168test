import { fetchJson } from "./fetchJson.js";
import { getOwnershipCurrentMonthKey, isApiSuccess, isOwnershipHistoricalMonth } from "./ownershipLogic.js";
import { buildApiUrl } from "../utils/apiUrl.js";

async function readOwnershipJson(url, options = {}) {
  const { json } = await fetchJson(url, options);
  return json;
}

export async function fetchOwnershipCompanies(monthKey = getOwnershipCurrentMonthKey(), { force = false } = {}) {
  const monthQs = isOwnershipHistoricalMonth(monthKey)
    ? `&month=${encodeURIComponent(monthKey)}`
    : "";
  const bustQs = force ? `&_=${Date.now()}` : "";
  return readOwnershipJson(buildApiUrl(`api/ownership/get_companies_api.php?all=1${monthQs}${bustQs}`));
}

export async function fetchCompanyOwners(companyId, monthKey, historical) {
  const qs = historical
    ? `?company_id=${companyId}&month=${encodeURIComponent(monthKey)}`
    : `?company_id=${companyId}`;
  return readOwnershipJson(buildApiUrl(`api/ownership/get_owners_api.php${qs}`));
}

export async function fetchCompanyAvailableAccounts(companyId) {
  return readOwnershipJson(
    buildApiUrl(`api/ownership/get_available_accounts_api.php?company_id=${companyId}`),
  );
}

export async function fetchGroupEarnings(monthKey, historical) {
  const qs = historical ? `?month=${encodeURIComponent(monthKey)}` : "";
  return readOwnershipJson(buildApiUrl(`api/ownership/get_group_earnings_api.php${qs}`));
}

export async function fetchGroupOwners(groupId, monthKey, historical) {
  const qs = historical
    ? `?group_id=${encodeURIComponent(groupId)}&month=${encodeURIComponent(monthKey)}`
    : `?group_id=${encodeURIComponent(groupId)}`;
  return readOwnershipJson(buildApiUrl(`api/ownership/get_group_owners_api.php${qs}`));
}

export async function fetchGroupAvailableAccounts(groupId) {
  return readOwnershipJson(
    buildApiUrl(`api/ownership/get_group_available_accounts_api.php?group_id=${encodeURIComponent(groupId)}`),
  );
}

export async function postOwnershipJson(path, body) {
  return readOwnershipJson(buildApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function postOwnershipForm(path, fields) {
  const body = new FormData();
  Object.entries(fields).forEach(([key, value]) => body.append(key, String(value)));
  return readOwnershipJson(buildApiUrl(path), { method: "POST", body });
}

export { isApiSuccess };
