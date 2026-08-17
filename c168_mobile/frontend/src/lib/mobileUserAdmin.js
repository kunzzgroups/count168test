/**
 * Mobile user admin — pure helpers ported from desktop
 * frontend/src/pages/userlist/userListLogic.js (rules aligned with api/users/userlist_api.php).
 * Keep role/capability rules in sync with the desktop file when they change.
 */

export const ROLE_HIERARCHY = {
  owner: 0,
  partnership: 1,
  admin: 2,
  manager: 3,
  supervisor: 4,
  accountant: 5,
  audit: 6,
  "customer service": 7,
  company: 8,
};

export const ALL_ROLE_OPTIONS = [
  { value: "partnership", label: "Partnership" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "supervisor", label: "Supervisor" },
  { value: "accountant", label: "Accountant" },
  { value: "audit", label: "Audit" },
  { value: "customer service", label: "Customer Service" },
  { value: "company", label: "Company" },
];

export const PERMISSION_KEYS = [
  "home",
  "admin",
  "account",
  "ownership",
  "process",
  "datacapture",
  "payment",
  "report",
  "maintenance",
];

export function normRole(r) {
  return String(r || "").trim().toLowerCase();
}

/** Ownership sidebar permission — only owner and partnership roles may have or see it. */
export function roleSupportsOwnershipPermission(role) {
  const r = normRole(role);
  return r === "owner" || r === "partnership";
}

export function getVisiblePermissionKeys(targetRole) {
  if (roleSupportsOwnershipPermission(targetRole)) return PERMISSION_KEYS;
  return PERMISSION_KEYS.filter((k) => k !== "ownership");
}

export function sanitizeSidebarPermissionsForRole(role, permissions) {
  if (!Array.isArray(permissions)) return [];
  if (roleSupportsOwnershipPermission(role)) return permissions;
  return permissions.filter((p) => p !== "ownership");
}

/** Partnership / Audit rows expose a Read Only toggle. */
export function roleHasReadOnlyToggle(role) {
  const r = normRole(role);
  return r === "partnership" || r === "audit";
}

/** Audit: manager and above; Partnership: owner only (matches API canSetUserReadOnly). */
export function canInteractWithReadOnlyToggle(currentUserRole, targetUserRole) {
  const r = normRole(targetUserRole);
  const curLevel = ROLE_HIERARCHY[normRole(currentUserRole)] ?? 999;
  const managerLevel = ROLE_HIERARCHY.manager ?? 999;
  if (r === "audit") return curLevel <= managerLevel;
  if (r === "partnership") return normRole(currentUserRole) === "owner";
  return false;
}

export function isOwnerEditingOwnerShadow(row, currentUserRole) {
  return !!row?.is_owner_shadow && normRole(currentUserRole) === "owner";
}

/**
 * Row capabilities (edit / delete / status-toggle rules) — same semantics as desktop.
 */
export function computeRowCapabilities(row, currentUserId, currentUserRole) {
  const targetRole = normRole(row.role);
  const isOwnerShadow = !!row.is_owner_shadow;
  const targetUserId = Number(row.id);
  const currentLevel = ROLE_HIERARCHY[normRole(currentUserRole)] ?? 999;
  const targetLevel = ROLE_HIERARCHY[targetRole] ?? 999;
  const isSelf = currentUserId && targetUserId === Number(currentUserId);
  const isSameLevel = currentLevel === targetLevel && !isSelf;
  const isHigherLevel = targetLevel < currentLevel;
  const lowPrivilegeRoles = ["manager", "supervisor", "accountant", "audit", "customer service"];
  const isLowPrivilegeUser = lowPrivilegeRoles.includes(normRole(currentUserRole));
  const isAdminUser = targetRole === "admin";
  const isOwnerUser = targetRole === "owner";

  let canEditDelete = true;
  let canDelete = true;
  let canToggleStatus = true;

  if (isSelf) {
    canDelete = false;
  } else if (isOwnerShadow) {
    canEditDelete = normRole(currentUserRole) === "owner";
    canDelete = canEditDelete;
  } else if (isLowPrivilegeUser && (isAdminUser || isOwnerUser)) {
    canEditDelete = false;
    canDelete = false;
  } else if (isSameLevel) {
    canDelete = false;
  } else if (isHigherLevel) {
    canDelete = false;
  }

  canToggleStatus = canEditDelete && !isSelf;
  if (!isOwnerShadow && (isSameLevel || isHigherLevel)) {
    canToggleStatus = false;
  }

  return { canEditDelete, canDelete, canToggleStatus, isSelf, isSameLevel, isHigherLevel, isOwnerShadow };
}

