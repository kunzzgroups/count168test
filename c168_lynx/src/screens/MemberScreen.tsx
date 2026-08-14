import { useMemo, useState } from '@lynx-js/react'

import { formatMemberRowDescription, type LoginLang } from '../i18n.js'
import { PERIOD_PRESET_KEYS } from '../lib/datePresets.js'
import {
  accountHoldsMiniGridCurrency,
  computeTableTotals,
  getHistoryRemark,
  productLabel,
  type HistoryRow,
} from '../lib/memberHelpers.js'
import { formatHistoryBalanceMoney, formatHistoryMoney, formatRateForHistoryDisplay, moneyTone } from '../lib/money.js'
import type { MoneyDec } from '../lib/money.js'
import { useLynxMember } from './useLynxMember.js'

type Props = { lang: LoginLang }

function MoneyText({ value, kind = 'wl' }: { value: unknown; kind?: 'wl' | 'bal' }) {
  const text = kind === 'bal' ? formatHistoryBalanceMoney(value) : formatHistoryMoney(value)
  const tone = moneyTone(value)
  return <text className={`Money Money--${tone}`}>{text}</text>
}

function Pill({
  label,
  active,
  onTap,
}: {
  label: string
  active: boolean
  onTap: () => void
}) {
  return (
    <view
      className={active ? 'Pill Pill--on' : 'Pill'}
      bindtap={() => {
        'background only'
        onTap()
      }}
    >
      <text className={active ? 'PillText PillText--on' : 'PillText'}>{label}</text>
    </view>
  )
}

function rowKey(currency: string, row: HistoryRow, idx: number) {
  const id = Number(row?.transaction_id ?? row?.id ?? 0)
  return `${currency}-${id || idx}-${row?.date || ''}`
}

function createdByLabel(row: HistoryRow) {
  const createdRaw = row.created_by
  if (createdRaw == null || String(createdRaw).trim() === '' || String(createdRaw).toLowerCase() === 'null') {
    return '-'
  }
  return String(createdRaw)
}

function formatDec(dec: MoneyDec | null | undefined) {
  if (dec == null || typeof dec.isZero !== 'function') return '–'
  if (dec.isZero()) return '-'
  return formatHistoryMoney(dec.toString())
}

