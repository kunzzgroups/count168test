import { useCallback, useState } from "react";
import MobileShell from "../../components/layout/MobileShell.jsx";
import MobileSubpageHeader from "../../components/layout/MobileSubpageHeader.jsx";
import ScopeBreadcrumb from "../dashboard/ScopeBreadcrumb.jsx";
import { getRoleClass } from "../../lib/transactionPaymentLogic.js";
import { useIncrementalList } from "../../hooks/useIncrementalList.js";
import { useMobileAdminUsers } from "../../hooks/useMobileAdminUsers.js";
import { formatLastLogin, normRole } from "../../lib/mobileUserAdmin.js";
import { AccountScopeSheet } from "../account/AccountSheets.jsx";
import { UserDetailSheet, UserFormSheet } from "./AdminUserSheets.jsx";
import "../account/account.css";
import "./admin.css";

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`m-account-chip tap-scale${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function UserCard({ row, admin, onOpen }) {
  const { i18n } = admin;
  const roleClass = getRoleClass(row.role);
  const active = normRole(row.status) === "active";
  const caps = admin.rowCaps(row);
  return (
    <article className={`m-account-card m-account-role${roleClass ? ` ${roleClass}` : ""}`}>
      <button
        type="button"
        className="m-account-card-main tap-scale"
        onClick={() => onOpen(row)}
        aria-label={`${i18n.tapForDetail}: ${row.login_id}`}
      >
        <span className="m-account-avatar">{String(row.login_id || "U").slice(0, 2)}</span>
        <span className="m-account-card-copy">
          <strong>{String(row.login_id || "").toUpperCase()}</strong>
          <span>{String(row.name || "").toUpperCase()}</span>
          <small>
            {[
              row.role ? String(row.role).toUpperCase() : "",
              row.last_login ? `${i18n.lastLogin} ${formatLastLogin(row.last_login).slice(0, 10)}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
        <i className="fas fa-chevron-right" aria-hidden="true" />
      </button>
      <div className="m-account-card-actions m-admin-card-actions">
        {row.is_owner_shadow ? <span className="m-admin-owner-tag">OWNER</span> : <span />}
        <button
          type="button"
          disabled={!admin.canMutate || !caps.canToggleStatus}
          onClick={() => admin.toggleStatus(row)}
          className={`m-account-status tap-scale ${active ? "active" : "inactive"}`}
        >
          {active ? i18n.active : i18n.inactive}
        </button>
      </div>
    </article>
  );
}

export default function AdminUsersPage() {
  const admin = useMobileAdminUsers();
  const { i18n } = admin;
  const [scopeOpen, setScopeOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const { visible, hasMore, sentinelRef } = useIncrementalList(admin.users, 60);

  const companyCode = String(admin.selectedCompany?.company_id || "").toUpperCase();
  const groupId = String(
    admin.selectedGroup ||
      admin.selectedCompany?.group_id ||
      admin.selectedCompany?.link_source_group ||
      "",
  )
    .trim()
    .toUpperCase();

  const scopeCompany = admin.groupsAllMode || admin.groupAllMode
    ? i18n.all
    : admin.companyId
      ? companyCode
      : groupId;
  const sidebarGroup = admin.companyId ? groupId : "";
  const overlayOpen = scopeOpen || detailOpen || formOpen;

  const openDetail = useCallback(
    async (row) => {
      const detail = await admin.loadDetail(row);
      if (detail) setDetailOpen(true);
    },
    [admin],
  );

  const stickyBar = (
    <div className="m-account-sticky">
      <MobileSubpageHeader
        backTo="/more"
        backAriaLabel={i18n.backToMore}
        title={i18n.users}
        subtitle={i18n.usersSubtitle}
      />
      <div className="m-account-scope-row">
        <button type="button" className="m-account-scope-btn tap-scale" onClick={() => setScopeOpen(true)}>
          <ScopeBreadcrumb
            i18n={i18n}
            groupId={groupId}
            companyCode={companyCode}
            groupsAllMode={admin.groupsAllMode}
            groupAllMode={admin.groupAllMode}
            groupOnlyMode={!admin.companyId && Boolean(groupId)}
          />
          <i className="fas fa-sliders" aria-hidden="true" />
        </button>
      </div>
      <label className="m-account-search">
        <i className="fas fa-magnifying-glass" aria-hidden="true" />
        <input
          value={admin.search}
          onChange={(e) => admin.setSearch(e.target.value)}
          placeholder={i18n.searchUsers}
        />
      </label>
      <div className="m-account-chips">
        <Chip
          active={admin.showInactive}
          onClick={() => admin.setShowInactive((value) => !value)}
        >
          {i18n.showInactive}
        </Chip>
      </div>
    </div>
  );

  if (admin.blocked) return null;

  return (
    <MobileShell
      i18n={i18n}
      me={admin.me}
      companyCode={scopeCompany}
      groupId={sidebarGroup}
      onLogout={admin.logout}
      onRefresh={admin.refresh}
      refreshing={admin.refreshing}
      stickyBar={stickyBar}
      lang={admin.lang}
      onLangChange={admin.setLang}
      overlayOpen={overlayOpen}
      floatingAction={
        <button
          type="button"
          className="m-account-fab tap-scale"
          disabled={!admin.canMutate}
          onClick={async () => {
            if (await admin.openCreate()) setFormOpen(true);
          }}
          aria-label={i18n.addUser}
        >
          <i className="fas fa-plus" aria-hidden="true" />
        </button>
      }
      overlay={
        <>
          <AccountScopeSheet open={scopeOpen} onClose={() => setScopeOpen(false)} account={admin} />
          <UserDetailSheet
            open={detailOpen}
            onClose={() => setDetailOpen(false)}
            admin={admin}
            onEdit={async () => {
              if (await admin.openEdit()) {
                setDetailOpen(false);
                setFormOpen(true);
              }
            }}
          />
          <UserFormSheet open={formOpen} onClose={() => setFormOpen(false)} admin={admin} />
        </>
      }
    >
      <div className="m-account-page">
        {admin.toast ? (
          <div className={`m-account-toast ${admin.toast.tone}`}>{admin.toast.message}</div>
        ) : null}
        {admin.error ? <div className="m-account-error">{admin.error}</div> : null}
        {admin.loading ? (
          <div className="m-account-loading">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{i18n.loadingUsers}</span>
          </div>
        ) : admin.users.length ? (
          <div className="m-account-list">
            {visible.map((row) => (
              <UserCard key={`${row.id}-${row.is_owner_shadow ? "s" : "u"}`} row={row} admin={admin} onOpen={openDetail} />
            ))}
            {hasMore ? <div ref={sentinelRef} className="m-admin-sentinel" aria-hidden="true" /> : null}
          </div>
        ) : (
          <div className="m-account-empty">
            <i className="fas fa-users" aria-hidden="true" />
            <p>{i18n.noUsers}</p>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
