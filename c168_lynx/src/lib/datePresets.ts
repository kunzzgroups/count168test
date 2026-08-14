export type PeriodPreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'

export const PERIOD_PRESET_KEYS: PeriodPreset[] = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'lastYear',
]

export function formatYmd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayYmd() {
  return formatYmd(new Date())
}

export function ymdToDmy(ymd: string) {
  const [y, m, d] = String(ymd || '').split('-')
  if (!y || !m || !d) return ''
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

export function periodPresetRange(preset: PeriodPreset) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let startDate: Date | null = null
  let endDate: Date | null = null

  if (preset === 'today') {
    startDate = new Date(today)
    endDate = new Date(today)
  } else if (preset === 'yesterday') {
    const d = new Date(today)
    d.setDate(d.getDate() - 1)
    startDate = d
    endDate = d
  } else if (preset === 'thisWeek') {
    const dayMon0 = (today.getDay() + 6) % 7
    startDate = new Date(today)
    startDate.setDate(today.getDate() - dayMon0)
    endDate = new Date(today)
  } else if (preset === 'lastWeek') {
    const dayMon0 = (today.getDay() + 6) % 7
    endDate = new Date(today)
    endDate.setDate(today.getDate() - dayMon0 - 1)
    startDate = new Date(endDate)
    startDate.setDate(endDate.getDate() - 6)
  } else if (preset === 'thisMonth') {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1)
    endDate = new Date(today)
  } else if (preset === 'lastMonth') {
    startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    endDate = new Date(today.getFullYear(), today.getMonth(), 0)
  } else if (preset === 'thisYear') {
    startDate = new Date(today.getFullYear(), 0, 1)
    endDate = new Date(today)
  } else if (preset === 'lastYear') {
    const y = today.getFullYear() - 1
    startDate = new Date(y, 0, 1)
    endDate = new Date(y, 11, 31)
  }

  if (!startDate || !endDate) return null
  startDate.setHours(0, 0, 0, 0)
  endDate.setHours(0, 0, 0, 0)
  return { dateFrom: formatYmd(startDate), dateTo: formatYmd(endDate) }
}

export function matchPreset(fromYmd: string, toYmd: string): PeriodPreset | '' {
  for (const key of PERIOD_PRESET_KEYS) {
    const range = periodPresetRange(key)
    if (range && range.dateFrom === fromYmd && range.dateTo === toYmd) return key
  }
  return ''
}