/** Edit form field locks — mirrors desktop getUserEditFieldLocks. */
export function getUserEditFieldLocks(row, currentUserId, currentUserRole) {
  if (isOwnerEditingOwnerShadow(row, currentUserRole)) {
    return { name: false, email: false, role: true, password: false, sidebar: true, company: true, accountProcess: true };
  }
  const caps = computeRowCapabilities(row, currentUserId, currentUserRole);
  const curLevel = ROLE_HIERARCHY[normRole(currentUserRole)] ?? 999;
  const editLevel = ROLE_HIERARCHY[normRole(row.role)] ?? 999;
  const isSelf = caps.isSelf;
  const isSame = !isSelf && curLevel === editLevel;
  const isLower = !isSelf && curLevel > editLevel;
  const canPickCompany = normRole(currentUserRole) === "admin" || normRole(currentUserRole) === "owner";
  return {
    name: isSame || isLower,
    email: isSame || isLower,
    role: isSame || isLower,
    password: false,
    sidebar: isSelf || isSame || isLower,
    company: isSelf || isSame || isLower || !canPickCompany,
    // Process stays locked for self unless canSelfEditAccountAccess unlocks Acc/Process.
    accountProcess: isSelf,
  };
}

/** Non-owner editing themselves may hide/unhide Acc and Process. Owner / owner-shadow cannot. */
export function canSelfEditAccountAccess(row, currentUserId, currentUserRole) {
  if (!row || row.is_owner_shadow) return false;
  if (normRole(currentUserRole) === "owner") return false;
  if (row.id == null || currentUserId == null) return false;
  return Number(row.id) === Number(currentUserId);
}

export function getCurrentUserRolePermissions(currentUserRole) {
  const rolePermissions = {
    owner: ["home", "admin", "account", "ownership", "process", "datacapture", "payment", "report", "maintenance"],
    partnership: ["home", "admin", "account", "ownership", "process", "datacapture", "payment", "report", "maintenance"],
    admin: ["home", "admin", "account", "process", "datacapture", "payment", "report", "maintenance"],
    manager: ["admin", "account", "process", "datacapture", "payment", "report", "maintenance"],
    supervisor: ["admin", "account", "process", "datacapture", "payment", "report"],
    accountant: ["account", "process", "payment", "report"],
    audit: ["payment", "report", "maintenance"],
    "customer service": ["account", "process", "datacapture", "payment", "report"],
  };
  return rolePermissions[normRole(currentUserRole)] || [];
}

export function getRoleTemplateSidebarList(role) {
  if (!role) return [];
  const adminDefault = ["home", "admin", "account", "process", "datacapture", "payment", "report", "maintenance"];
  const ownerDefault = ["home", "admin", "account", "ownership", "process", "datacapture", "payment", "report", "maintenance"];
  const rolePermissions = {
    owner: ownerDefault,
    partnership: [...ownerDefault],
    admin: adminDefault,
    manager: ["admin", "account", "process", "datacapture", "payment", "report", "maintenance"],
    supervisor: ["admin", "account", "process", "datacapture", "payment", "report"],
    accountant: ["account", "process", "payment", "report"],
    audit: ["payment", "report", "maintenance"],
    "customer service": ["account", "process", "datacapture", "payment", "report"],
  };
  return rolePermissions[normRole(role)] || [];
}

export function getAvailableRolesForCreation(currentUserRole) {
  const currentLevel = ROLE_HIERARCHY[normRole(currentUserRole)] ?? 999;
  if (currentLevel >= 5) return [];
  return ALL_ROLE_OPTIONS.filter((role) => {
    if (role.value === "company") return false;
    const roleLevel = ROLE_HIERARCHY[role.value] ?? 999;
    return roleLevel > currentLevel;
  });
}

export function getAvailableRolesForEdit(currentUserRole, editingUserRole) {
  const currentLevel = ROLE_HIERARCHY[normRole(currentUserRole)] ?? 999;
  const editingUserLevel = ROLE_HIERARCHY[normRole(editingUserRole)] ?? 999;
  if (currentLevel >= 4) return [];
  if (editingUserLevel <= currentLevel) return [];
  return ALL_ROLE_OPTIONS.filter((role) => {
    const roleLevel = ROLE_HIERARCHY[role.value] ?? 999;
    return roleLevel > currentLevel;
  });
}

