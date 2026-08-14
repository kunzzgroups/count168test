import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN })

export type MoneyDec = Decimal

function cleanMoneyInput(value: unknown) {
  if (value === null || value === undefined) return ''
  let s = String(value).trim()
  if (s === '') return ''
  let negativeByParentheses = false
  if (/^\(.*\)$/.test(s)) {
    negativeByParentheses = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[,$\s]/g, '')
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  if (negativeByParentheses && s.charAt(0) !== '-') s = `-${s}`
  return s
}

export function toDecimal(value: unknown, fallback?: string | number): Decimal {
  const cleaned = cleanMoneyInput(value)
  if (cleaned === '') {
    if (fallback !== undefined) return new Decimal(fallback)
    throw new Error('Money value is empty')
  }
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(cleaned)) {
    if (fallback !== undefined) return new Decimal(fallback)
    throw new Error(`Invalid money value: ${String(value)}`)
  }
  return new Decimal(cleaned)
}

export function formatFixedHalfUp(value: unknown, scale: number) {
  const fixed = toDecimal(value, 0).toFixed(scale, Decimal.ROUND_HALF_UP)
  return fixed === '-0' ? '0' : fixed
}

export function formatThousands(value: unknown, scale = 2) {
  const display = toDecimal(value, 0).toFixed(scale, Decimal.ROUND_DOWN)
  const normalized = display === '-0' ? '0' : display
  const negative = normalized.charAt(0) === '-'
  const unsigned = negative ? normalized.slice(1) : normalized
  const parts = unsigned.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${parts.join('.')}`
}

export function formatHistoryMoney(value: unknown) {
  if (value === '-' || value === null || value === undefined) return '-'
  const cleaned = String(value).replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-') return '-'
  try {
    const rounded = formatFixedHalfUp(cleaned, 2)
    if (toDecimal(rounded).isZero()) return '-'
    return formatThousands(rounded, 2)
  } catch {
    return '-'
  }
}

export function formatHistoryBalanceMoney(value: unknown) {
  if (value === '-' || value === null || value === undefined) return '-'
  const cleaned = String(value).replace(/,/g, '').trim()
  if (cleaned === '' || cleaned === '-') return '0.00'
  try {
    const rounded = formatFixedHalfUp(cleaned, 2)
    if (toDecimal(rounded).isZero()) return '0.00'
    return formatThousands(rounded, 2)
  } catch {
    return '0.00'
  }
}

export function formatRateForHistoryDisplay(value: unknown) {
  if (value === '-' || value === null || value === undefined) return '-'
  const s = String(value).trim()
  if (s === '' || s === '-') return '-'
  try {
    const normalized = toDecimal(s.replace(/,/g, '').trim() || '0').toString()
    if (!normalized.includes('.')) return normalized
    const [intPart, frac = ''] = normalized.split('.')
    const truncated = `${intPart}.${frac.slice(0, 6)}`
    return truncated.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '')
  } catch {
    return s
  }
}

export function moneyTone(value: unknown): 'pos' | 'neg' | 'neutral' {
  try {
    const dec = toDecimal(String(value ?? '').replace(/,/g, ''), 0)
    if (dec.isNegative()) return 'neg'
    if (dec.isPositive()) return 'pos'
  } catch {
    /* ignore */
  }
  return 'neutral'
}
