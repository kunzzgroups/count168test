import { toDecimal, type MoneyDec } from './money.js'

export type LinkedAccount = {
  id: number
  account_id: string
  name: string
}

export type HistoryRow = {
  transaction_id?: number
  id?: number
  date?: string
  currency?: string
  win_loss?: string | number
  cr_dr?: string | number
  balance?: string | number
  rate?: string | number
  description?: string
  remark?: string
  sms?: string
  created_by?: string
  id_product?: string
  product?: string
  process?: string
  card_owner?: string
  is_bank_process_transaction?: boolean | number
  row_type?: string
}

export function scopeQueryFields(compId: number, gid: string): Record<string, string> {
  if (gid) return { group_id: gid }
  return { company_id: String(compId) }
}

export function hasScope(compId: number, gid: string) {
  return Boolean(compId) || Boolean(gid)
}

export function mapLinkedAccountsApiList(data: unknown): LinkedAccount[] {
  if (!Array.isArray(data)) return []
  return data.map((acc) => {
    const row = acc as Record<string, unknown>
    return {
      id: Number(row.id) || 0,
      account_id: String(row.account_id || ''),
      name: String(row.name || ''),
    }
  })
}

export function normalizeNumber(value: unknown): MoneyDec {
  try {
    return toDecimal(value || '0', 0)
  } catch {
    return toDecimal('0', 0)
  }
}

export function computeTableTotals(rows: HistoryRow[]) {
  let totalWinLoss = normalizeNumber('0')
  let totalCrDr = normalizeNumber('0')
  let closingBalance = normalizeNumber('0')
  for (const row of rows || []) {
    totalWinLoss = totalWinLoss.plus(normalizeNumber(row.win_loss))
    totalCrDr = totalCrDr.plus(normalizeNumber(row.cr_dr))
    if (row.balance !== '-' && row.balance != null && String(row.balance).trim() !== '') {
      closingBalance = normalizeNumber(row.balance)
    }
  }
  return { totalWinLoss, totalCrDr, closingBalance }
}

export function groupHistoryForDisplay(
  historyRows: HistoryRow[],
  isAllSelected: boolean,
  selectedCurrencies: string[],
  availableCurrencies: string[],
) {
  const map = new Map<string, HistoryRow[]>()
  const rows = Array.isArray(historyRows) ? historyRows : []
  for (const row of rows) {
    const c = String(row.currency || '-').trim() || '-'
    if (!map.has(c)) map.set(c, [])
    map.get(c)?.push(row)
  }
  if (isAllSelected) {
    const order = availableCurrencies.length > 0 ? availableCurrencies : Array.from(map.keys())
    return order.map((c) => [c, map.get(c) || []] as const).filter(([, list]) => list.length > 0)
  }
  if (!selectedCurrencies.length) return []
  return selectedCurrencies.map((c) => [c, map.get(c) || []] as const)
}

export function applyCurrencyAllToggle() {
  return { isAllSelected: true, selectedCurrencies: [] as string[] }
}

export function applyCurrencyToggle(
  available: string[],
  isAllSelected: boolean,
  selectedCurrencies: string[],
  code: string,
) {
  const cu = String(code || '').trim().toUpperCase()
  if (!available?.length) {
    return { isAllSelected: true, selectedCurrencies: [] as string[] }
  }
  if (!cu) {
    return { isAllSelected: Boolean(isAllSelected), selectedCurrencies: [...(selectedCurrencies || [])] }
  }
  if (isAllSelected) {
    return { isAllSelected: false, selectedCurrencies: [cu] }
  }
  const current = (selectedCurrencies || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
  if (current.includes(cu)) {
    return { isAllSelected: false, selectedCurrencies: current.filter((c) => c !== cu) }
  }
  const availSet = new Set(available.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))
  const next = [...current, cu].filter((c) => availSet.has(c))
  if (next.length === availSet.size) {
    return { isAllSelected: true, selectedCurrencies: [] as string[] }
  }
  return { isAllSelected: false, selectedCurrencies: next }
}