export function getFinalPermissionsForCreation(selectedRole, manuallySelected, currentUserRole) {
  const cur = normRole(currentUserRole);
  const currentUserPermissions = getCurrentUserRolePermissions(cur);
  const rolePerms = {
    partnership: PERMISSION_KEYS,
    admin: ["home", "admin", "account", "process", "datacapture", "payment", "report", "maintenance"],
    manager: ["admin", "account", "process", "datacapture", "payment", "report", "maintenance"],
    supervisor: ["admin", "account", "process", "datacapture", "payment", "report"],
    accountant: ["account", "process", "payment", "report"],
    audit: ["payment", "report", "maintenance"],
    "customer service": ["account", "process", "datacapture", "payment", "report"],
  };
  const sr = normRole(selectedRole);
  if (!sr) {
    return manuallySelected.filter((perm) => currentUserPermissions.includes(perm));
  }
  const defaultPermissions = rolePerms[sr] ?? [];
  const manual = new Set(manuallySelected);
  const merged = defaultPermissions.filter((perm) => {
    if (currentUserPermissions.includes(perm)) return manual.has(perm);
    return true;
  });
  return sanitizeSidebarPermissionsForRole(sr, merged);
}

/** List filters — non-owner viewers only see their own partnership row. */
export function applyUserFilters(users, { search, showInactive, viewerRole, viewerUserId = null }) {
  const vr = normRole(viewerRole);
  let rows = users.map((u) => ({ ...u }));
  if (vr !== "owner") {
    const viewerIdNum = Number(viewerUserId);
    rows = rows.filter((u) => {
      if (normRole(u.role) !== "partnership") return true;
      if (!Number.isFinite(viewerIdNum) || viewerIdNum <= 0) return false;
      return Number(u.id) === viewerIdNum;
    });
  }
  const q = String(search || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((u) => `${u.login_id || ""} ${u.name || ""} ${u.email || ""}`.toLowerCase().includes(q));
  }
  if (showInactive) {
    rows = rows.filter((u) => normRole(u.status) === "inactive");
  } else {
    rows = rows.filter((u) => normRole(u.status) === "active");
  }
  return rows;
}

/** Owner shadow row first, then login_id asc. */
export function sortUsersByLogin(rows) {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (a.is_owner_shadow && !b.is_owner_shadow) return -1;
    if (!a.is_owner_shadow && b.is_owner_shadow) return 1;
    const al = String(a.login_id || "").toLowerCase();
    const bl = String(b.login_id || "").toLowerCase();
    if (al < bl) return -1;
    if (al > bl) return 1;
    return String(a.name || "").toLowerCase().localeCompare(String(b.name || "").toLowerCase());
  });
  return copy;
}

export function formatLastLogin(raw) {
  if (!raw) return "-";
  const s = String(raw).trim();
  if (!s) return "-";
  const d = new Date(s.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** permissions / account_permissions columns may arrive as JSON strings. */
export function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Acc/Process JSON: null means “see all listed items”.
 * Empty array means none selected. Flags (self_hidden / superior_closed) stay on rows.
 */
export function parseAccessPermissionRaw(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.toLowerCase() === "null") return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed == null) return null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Digit-first natural order: 2 < 10 < A < Z. */
export function compareAccessCode(a, b) {
  return String(a || "").localeCompare(String(b || ""), "en", { numeric: true, sensitivity: "base" });
}

/** Open (checked) items first, closed last; within each group numbers → A → Z. */
export function sortAccessItems(items, selectedIds, codeKey) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set();
  const list = Array.isArray(items) ? items : [];
  return [...list].sort((a, b) => {
    const aOn = selected.has(Number(a?.id)) ? 0 : 1;
    const bOn = selected.has(Number(b?.id)) ? 0 : 1;
    if (aOn !== bOn) return aOn - bOn;
    const byCode = compareAccessCode(a?.[codeKey], b?.[codeKey]);
    if (byCode !== 0) return byCode;
    return Number(a?.id || 0) - Number(b?.id || 0);
  });
}

/** null = editor may assign every listed item; Set = only those ids. */
export function parseAssignableIds(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  return new Set(raw.map((id) => Number(id)).filter((id) => id > 0));
}

export function accessRowHasFlag(row, flag) {
  return !!row && typeof row === "object" && (row[flag] === 1 || row[flag] === true || row[flag] === "1");
}

/**
 * Split stored Acc/Process JSON into checked ids vs superior-closed ids.
 * self_hidden rows stay listed but unchecked. null JSON = all listed selected.
 */
export function partitionAccessRows(raw, accList) {
  if (raw == null) {
    return {
      selected: new Set((accList || []).map((a) => Number(a.id)).filter((id) => id > 0)),
      superiorClosed: new Set(),
    };
  }
  const selected = new Set();
  const superiorClosed = new Set();
  for (const row of Array.isArray(raw) ? raw : []) {
    const id = Number(row?.id ?? row);
    if (!(id > 0)) continue;
    if (accessRowHasFlag(row, "superior_closed")) {
      superiorClosed.add(id);
      continue;
    }
    if (accessRowHasFlag(row, "self_hidden")) continue;
    selected.add(id);
  }
  return { selected, superiorClosed };
}

