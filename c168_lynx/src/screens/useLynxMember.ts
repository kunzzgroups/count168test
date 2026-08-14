import { useCallback, useEffect, useMemo, useRef, useState } from '@lynx-js/react'

import { MEMBER_I18N, memberT, translateMemberApiMessage, type LoginLang } from '../i18n.js'
import { matchPreset, periodPresetRange, todayYmd, type PeriodPreset } from '../lib/datePresets.js'
import {
  accountHoldsMiniGridCurrency,
  applyCurrencyAllToggle,
  applyCurrencyToggle as nextCurrencySelection,
  computeMiniGridTotals,
  getMemberMiniGridCurrencies,
  groupHistoryForDisplay,
  hasScope,
  type HistoryRow,
  type LinkedAccount,
} from '../lib/memberHelpers.js'
import {
  fetchAccountCompanies,
  fetchAccountHistoryClosingBalance,
  fetchBatchAccountCurrencies,
  fetchHistoryRows,
  fetchLinkedAccounts,
  fetchOwnedCurrencies,
  switchAccountSession,
  switchCompanySession,
} from '../lib/memberApi.js'
import type { MoneyDec } from '../lib/money.js'
import { fetchCurrentUser, type SessionUser } from '../session.js'

type Toast = { message: string; tone: 'success' | 'error' }

