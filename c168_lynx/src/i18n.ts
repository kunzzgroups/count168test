export type LoginLang = 'en' | 'zh'
export type LoginRole = 'admin' | 'member'

const AUTH_API_MESSAGES: Record<string, Record<LoginLang, string>> = {
  'Account ID, Company ID or password is incorrect': {
    en: 'Account ID, Company ID or password is incorrect',
    zh: '账号 ID、公司 ID 或密码不正确',
  },
  'Username or password is incorrect': {
    en: 'Username or password is incorrect',
    zh: '用户名或密码不正确',
  },
  'Company or Group has expired.': {
    en: 'Company or Group has expired.',
    zh: '公司或集团已过期。',
  },
}

export const LOGIN_I18N = {
  en: {
    title: 'EAZYCOUNT',
    hint: 'Sign in to continue',
    admin: 'Admin',
    member: 'Member',
    companyPlaceholder: 'Company / Group ID',
    accountPlaceholder: 'Account Id',
    usernamePlaceholder: 'Username',
    passwordPlaceholder: 'Password',
    rememberMe: 'Remember me',
    login: 'Login',
    loggingIn: 'Logging in...',
    notice: 'Notice',
    loginFailed: 'Login failed',
    loginBackendOffline:
      'Cannot reach PHP backend. From repo root run: php -S 127.0.0.1:8000',
    confirm: 'Confirm',
    boot: 'Loading...',
  },
  zh: {
    title: 'EAZYCOUNT',
    hint: '登录后进入手机版',
    admin: '管理员',
    member: '会员',
    companyPlaceholder: '公司 / 集团 ID',
    accountPlaceholder: '账号 ID',
    usernamePlaceholder: '用户名',
    passwordPlaceholder: '密码',
    rememberMe: '记住我',
    login: '登录',
    loggingIn: '登录中...',
    notice: '提示',
    loginFailed: '登录失败',
    loginBackendOffline: '无法连接 PHP 后端。请在仓库根目录运行：php -S 127.0.0.1:8000',
    confirm: '确认',
    boot: '加载中...',
  },
} as const

export const SECONDARY_I18N = {
  en: {
    title: 'Secondary Password Verification',
    lead: 'Please enter your 6-digit secondary password to continue',
    placeholder: 'Enter 6-digit password',
    verify: 'Verify',
    verifying: 'Verifying...',
    digitsSix: 'Please enter exactly 6 digits',
    genericError: 'An error occurred. Please try again.',
    backToLogin: 'Back to login',
  },
  zh: {
    title: '二级密码验证',
    lead: '请输入 6 位数字二级密码',
    placeholder: '请输入 6 位数字密码',
    verify: '验证',
    verifying: '验证中...',
    digitsSix: '请输入完整的 6 位数字',
    genericError: '发生错误，请稍后重试。',
    backToLogin: '返回登录',
  },
} as const

export const SHELL_I18N = {
  en: {
    navHome: 'Home',
    navTransaction: 'Transaction',
    navAccount: 'Account',
    navMore: 'More',
    winLoss: 'Win/Loss',
    comingNext: 'Coming next',
    comingBody: 'This screen will be ported from the current mobile app.',
    moreSubtitle: 'Account',
    logout: 'Logout',
    signedInAs: 'Signed in as',
  },
  zh: {
    navHome: '首页',
    navTransaction: '交易',
    navAccount: '账户',
    navMore: '更多',
    winLoss: '输赢',
    comingNext: '即将迁入',
    comingBody: '此页将从现有手机版逐页迁入。',
    moreSubtitle: '账户',
    logout: '退出',
    signedInAs: '当前登录',
  },
} as const

export function localizeAuthApiMessage(message: string, lang: LoginLang) {
  const text = String(message || '').trim()
  if (!text) return ''
  return AUTH_API_MESSAGES[text]?.[lang] || text
}

