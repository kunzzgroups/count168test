import { getJson, withQuery } from '../api.js'
import {
  mapBatchAccountCurrencies,
  mapLinkedAccountsApiList,
  memberHistoryClosingBalancesForAllCurrencies,
  normalizeNumber,
  scopeQueryFields,
  type HistoryRow,
  type LinkedAccount,
} from './memberHelpers.js'
import { ymdToDmy } from './datePresets.js'
import type { MoneyDec } from './money.js'

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

export async function fetchAccountCompanies(accountId: number) {
  const { data } = await getJson(
    withQuery('api/accounts/account_company_api.php', {
      action: 'get_account_companies',
      account_id: String(accountId),
    }),
  )
  return Array.isArray(data.data) ? (data.data as Array<Record<string, unknown>>) : []
}

export async function fetchOwnedCurrencies(accountId: number, compId: number, gid: string) {
  const { data } = await getJson(
    withQuery('api/accounts/account_currency_api.php', {
      action: 'get_account_currencies',
      account_id: String(accountId),
      ...scopeQueryFields(compId, gid),
    }),
  )
  if (data.success !== true || !Array.isArray(data.data)) return [] as string[]
  return (data.data as Array<Record<string, unknown>>)
    .map((row) =>
      String(row.currency_code || row.code || '')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean)
}

export async function fetchLinkedAccounts(rootId: number, compId: number, gid: string) {
  const { data } = await getJson(
    withQuery('api/accounts/account_link_api.php', {
      action: 'get_all_linked_accounts',
      account_id: String(rootId),
      ...scopeQueryFields(compId, gid),
    }),
  )
  const list = data.success === true ? mapLinkedAccountsApiList(data.data) : []
  return list
}

export async function fetchBatchAccountCurrencies(ids: number[], compId: number, gid: string) {
  if (!ids.length) return new Map<number, Set<string>>()
  const { data } = await getJson(
    withQuery('api/accounts/account_currency_api.php', {
      action: 'get_batch_account_currencies',
      account_ids: ids.join(','),
      ...scopeQueryFields(compId, gid),
      _t: String(Date.now()),
    }),
  )
  if (data.success === true && Array.isArray(data.data)) {
    return mapBatchAccountCurrencies(data.data)
  }
  return new Map<number, Set<string>>()
}

export async function fetchHistoryRows(opts: {
  viewId: number
  fromYmd: string
  toYmd: string
  compId: number
  gid: string
  currencies: string[]
  signal?: AbortSignal
}) {
  const dateFrom = ymdToDmy(opts.fromYmd)
  const dateTo = ymdToDmy(opts.toYmd)
  const target = opts.currencies

  const loadOne = async (currency: string) => {
    const params: Record<string, string> = {
      account_id: String(opts.viewId),
      date_from: dateFrom,
      date_to: dateTo,
      ...scopeQueryFields(opts.compId, opts.gid),
      member_view: '1',
      _t: String(Date.now()),
    }
    if (currency) params.currency = currency
    const { data } = await getJson(withQuery('api/transactions/history_api.php', params), {
      signal: opts.signal,
    })
    if (data.success !== true) {
      throw new Error(String(data.error || data.message || 'query failed'))
    }
    const payload = asRecord(data.data)
    return Array.isArray(payload.history) ? (payload.history as HistoryRow[]) : []
  }

  if (!target.length || target.length === 1) {
    return loadOne(target[0] || '')
  }
  const parts = await Promise.all(target.map((cu) => loadOne(String(cu || '').trim().toUpperCase())))
  return parts.flat()
}

export async function fetchAccountHistoryClosingBalance(
  accountId: number,
  currency: string,
  fromYmd: string,
  toYmd: string,
  companyId: number,
  groupId: string,
  signal?: AbortSignal,
): Promise<MoneyDec> {
  const cu = String(currency || '').trim().toUpperCase()
  const dateFrom = ymdToDmy(fromYmd)
  const dateTo = ymdToDmy(toYmd)
  if (!accountId || !cu || !dateFrom || !dateTo) return normalizeNumber('0')
  const { data } = await getJson(
    withQuery('api/transactions/history_api.php', {
      account_id: String(accountId),
      date_from: dateFrom,
      date_to: dateTo,
      ...scopeQueryFields(companyId, groupId),
      currency: cu,
      _t: String(Date.now()),
    }),
    { signal },
  )
  if (data.success !== true) {
    throw new Error(String(data.error || data.message || 'History request failed'))
  }
  const payload = asRecord(data.data)
  const wanted = new Set([cu])
  const map = memberHistoryClosingBalancesForAllCurrencies(
    Array.isArray(payload.history) ? (payload.history as HistoryRow[]) : [],
    wanted,
  )
  return map.get(cu) ?? normalizeNumber('0')
}

export async function switchCompanySession(companyId: number) {
  const { data } = await getJson(
    withQuery('api/session/update_company_session_api.php', { company_id: String(companyId) }),
  )
  if (data.success !== true) {
    throw new Error(String(data.error || 'Failed to switch company'))
  }
}

export async function switchAccountSession(accountId: number) {
  const { data } = await getJson(
    withQuery('api/session/update_account_session_api.php', { account_id: String(accountId) }),
  )
  if (data.success !== true) {
    throw new Error(String(data.message || 'Switch failed'))
  }
  const payload = asRecord(data.data || data)
  return {
    accountId: Number(payload.account_id) || accountId,
    accountCode: String(payload.account_code || ''),
  }
}

export type { LinkedAccount }