export function useLynxMember(lang: LoginLang) {
  const i18n = useMemo(() => MEMBER_I18N[lang], [lang])
  const t = useCallback((key: keyof typeof MEMBER_I18N.en, params?: Record<string, string | number>) => {
    return memberT(lang, key, params)
  }, [lang])

  const [me, setMe] = useState<SessionUser | null>(null)
  const [bootLoading, setBootLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [companies, setCompanies] = useState<Array<Record<string, unknown>>>([])
  const [loginRootAccountId, setLoginRootAccountId] = useState(0)
  const [viewAccountId, setViewAccountId] = useState(0)
  const [companyId, setCompanyId] = useState(0)
  const [groupId, setGroupId] = useState('')
  const [dateFromYmd, setDateFromYmd] = useState(() => todayYmd())
  const [dateToYmd, setDateToYmd] = useState(() => todayYmd())
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([])
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([])
  const [isAllSelected, setIsAllSelected] = useState(true)
  const [selectedCurrencies, setSelectedCurrencies] = useState<string[]>([])
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
  const [tableDisplayContext, setTableDisplayContext] = useState({
    isAllSelected: true,
    selectedCurrencies: [] as string[],
    currencyOrder: [] as string[],
  })
  const [loadingTable, setLoadingTable] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [balanceMap, setBalanceMap] = useState(() => new Map<string, MoneyDec | null>())
  const [balanceTotals, setBalanceTotals] = useState(() => new Map<string, MoneyDec>())
  const [balanceCurrencies, setBalanceCurrencies] = useState<string[]>([])
  const [balancesLoading, setBalancesLoading] = useState(false)
  const [linkedAccountCurrenciesMap, setLinkedAccountCurrenciesMap] = useState(
    () => new Map<number, Set<string>>(),
  )
  const [linkedCurrenciesLoaded, setLinkedCurrenciesLoaded] = useState(false)

  const searchSeqRef = useRef(0)
  const balancesSeqRef = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const linkedAccountsRef = useRef(linkedAccounts)
  linkedAccountsRef.current = linkedAccounts
  const linkedCcyMapRef = useRef(linkedAccountCurrenciesMap)
  linkedCcyMapRef.current = linkedAccountCurrenciesMap
  const linkedCcyLoadedRef = useRef(linkedCurrenciesLoaded)
  linkedCcyLoadedRef.current = linkedCurrenciesLoaded

  const notify = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    if (!message) return
    setToast({ message, tone })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), tone === 'error' ? 4000 : 2200)
  }, [])

  const groupedRows = useMemo(
    () =>
      groupHistoryForDisplay(
        historyRows,
        tableDisplayContext.isAllSelected,
        tableDisplayContext.selectedCurrencies,
        tableDisplayContext.currencyOrder,
      ),
    [historyRows, tableDisplayContext],
  )

  const activePreset = useMemo(
    () => matchPreset(dateFromYmd, dateToYmd),
    [dateFromYmd, dateToYmd],
  )

  const loadOwnedCurrencies = useCallback(async (accountId: number, compId: number, gid: string) => {
    if (!accountId || !hasScope(compId, gid)) {
      setAvailableCurrencies([])
      return [] as string[]
    }
    try {
      const codes = await fetchOwnedCurrencies(accountId, compId, gid)
      setAvailableCurrencies(codes)
      return codes
    } catch {
      setAvailableCurrencies([])
      return [] as string[]
    }
  }, [])

  const loadLinkedAccounts = useCallback(async (rootId: number, compId: number, gid: string) => {
    if (!rootId || !hasScope(compId, gid)) {
      setLinkedAccounts([])
      linkedAccountsRef.current = []
      setLinkedAccountCurrenciesMap(new Map())
      linkedCcyMapRef.current = new Map()
      setLinkedCurrenciesLoaded(true)
      linkedCcyLoadedRef.current = true
      return [] as LinkedAccount[]
    }
    try {
      const list = await fetchLinkedAccounts(rootId, compId, gid)
      setLinkedAccounts(list)
      linkedAccountsRef.current = list
      const ids = list.map((a) => Number(a.id)).filter(Boolean)
      if (!ids.length) {
        setLinkedAccountCurrenciesMap(new Map())
        linkedCcyMapRef.current = new Map()
        setLinkedCurrenciesLoaded(true)
        linkedCcyLoadedRef.current = true
        return list
      }
      setLinkedCurrenciesLoaded(false)
      linkedCcyLoadedRef.current = false
      try {
        const map = await fetchBatchAccountCurrencies(ids, compId, gid)
        setLinkedAccountCurrenciesMap(map)
        linkedCcyMapRef.current = map
      } catch {
        setLinkedAccountCurrenciesMap(new Map())
        linkedCcyMapRef.current = new Map()
      } finally {
        setLinkedCurrenciesLoaded(true)
        linkedCcyLoadedRef.current = true
      }
      return list
    } catch {
      setLinkedAccounts([])
      linkedAccountsRef.current = []
      setLinkedAccountCurrenciesMap(new Map())
      linkedCcyMapRef.current = new Map()
      setLinkedCurrenciesLoaded(true)
      linkedCcyLoadedRef.current = true
      return [] as LinkedAccount[]
    }
  }, [])

  const commitTableDisplayContext = useCallback(
    (useAll: boolean, useSelected: string[], history: HistoryRow[], currencyOrderHint: string[] = []) => {
      const fromHistory = [
        ...new Set(
          (Array.isArray(history) ? history : [])
            .map((row) => String(row?.currency || '').trim())
            .filter(Boolean),
        ),
      ]
      const currencyOrder = useAll ? (currencyOrderHint.length ? currencyOrderHint : fromHistory) : [...useSelected]
      setTableDisplayContext({
        isAllSelected: useAll,
        selectedCurrencies: [...useSelected],
        currencyOrder,
      })
    },
    [],
  )

  const refreshBalances = useCallback(
    async ({
      accounts,
      compId = companyId,
      gid = groupId,
      fromYmd = dateFromYmd,
      toYmd = dateToYmd,
      useAll = isAllSelected,
      useSelected = selectedCurrencies,
      currencyCodes = availableCurrencies,
    }: {
      accounts?: LinkedAccount[]
      compId?: number
      gid?: string
      fromYmd?: string
      toYmd?: string
      useAll?: boolean
      useSelected?: string[]
      currencyCodes?: string[]
    } = {}) => {
      const orderUpper = getMemberMiniGridCurrencies(currencyCodes, useAll, useSelected)
      const list = (accounts ?? linkedAccountsRef.current ?? []).filter((a) => Number(a?.id) > 0)
      balancesSeqRef.current += 1
      const seq = balancesSeqRef.current
      if (!list.length || !orderUpper.length || !hasScope(compId, gid)) {
        setBalanceMap(new Map())
        setBalanceTotals(new Map())
        setBalanceCurrencies(orderUpper)
        setBalancesLoading(false)
        return
      }
      setBalancesLoading(true)
      setBalanceCurrencies(orderUpper)
      const ccyMap = linkedCcyMapRef.current
      const ccyLoaded = linkedCcyLoadedRef.current
      try {
        const pairs: Array<{ id: number; cu: string }> = []
        for (const acc of list) {
          const id = Number(acc.id)
          for (const cu of orderUpper) {
            if (!accountHoldsMiniGridCurrency(ccyMap, ccyLoaded, id, cu)) continue
            pairs.push({ id, cu })
          }
        }
        const results = await Promise.all(
          pairs.map(async ({ id, cu }) => {
            try {
              const dec = await fetchAccountHistoryClosingBalance(id, cu, fromYmd, toYmd, compId, gid)
              return { key: `${id}|${cu}`, dec }
            } catch {
              return { key: `${id}|${cu}`, dec: null }
            }
          }),
        )
        if (seq !== balancesSeqRef.current) return
        const nextMap = new Map<string, MoneyDec | null>()
        for (const row of results) {
          if (row?.dec != null) nextMap.set(row.key, row.dec)
        }
        setBalanceMap(nextMap)
        setBalanceTotals(computeMiniGridTotals(nextMap, orderUpper, list, ccyMap, ccyLoaded))
      } catch {
        if (seq !== balancesSeqRef.current) return
        setBalanceMap(new Map())
        setBalanceTotals(new Map())
      } finally {
        if (seq === balancesSeqRef.current) setBalancesLoading(false)
      }
    },
    [availableCurrencies, companyId, dateFromYmd, dateToYmd, groupId, isAllSelected, selectedCurrencies],
  )

  const fetchHistory = useCallback(
    async ({
      viewId = viewAccountId,
      compId = companyId,
      gid = groupId,
      fromYmd = dateFromYmd,
      toYmd = dateToYmd,
      useAll = isAllSelected,
      useSelected = selectedCurrencies,
      currencyCodes = availableCurrencies,
      silent = false,
    }: {
      viewId?: number
      compId?: number
      gid?: string
      fromYmd?: string
      toYmd?: string
      useAll?: boolean
      useSelected?: string[]
      currencyCodes?: string[]
      silent?: boolean
    } = {}) => {
      if (!viewId || !hasScope(compId, gid) || !fromYmd || !toYmd) return
      searchSeqRef.current += 1
      const seq = searchSeqRef.current
      if (!silent) setLoadingTable(true)
      if (!useAll && !(useSelected?.length)) {
        setHistoryRows([])
        commitTableDisplayContext(false, [], [], currencyCodes)
        setBalanceMap(new Map())
        setBalanceTotals(new Map())
        setBalanceCurrencies([])
        if (seq === searchSeqRef.current) setLoadingTable(false)
        return
      }
      const targetCurrencies = useAll ? currencyCodes : [...useSelected]
      try {
        const history = await fetchHistoryRows({
          viewId,
          fromYmd,
          toYmd,
          compId,
          gid,
          currencies: targetCurrencies,
        })
        if (seq !== searchSeqRef.current) return
        setHistoryRows(history)
        commitTableDisplayContext(useAll, useSelected, history, currencyCodes)
        if (!silent) notify(t('queryCompleted'))
        void refreshBalances({
          compId,
          gid,
          fromYmd,
          toYmd,
          useAll,
          useSelected,
          currencyCodes,
        })
      } catch (e) {
        if (seq !== searchSeqRef.current) return
        setHistoryRows([])
        commitTableDisplayContext(useAll, useSelected, [], currencyCodes)
        notify(translateMemberApiMessage(lang, (e as Error)?.message || '', 'couldNotLoadHistory'), 'error')
      } finally {
        if (seq === searchSeqRef.current) setLoadingTable(false)
      }
    },
    [
      availableCurrencies,
      commitTableDisplayContext,
      companyId,
      dateFromYmd,
      dateToYmd,
      groupId,
      isAllSelected,
      lang,
      notify,
      refreshBalances,
      selectedCurrencies,
      t,
      viewAccountId,
    ],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const user = await fetchCurrentUser()
        if (cancelled) return
        if (!user) {
          setDenied(true)
          return
        }
        if (String(user.user_type || '').toLowerCase() !== 'member') {
          setDenied(true)
          return
        }
        const loginId = Number(user.member_login_account_id || user.user_id) || 0
        const viewId =
          Number(user.member_winloss_view_account_id || user.winloss_view_account_id || user.user_id) || 0
        const gid =
          String(user.login_scope || '').toLowerCase() === 'group'
            ? String(user.login_identifier || '').trim().toUpperCase()
            : ''
        const cid = Number(user.company_id) || 0
        setMe(user)
        setLoginRootAccountId(loginId)
        setViewAccountId(viewId)
        setCompanyId(cid)
        setGroupId(gid)
        try {
          const list = await fetchAccountCompanies(loginId)
          if (!cancelled) setCompanies(list)
        } catch {
          if (!cancelled) setCompanies([])
        }
        await loadLinkedAccounts(loginId, cid, gid)
        const codes = await loadOwnedCurrencies(viewId, cid, gid)
        if (cancelled) return
        setBootLoading(false)
        await fetchHistory({
          viewId,
          compId: cid,
          gid,
          currencyCodes: codes,
          silent: true,
        })
      } catch {
        if (!cancelled) setDenied(true)
      } finally {
        if (!cancelled) setBootLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
    // boot once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchCompany = useCallback(
    async (nextCompanyId: number, companyLabel: string) => {
      if (!nextCompanyId || Number(nextCompanyId) === Number(companyId)) return
      try {
        await switchCompanySession(nextCompanyId)
        const cid = Number(nextCompanyId)
        setCompanyId(cid)
        setGroupId('')
        notify(t('switchedToCompany', { label: companyLabel || nextCompanyId }))
        await loadLinkedAccounts(loginRootAccountId, cid, '')
        const codes = await loadOwnedCurrencies(viewAccountId, cid, '')
        await fetchHistory({ compId: cid, gid: '', currencyCodes: codes })
      } catch (e) {
        notify(translateMemberApiMessage(lang, (e as Error)?.message || '', 'failedSwitchCompany'), 'error')
      }
    },
    [companyId, fetchHistory, lang, loadLinkedAccounts, loadOwnedCurrencies, loginRootAccountId, notify, t, viewAccountId],
  )

  const switchAccount = useCallback(
    async (nextAccountId: number, code: string, name: string) => {
      if (!nextAccountId || Number(nextAccountId) === Number(viewAccountId)) return
      try {
        const payload = await switchAccountSession(nextAccountId)
        const newId = payload.accountId
        setViewAccountId(newId)
        notify(t('switchedToAccount', { label: payload.accountCode || code || name || newId }))
        const codes = await loadOwnedCurrencies(newId, companyId, groupId)
        await fetchHistory({ viewId: newId, currencyCodes: codes })
      } catch (e) {
        notify(translateMemberApiMessage(lang, (e as Error)?.message || '', 'failedSwitchAccount'), 'error')
      }
    },
    [companyId, fetchHistory, groupId, lang, loadOwnedCurrencies, notify, t, viewAccountId],
  )

  const applyPeriod = useCallback(
    async (preset: PeriodPreset) => {
      const next = periodPresetRange(preset)
      if (!next) return
      setDateFromYmd(next.dateFrom)
      setDateToYmd(next.dateTo)
      await fetchHistory({ fromYmd: next.dateFrom, toYmd: next.dateTo })
    },
    [fetchHistory],
  )

  const applyCurrencyAll = useCallback(async () => {
    const next = applyCurrencyAllToggle()
    setIsAllSelected(next.isAllSelected)
    setSelectedCurrencies(next.selectedCurrencies)
    await fetchHistory({ useAll: true, useSelected: [] })
  }, [fetchHistory])

  const applyCurrencyToggle = useCallback(
    async (code: string) => {
      const next = nextCurrencySelection(availableCurrencies, isAllSelected, selectedCurrencies, code)
      setIsAllSelected(next.isAllSelected)
      setSelectedCurrencies(next.selectedCurrencies)
      await fetchHistory({ useAll: next.isAllSelected, useSelected: next.selectedCurrencies })
    },
    [availableCurrencies, fetchHistory, isAllSelected, selectedCurrencies],
  )

  const viewAccount = useMemo(() => {
    const hit = linkedAccounts.find((a) => Number(a.id) === Number(viewAccountId))
    return hit || { id: viewAccountId, account_id: '', name: '' }
  }, [linkedAccounts, viewAccountId])

  return {
    i18n,
    t,
    me,
    bootLoading,
    denied,
    companies,
    companyId,
    viewAccountId,
    viewAccount,
    linkedAccounts,
    dateFromYmd,
    dateToYmd,
    activePreset,
    availableCurrencies,
    isAllSelected,
    selectedCurrencies,
    groupedRows,
    loadingTable,
    toast,
    balanceMap,
    balanceTotals,
    balanceCurrencies,
    balancesLoading,
    linkedAccountCurrenciesMap,
    linkedCurrenciesLoaded,
    switchCompany,
    switchAccount,
    applyPeriod,
    applyCurrencyAll,
    applyCurrencyToggle,
  }
}