export const MEMBER_I18N = {
  en: {
    winLoss: 'Win/Loss',
    pageSubtitle: 'Payment history for your linked accounts.',
    company: 'Company',
    account: 'Account',
    currency: 'Currency',
    all: 'ALL',
    total: 'TOTAL',
    loading: 'Loading…',
    selectCurrency: 'Please select currency',
    noDataInRange: 'No data in the selected date range.',
    currencyTitle: 'Currency: {currency}',
    colDate: 'Date',
    colIdProduct: 'Id Product',
    colRate: 'Rate',
    colWinLoss: 'W/L',
    colCrDr: 'Cr/Dr',
    colBalance: 'Bal',
    colDescription: 'Description',
    colRemark: 'Remark',
    openingBalance: 'Opening Balance',
    paymentHistoryTapRowHint: 'Tap a row for description, rate, and remark.',
    createdBy: 'Created by',
    queryCompleted: 'Query completed',
    queryFailed: 'Query failed',
    failedSwitchCompany: 'Failed to switch company',
    switchedToCompany: 'Switched to company {label}',
    switchedToAccount: 'Switched to account {label}',
    failedSwitchAccount: 'Failed to switch account',
    switchFailed: 'Switch failed',
    couldNotLoadHistory: 'Could not load history',
    today: 'Today',
    yesterday: 'Yesterday',
    thisWeek: 'This Week',
    lastWeek: 'Last Week',
    thisMonth: 'This Month',
    lastMonth: 'Last Month',
    thisYear: 'This Year',
    lastYear: 'Last Year',
    balances: 'Balances',
    balancesAccounts: '{count} accounts',
    balancesCurrencies: '{count} currencies',
    balancesEmpty: 'No linked accounts.',
    accessDenied: 'Member access only.',
  },
  zh: {
    winLoss: '输赢',
    pageSubtitle: '关联账号的付款流水。',
    company: '公司',
    account: '账号',
    currency: '货币',
    all: '全部',
    total: 'TOTAL',
    loading: '加载中…',
    selectCurrency: '请选择货币',
    noDataInRange: '所选日期范围内暂无数据。',
    currencyTitle: '货币：{currency}',
    colDate: '日期',
    colIdProduct: '产品编号',
    colRate: '汇率',
    colWinLoss: '输赢',
    colCrDr: '借贷',
    colBalance: '余额',
    colDescription: '说明',
    colRemark: '备注',
    openingBalance: '期初余额',
    paymentHistoryTapRowHint: '点按行查看说明、汇率与备注。',
    createdBy: '创建人',
    queryCompleted: '查询完成',
    queryFailed: '查询失败',
    failedSwitchCompany: '切换公司失败',
    switchedToCompany: '已切换到公司 {label}',
    switchedToAccount: '已切换到账号 {label}',
    failedSwitchAccount: '切换账号失败',
    switchFailed: '切换失败',
    couldNotLoadHistory: '无法加载历史记录',
    today: '今天',
    yesterday: '昨天',
    thisWeek: '本周',
    lastWeek: '上周',
    thisMonth: '本月',
    lastMonth: '上月',
    thisYear: '今年',
    lastYear: '去年',
    balances: '余额',
    balancesAccounts: '{count} 个账号',
    balancesCurrencies: '{count} 种货币',
    balancesEmpty: '暂无关联账号。',
    accessDenied: '仅限会员访问。',
  },
} as const

export type MemberI18nKey = keyof typeof MEMBER_I18N.en

export function interpolate(template: string, params?: Record<string, string | number>) {
  let text = template
  for (const [key, value] of Object.entries(params || {})) {
    text = text.split(`{${key}}`).join(String(value))
  }
  return text
}

export function memberT(lang: LoginLang, key: MemberI18nKey, params?: Record<string, string | number>) {
  return interpolate(MEMBER_I18N[lang][key], params)
}

export function formatMemberRowDescription(lang: LoginLang, row: { row_type?: string; description?: string } | null) {
  if (!row) return '-'
  let text: string
  if (row.row_type === 'bf') {
    text = memberT(lang, 'openingBalance')
  } else {
    const desc = String(row.description || '').trim()
    text = desc.toUpperCase() === 'OPENING BALANCE' ? memberT(lang, 'openingBalance') : desc || '-'
  }
  if (!text || text === '-') return '-'
  return String(text).toUpperCase()
}

const MEMBER_API_MESSAGE_KEYS: Record<string, MemberI18nKey> = {
  'query failed': 'queryFailed',
  'switch failed': 'switchFailed',
  'failed to switch company': 'failedSwitchCompany',
  'failed to switch account': 'failedSwitchAccount',
  'could not load history': 'couldNotLoadHistory',
  'no data in the selected date range.': 'noDataInRange',
}

export function translateMemberApiMessage(lang: LoginLang, apiMessage: string, fallbackKey: MemberI18nKey) {
  const message = String(apiMessage ?? '').trim()
  const key = MEMBER_API_MESSAGE_KEYS[message.toLowerCase().replace(/\s+/g, ' ')]
  if (key) return memberT(lang, key)
  if (message) return message
  return memberT(lang, fallbackKey)
}

export function tabLabel(tab: 'home' | 'transaction' | 'account' | 'more' | 'member', lang: LoginLang) {
  const i18n = SHELL_I18N[lang]
  if (tab === 'home') return i18n.navHome
  if (tab === 'transaction') return i18n.navTransaction
  if (tab === 'account') return i18n.navAccount
  if (tab === 'more') return i18n.navMore
  return i18n.winLoss
}
