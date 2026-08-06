/** Mirrors desktop sidebarPermissions.js for mobile routes only. */

export function normRole(role) {
  return String(role || "").trim().toLowerCase();
}

export function isOwnerUser(me) {
  return normRole(me?.role) === "owner";
}

export function getUserPermissions(me) {
  return Array.isArray(me?.permissions) ? me.permissions : [];
}

/** Empty permissions = unrestricted (owner / legacy). */
export function hasFullPermissions(me) {
  if (isOwnerUser(me) || String(me?.user_type || "").toLowerCase() === "owner") return true;
  return getUserPermissions(me).length === 0;
}

export function canAccessPermission(me, key) {
  if (hasFullPermissions(me)) return true;
  return getUserPermissions(me).includes(key);
}

export function canAccessDashboard(me) {
  return canAccessPermission(me, "home");
}

export function canAccessReport(me) {
  return canAccessPermission(me, "report");
}

export function canAccessTransaction(me) {
  return canAccessPermission(me, "payment");
}

export function canAccessAccount(me) {
  return canAccessPermission(me, "account");
}

/** Admin (user management) — mirrors the desktop "admin" sidebar permission. */
export function canAccessAdmin(me) {
  if (String(me?.user_type || "").toLowerCase() === "member") return false;
  return canAccessPermission(me, "admin");
}

/** Full Maintenance: owner / unrestricted, or explicit "maintenance" permission. */
export function canAccessFullMaintenance(me) {
  if (hasFullPermissions(me)) return true;
  return canAccessPermission(me, "maintenance");
}

/** Non-owner without Maintenance permission but whose company has gambling/bank. */
export function canAccessLimitedMaintenance(me) {
  if (hasFullPermissions(me)) return false;
  if (canAccessFullMaintenance(me)) return false;
  return Boolean(me?.company_has_gambling || me?.company_has_bank);
}

/** Transaction Maintenance page (mirrors desktop canAccessTransactionFormulaMaintenance). */
export function canAccessTransactionMaintenance(me) {
  return canAccessFullMaintenance(me) || canAccessLimitedMaintenance(me);
}

/** Payment Maintenance page — full Maintenance permission only (desktop-aligned). */
export function canAccessPaymentMaintenance(me) {
  return canAccessFullMaintenance(me);
}

/**
 * Bankprocess Maintenance (audit/delete bank-process-sourced txs).
 * Desktop: full maintenance + company_has_bank.
 */
export function canAccessBankprocessMaintenance(me) {
  if (!canAccessFullMaintenance(me)) return false;
  return Boolean(me?.company_has_bank);
}

/** Maintenance hub / More entry visibility. */
export function canAccessMaintenance(me) {
  return canAccessTransactionMaintenance(me);
}

/** Bank Process list — desktop sidebar "process" permission. */
export function canAccessBankProcess(me) {
  return canAccessPermission(me, "process");
}

/** First mobile route after login — aligned with desktop sidebar order where possible. */
export function resolveMobileLandingPath(me) {
  if (!me) return "/login";

  const userType = String(me.user_type || "").toLowerCase();
  if (userType === "member") return "/member";
  if (me.needs_owner_secondary) return "/owner-secondary-password";
  if (me.needs_user_secondary) return "/user-secondary-password";

  if (canAccessDashboard(me)) return "/dashboard";
  if (canAccessTransaction(me)) return "/transaction";
  if (canAccessAccount(me)) return "/account";
  if (canAccessReport(me)) return "/report";
  return "/more";
}

export function mobileNavItems(me) {
  const items = [];
  if (canAccessDashboard(me)) {
    items.push({ to: "/dashboard", icon: "fa-house", key: "navHome" });
  }
  if (canAccessTransaction(me)) {
    items.push({ to: "/transaction", icon: "fa-money-bill-transfer", key: "navTransaction" });
  }
  if (canAccessAccount(me)) {
    items.push({ to: "/account", icon: "fa-address-book", key: "navAccount" });
  }
  items.push({ to: "/more", icon: "fa-ellipsis", key: "navMore" });
  return items;
}
