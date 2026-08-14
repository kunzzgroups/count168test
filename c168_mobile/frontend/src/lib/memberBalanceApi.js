import { buildApiUrl } from "../utils/apiUrl.js";
import {
  memberHistoryClosingBalancesForAllCurrencies,
  normalizeNumber,
  parseJsonResponse,
  scopeQueryFields,
  ymdToDmy,
} from "./memberHelpers.js";

/**
 * Single account × currency closing balance — same ledger as Payment History / desktop mini grid.
 * Dates are YMD; converted to DMY for history_api.
 */
export async function fetchAccountHistoryClosingBalance(
  accountId,
  currency,
  fromYmd,
  toYmd,
  companyId,
  groupId,
  signal,
) {
  const cu = String(currency || "")
    .trim()
    .toUpperCase();
  const dateFrom = ymdToDmy(fromYmd);
  const dateTo = ymdToDmy(toYmd);
  if (!accountId || !cu || !dateFrom || !dateTo) {
    return normalizeNumber("0");
  }
  const params = new URLSearchParams({
    account_id: String(accountId),
    date_from: dateFrom,
    date_to: dateTo,
    ...scopeQueryFields(companyId, groupId),
    currency: cu,
  });
  const res = await fetch(buildApiUrl(`api/transactions/history_api.php?${params}&_t=${Date.now()}`), {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  const json = await parseJsonResponse(await res.text());
  if (!json?.success) {
    throw new Error(json?.error || json?.message || "History request failed");
  }
  const wanted = new Set([cu]);
  const map = memberHistoryClosingBalancesForAllCurrencies(json.data?.history ?? [], wanted);
  return map.get(cu) ?? normalizeNumber("0");
}