/**
 * Persist Acc/Process rows with flags. Only selected / superior-closed / self-hidden
 * toggleable items are written — never the whole company catalog.
 */
export function buildAccessPermissionPayload(items, selectedIds, superiorClosedIds, options = {}) {
  const { isSelf = false, toggleableIds = null, extraFields } = options;
  const selected = selectedIds instanceof Set ? selectedIds : new Set();
  const closed = superiorClosedIds instanceof Set ? superiorClosedIds : new Set();
  const out = [];
  for (const item of items || []) {
    const id = Number(item.id);
    if (!(id > 0)) continue;
    const inSelected = selected.has(id);
    const inClosed = closed.has(id);
    const inToggle = toggleableIds == null || toggleableIds.has(id);
    const extra = typeof extraFields === "function" ? extraFields(item) : {};
    const row = { id, ...extra };
    if (isSelf) {
      if (!inToggle && !inSelected && !inClosed) continue;
      if (inClosed) {
        out.push({ ...row, superior_closed: 1 });
        continue;
      }
      if (!inSelected) {
        if (!inToggle) continue;
        out.push({ ...row, self_hidden: 1 });
        continue;
      }
      out.push(row);
      continue;
    }
    if (inSelected) {
      out.push(row);
      continue;
    }
    if (inClosed) {
      out.push({ ...row, superior_closed: 1 });
    }
  }
  return out;
}

export function buildAccountPermissionPayload(accounts, selectedIds, superiorClosedIds, options = {}) {
  return buildAccessPermissionPayload(accounts, selectedIds, superiorClosedIds, {
    ...options,
    extraFields: (a) => ({ account_id: a.account_id || "" }),
  });
}

export function buildProcessPermissionPayload(processes, selectedIds, superiorClosedIds, options = {}) {
  return buildAccessPermissionPayload(processes, selectedIds, superiorClosedIds, {
    ...options,
    extraFields: (p) => ({ process_id: p.process_id || "", description: p.description || "" }),
  });
}

export function validateUserEmail(raw) {
  const normalized = String(raw || "").trim().toLowerCase();
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  return { ok, normalized };
}

function tenantCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isVirtualGroupLink(row) {
  return tenantCode(row?.link_source_group ?? row?.linkSourceGroup) !== "";
}

function isGroupEntity(row, groupId) {
  const group = tenantCode(groupId);
  if (!row || !group || isVirtualGroupLink(row)) return false;
  const code = tenantCode(row.company_id ?? row.companyId ?? row.code);
  const rowGroup = tenantCode(row.group_id ?? row.groupId ?? row.group);
  return code === group || (code === "" && rowGroup === group);
}

/** Desktop-aligned dual tenant picker: one assignable entity row per visible group. */
export function buildAdminGroupOptions(companies, visibleGroupIds) {
  const rows = Array.isArray(companies) ? companies : [];
  const out = [];
  const seen = new Set();
  for (const rawGroup of visibleGroupIds || []) {
    const group = tenantCode(rawGroup);
    if (!group || seen.has(group)) continue;
    const entity = rows.find((row) => isGroupEntity(row, group));
    const fallback = rows.find((row) => {
      if (isVirtualGroupLink(row)) return false;
      return tenantCode(row?.group_id ?? row?.groupId ?? row?.group) === group;
    });
    const picked = entity || fallback;
    const id = Number(picked?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    seen.add(group);
    out.push({ ...picked, id, company_id: group, group_id: group });
  }
  return out;
}

/** Desktop-aligned company area: subsidiaries and independent companies, deduped by code. */
export function buildAdminCompanyOptions(companies) {
  const out = [];
  const seen = new Set();
  for (const row of companies || []) {
    const code = tenantCode(row?.company_id ?? row?.companyId ?? row?.code);
    const group = tenantCode(row?.group_id ?? row?.groupId ?? row?.group);
    if (!code || isGroupEntity(row, group) || seen.has(code)) continue;
    const id = Number(row?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    seen.add(code);
    out.push({ ...row, id, company_id: code });
  }
  return out;
}

export function resolveAdminGroupEntityIds(groupOptions, groupCodes) {
  const wanted = new Set((groupCodes || []).map(tenantCode).filter(Boolean));
  return (groupOptions || [])
    .filter((row) => wanted.has(tenantCode(row?.group_id || row?.company_id)))
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

export function resolveAdminGroupCodes(groupOptions, selectedIds) {
  const wanted = new Set([...selectedIds].map(Number));
  const out = [];
  for (const row of groupOptions || []) {
    if (!wanted.has(Number(row.id))) continue;
    const code = tenantCode(row?.group_id || row?.company_id);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}