export function getMemberMiniGridCurrencies(
  availableCurrencies: string[],
  isAllSelected: boolean,
  selectedCurrencies: string[],
) {
  const available = (availableCurrencies || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
  if (isAllSelected) return available
  const selected = (selectedCurrencies || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
  return available.filter((c) => selected.includes(c))
}

export function mapBatchAccountCurrencies(data: unknown) {
  const map = new Map<number, Set<string>>()
  if (!Array.isArray(data)) return map
  for (const row of data) {
    const rec = row as { account_id?: unknown; currencies?: Array<{ currency_code?: string; code?: string }> }
    const id = Number(rec.account_id)
    if (!id) continue
    const set = new Set<string>()
    for (const c of rec.currencies || []) {
      const code = String(c.currency_code || c.code || '').trim().toUpperCase()
      if (code) set.add(code)
    }
    map.set(id, set)
  }
  return map
}

export function accountHoldsMiniGridCurrency(
  linkedAccountCurrenciesMap: Map<number, Set<string>> | null,
  linkedCurrenciesLoaded: boolean,
  accountId: number,
  currencyUpper: string,
) {
  const cu = String(currencyUpper || '').trim().toUpperCase()
  if (!cu) return true
  if (!linkedCurrenciesLoaded) return true
  const set = linkedAccountCurrenciesMap?.get(Number(accountId))
  if (!set || set.size === 0) return true
  return set.has(cu)
}

export function memberHistoryClosingBalancesForAllCurrencies(rows: HistoryRow[], wantedUpperSet: Set<string>) {
  const map = new Map<string, MoneyDec>()
  wantedUpperSet.forEach((cu) => map.set(cu, normalizeNumber('0')))
  for (const row of rows || []) {
    const rc = String(row.currency || '').trim().toUpperCase()
    if (!wantedUpperSet.has(rc)) continue
    if (row.balance !== '-' && row.balance != null && String(row.balance).trim() !== '') {
      map.set(rc, normalizeNumber(row.balance))
    }
  }
  return map
}

export function computeMiniGridTotals(
  balanceMap: Map<string, MoneyDec | null>,
  orderUpper: string[],
  accounts: LinkedAccount[],
  linkedAccountCurrenciesMap: Map<number, Set<string>> | null = null,
  linkedCurrenciesLoaded = false,
) {
  const totalsByCu = new Map<string, MoneyDec>()
  for (const cu of orderUpper || []) totalsByCu.set(cu, normalizeNumber('0'))
  for (const acc of accounts || []) {
    const id = Number(acc.id)
    if (id <= 0) continue
    for (const cu of orderUpper || []) {
      if (
        linkedCurrenciesLoaded &&
        !accountHoldsMiniGridCurrency(linkedAccountCurrenciesMap, linkedCurrenciesLoaded, id, cu)
      ) {
        continue
      }
      const dec = balanceMap?.get(`${id}|${cu}`)
      if (dec != null && typeof dec.plus === 'function') {
        totalsByCu.set(cu, (totalsByCu.get(cu) as MoneyDec).plus(dec))
      }
    }
  }
  return totalsByCu
}

export function toUpperDisplay(value: unknown) {
  if (value === null || value === undefined) return '-'
  const str = String(value).trim()
  return str ? str.toUpperCase() : '-'
}

export function getHistoryRemark(row: HistoryRow) {
  if (row?.remark != null && String(row.remark).trim() !== '') {
    return toUpperDisplay(row.remark)
  }
  return toUpperDisplay(row?.sms || '-')
}

export function productLabel(row: HistoryRow) {
  if (row?.is_bank_process_transaction && row?.card_owner) {
    return toUpperDisplay(row.card_owner)
  }
  return toUpperDisplay(row?.id_product || row?.product || row?.process || '-')
}