export function MemberScreen({ lang }: Props) {
  const api = useLynxMember(lang)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [balancesOpen, setBalancesOpen] = useState(false)

  const filterSummary = useMemo(() => {
    const accountCode = String(api.viewAccount?.account_id || '').toUpperCase()
    const ccy = api.isAllSelected ? api.t('all') : api.selectedCurrencies.join(', ') || api.t('selectCurrency')
    return [api.dateFromYmd, api.dateToYmd, accountCode, ccy].filter(Boolean).join(' · ')
  }, [api])

  if (api.bootLoading) {
    return (
      <view className="Stub">
        <text className="StubTitle">{api.t('winLoss')}</text>
        <text className="StubBody">{api.t('loading')}</text>
      </view>
    )
  }

  if (api.denied) {
    return (
      <view className="Stub">
        <text className="StubTitle">{api.t('winLoss')}</text>
        <text className="StubBody">{api.t('accessDenied')}</text>
      </view>
    )
  }

  const list = api.linkedAccounts.filter((a) => Number(a?.id) > 0)
  const orderUpper = api.balanceCurrencies.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean)
  const compact = orderUpper.length <= 1
  const singleCu = compact ? orderUpper[0] || '' : ''
  const primaryTotal = singleCu ? api.balanceTotals.get(singleCu) : undefined

  return (
    <view className="Member">
      <view className="MemberHead">
        <text className="StubTitle">{api.t('winLoss')}</text>
        <text className="MemberSummary">{filterSummary}</text>
      </view>

      {api.toast ? (
        <view className={api.toast.tone === 'error' ? 'Toast Toast--err' : 'Toast'}>
          <text className="ToastText">{api.toast.message}</text>
        </view>
      ) : null}

      <text className="SectionLabel">
        {api.dateFromYmd} — {api.dateToYmd}
      </text>
      <scroll-view scroll-orientation="horizontal" className="PillRow">
        <view className="PillInner">
          {PERIOD_PRESET_KEYS.map((key) => (
            <Pill
              key={key}
              label={api.t(key)}
              active={api.activePreset === key}
              onTap={() => {
                void api.applyPeriod(key)
              }}
            />
          ))}
        </view>
      </scroll-view>

      {api.companies.length > 1 ? (
        <scroll-view scroll-orientation="horizontal" className="PillRow">
          <view className="PillInner">
            {api.companies.map((c) => {
              const id = Number(c.id || c.company_db_id || 0)
              const code = String(c.company_id || c.company_code || id).toUpperCase()
              return (
                <Pill
                  key={String(id || code)}
                  label={code}
                  active={id === Number(api.companyId)}
                  onTap={() => {
                    void api.switchCompany(id, code)
                  }}
                />
              )
            })}
          </view>
        </scroll-view>
      ) : null}

      {api.linkedAccounts.length > 0 ? (
        <scroll-view scroll-orientation="horizontal" className="PillRow">
          <view className="PillInner">
            {api.linkedAccounts.map((a) => {
              const code = String(a.account_id || a.id).toUpperCase()
              return (
                <Pill
                  key={String(a.id)}
                  label={code}
                  active={Number(a.id) === Number(api.viewAccountId)}
                  onTap={() => {
                    void api.switchAccount(a.id, a.account_id, a.name)
                  }}
                />
              )
            })}
          </view>
        </scroll-view>
      ) : null}

      {api.availableCurrencies.length > 0 ? (
        <scroll-view scroll-orientation="horizontal" className="PillRow">
          <view className="PillInner">
            {api.availableCurrencies.length > 1 ? (
              <Pill
                label={api.t('all')}
                active={api.isAllSelected}
                onTap={() => {
                  void api.applyCurrencyAll()
                }}
              />
            ) : null}
            {api.availableCurrencies.map((code) => (
              <Pill
                key={code}
                label={code}
                active={!api.isAllSelected && api.selectedCurrencies.includes(code)}
                onTap={() => {
                  void api.applyCurrencyToggle(code)
                }}
              />
            ))}
          </view>
        </scroll-view>
      ) : null}

      {list.length > 0 || api.balancesLoading ? (
        <view className="BalCard">
          <view
            className="BalToggle"
            bindtap={() => {
              'background only'
              setBalancesOpen((v) => !v)
            }}
          >
            <text className="BalTitle">
              {api.t('balances')} · {api.t('balancesAccounts', { count: list.length })}
            </text>
            <text className="BalSummary">
              {api.balancesLoading
                ? api.t('loading')
                : singleCu && primaryTotal != null
                  ? `${formatDec(primaryTotal)} ${singleCu}`
                  : orderUpper.length > 1
                    ? api.t('balancesCurrencies', { count: orderUpper.length })
                    : ''}
            </text>
          </view>
          {balancesOpen ? (
            <view className="BalPanel">
              {api.balancesLoading && list.length === 0 ? (
                <text className="StubBody">{api.t('loading')}</text>
              ) : list.length === 0 ? (
                <text className="StubBody">{api.t('balancesEmpty')}</text>
              ) : orderUpper.length === 0 ? (
                <text className="StubBody">{api.t('selectCurrency')}</text>
              ) : compact ? (
                <view>
                  {list.map((acc) => {
                    const id = Number(acc.id)
                    const holds = accountHoldsMiniGridCurrency(
                      api.linkedAccountCurrenciesMap,
                      api.linkedCurrenciesLoaded,
                      id,
                      singleCu,
                    )
                    const dec = holds ? api.balanceMap.get(`${id}|${singleCu}`) : null
                    return (
                      <view key={String(id)} className="BalRow">
                        <text className="BalAcc">{String(acc.account_id || acc.id).toUpperCase()}</text>
                        {holds ? (
                          <MoneyText value={dec != null ? dec.toString() : ''} kind="wl" />
                        ) : (
                          <text className="Money Money--neutral">–</text>
                        )}
                      </view>
                    )
                  })}
                  <view className="BalRow BalRow--total">
                    <text className="BalAcc">{api.t('total')}</text>
                    <MoneyText value={primaryTotal != null ? primaryTotal.toString() : ''} kind="wl" />
                  </view>
                </view>
              ) : (
                <scroll-view scroll-orientation="horizontal" className="BalMatrix">
                  <view>
                    <view className="BalRow">
                      <text className="BalAcc">{api.t('account')}</text>
                      {orderUpper.map((cu) => (
                        <text key={cu} className="BalCellHead">
                          {cu}
                        </text>
                      ))}
                    </view>
                    {list.map((acc) => {
                      const id = Number(acc.id)
                      return (
                        <view key={String(id)} className="BalRow">
                          <text className="BalAcc">{String(acc.account_id || acc.id).toUpperCase()}</text>
                          {orderUpper.map((cu) => {
                            const holds = accountHoldsMiniGridCurrency(
                              api.linkedAccountCurrenciesMap,
                              api.linkedCurrenciesLoaded,
                              id,
                              cu,
                            )
                            const dec = holds ? api.balanceMap.get(`${id}|${cu}`) : null
                            return holds ? (
                              <view key={cu} className="BalCell">
                                <MoneyText value={dec != null ? dec.toString() : ''} kind="wl" />
                              </view>
                            ) : (
                              <text key={cu} className="BalCell Money Money--neutral">
                                –
                              </text>
                            )
                          })}
                        </view>
                      )
                    })}
                    <view className="BalRow BalRow--total">
                      <text className="BalAcc">{api.t('total')}</text>
                      {orderUpper.map((cu) => {
                        const dec = api.balanceTotals.get(cu)
                        return (
                          <view key={cu} className="BalCell">
                            <MoneyText value={dec != null ? dec.toString() : ''} kind="wl" />
                          </view>
                        )
                      })}
                    </view>
                  </view>
                </scroll-view>
              )}
            </view>
          ) : null}
        </view>
      ) : null}

      {api.loadingTable ? (
        <text className="StubBody">{api.t('loading')}</text>
      ) : api.groupedRows.length === 0 ? (
        <text className="Empty">{api.t('noDataInRange')}</text>
      ) : (
        api.groupedRows.map(([currency, rows]) => {
          const totals = computeTableTotals(rows)
          return (
            <view key={currency} className="CcyCard">
              <text className="CcyTitle">{api.t('currencyTitle', { currency })}</text>
              <view className="HistHead">
                <text className="ColDate">{api.t('colDate')}</text>
                <text className="ColProd">{api.t('colIdProduct')}</text>
                <text className="ColNum">{api.t('colWinLoss')}</text>
                <text className="ColNum">{api.t('colCrDr')}</text>
                <text className="ColNum">{api.t('colBalance')}</text>
              </view>
              {rows.length > 0 ? (
                <view className="HistRow HistRow--total">
                  <text className="ColDate">{api.t('total')}</text>
                  <text className="ColProd"> </text>
                  <view className="ColNum">
                    <MoneyText value={totals.totalWinLoss.toString()} />
                  </view>
                  <view className="ColNum">
                    <MoneyText value={totals.totalCrDr.toString()} />
                  </view>
                  <view className="ColNum">
                    <MoneyText value={totals.closingBalance.toString()} kind="bal" />
                  </view>
                </view>
              ) : null}
              {rows.map((row, idx) => {
                const key = rowKey(currency, row, idx)
                const expanded = expandedKey === key
                const remark = getHistoryRemark(row)
                const description = formatMemberRowDescription(lang, row)
                const createdBy = createdByLabel(row)
                return (
                  <view key={key}>
                    <view
                      className={idx % 2 === 1 ? 'HistRow HistRow--alt' : 'HistRow'}
                      bindtap={() => {
                        'background only'
                        setExpandedKey(expanded ? null : key)
                      }}
                    >
                      <text className="ColDate">{row.date || '—'}</text>
                      <text className="ColProd">{productLabel(row)}</text>
                      <view className="ColNum">
                        <MoneyText value={row.win_loss} />
                      </view>
                      <view className="ColNum">
                        <MoneyText value={row.cr_dr} />
                      </view>
                      <view className="ColNum">
                        <MoneyText value={row.balance} kind="bal" />
                      </view>
                    </view>
                    {expanded ? (
                      <view className="HistDetail">
                        <text className="DetailLabel">{api.t('colDescription')}</text>
                        <text className="DetailValue">{description && description !== '-' ? description : '—'}</text>
                        <text className="DetailLabel">{api.t('createdBy')}</text>
                        <text className="DetailValue">{createdBy !== '-' ? createdBy : '—'}</text>
                        {row.rate && row.rate !== '-' ? (
                          <view>
                            <text className="DetailLabel">{api.t('colRate')}</text>
                            <text className="DetailValue">{formatRateForHistoryDisplay(row.rate)}</text>
                          </view>
                        ) : null}
                        {remark && remark !== '-' ? (
                          <view>
                            <text className="DetailLabel">{api.t('colRemark')}</text>
                            <text className="DetailValue">{remark}</text>
                          </view>
                        ) : null}
                      </view>
                    ) : null}
                  </view>
                )
              })}
            </view>
          )
        })
      )}
    </view>
  )
}
