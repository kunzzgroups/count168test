import { getJson, postForm } from './api.js'

export type SessionUser = {
  user_id?: number | string
  user_type?: string
  role?: string
  permissions?: unknown
  company_code?: string
  company_id?: string | number
  name?: string
  login_id?: string
  login_scope?: string
  login_identifier?: string
  login_group_id?: string
  member_login_account_id?: number | string
  member_winloss_view_account_id?: number | string
  winloss_view_account_id?: number | string
  needs_owner_secondary?: boolean
  needs_user_secondary?: boolean
  company_has_gambling?: boolean
  company_has_bank?: boolean
  is_current_company_c168?: boolean
}

export type AppTab = 'home' | 'transaction' | 'account' | 'more' | 'member'
export type SecondaryVariant = 'owner' | 'user'

function asUser(data: unknown): SessionUser | null {
  if (!data || typeof data !== 'object') return null
  return data as SessionUser
}

export async function fetchCurrentUser(): Promise<SessionUser | null> {
  const { res, data } = await getJson('api/session/current_user_api.php')
  if (!res.ok || data.success !== true) return null
  return asUser(data.data)
}

export async function logoutSession() {
  try {
    await postForm('api/session/logout_api.php', {})
  } catch {
    /* still clear local route */
  }
}

function normRole(role: unknown) {
  return String(role || '').trim().toLowerCase()
}

function getPermissions(me: SessionUser | null): string[] {
  return Array.isArray(me?.permissions) ? me.permissions.map(String) : []
}

function isOwnerUser(me: SessionUser | null) {
  return normRole(me?.role) === 'owner' || String(me?.user_type || '').toLowerCase() === 'owner'
}

function hasFullPermissions(me: SessionUser | null) {
  if (isOwnerUser(me)) return true
  return getPermissions(me).length === 0
}

function canAccessPermission(me: SessionUser | null, key: string) {
  if (hasFullPermissions(me)) return true
  return getPermissions(me).includes(key)
}

export function isMemberUser(me: SessionUser | null) {
  return String(me?.user_type || '').toLowerCase() === 'member'
}

export function canAccessDashboard(me: SessionUser | null) {
  return canAccessPermission(me, 'home')
}

export function canAccessTransaction(me: SessionUser | null) {
  return canAccessPermission(me, 'payment')
}

export function canAccessAccount(me: SessionUser | null) {
  return canAccessPermission(me, 'account')
}

export function secondaryFromRedirect(redirect: string): SecondaryVariant | null {
  const value = String(redirect || '')
  if (/owner[-_]secondary[-_]password/i.test(value) || value === '/owner-secondary-password') {
    return 'owner'
  }
  if (/user[-_]secondary[-_]password/i.test(value) || value === '/user-secondary-password') {
    return 'user'
  }
  return null
}

export function landingTab(me: SessionUser | null): AppTab {
  if (!me) return 'home'
  if (isMemberUser(me)) return 'member'
  if (canAccessDashboard(me)) return 'home'
  if (canAccessTransaction(me)) return 'transaction'
  if (canAccessAccount(me)) return 'account'
  return 'more'
}

export function navTabs(me: SessionUser | null): AppTab[] {
  if (isMemberUser(me)) return ['member']
  const tabs: AppTab[] = []
  if (canAccessDashboard(me)) tabs.push('home')
  if (canAccessTransaction(me)) tabs.push('transaction')
  if (canAccessAccount(me)) tabs.push('account')
  tabs.push('more')
  return tabs
}

export function companyLabel(me: SessionUser | null) {
  return String(me?.company_code || me?.company_id || me?.login_identifier || '').toUpperCase()
}

export function displayName(me: SessionUser | null) {
  return String(me?.name || me?.login_id || '').trim()
}
