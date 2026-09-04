import { useCallback, useMemo, useState } from "react";
import MobileShell from "../../components/layout/MobileShell.jsx";
import ScopeBreadcrumb from "../dashboard/ScopeBreadcrumb.jsx";
import { useMobileAccount } from "../../hooks/useMobileAccount.js";
import {
  AccountFormSheet,
  AccountScopeSheet,
  CurrencySettingSheet,
  LinkAccountSheet,
} from "./AccountSheets.jsx";
import "./account.css";

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

function AccountCard({ row, account, onOpen }) {
  const { i18n } = account;
  const code = String(row.account_id || "").toUpperCase();
  const name = String(row.name || "").trim();
  const lastLoginText = row.last_login
    ? `${i18n.lastLogin} ${String(row.last_login).slice(0, 10)}`
    : "";
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="m-user-card tap-scale"
      aria-label={`${i18n.tapForDetail}: ${code}`}
    >
      <span className="m-user-card-avatar" aria-hidden="true">
        {code.slice(0, 2)}
      </span>
      <span className="m-user-card-copy">
        <strong title={name || undefined}>
          {code}
          {name && name.toUpperCase() !== code ? <span>{name}</span> : null}
        </strong>
        <small>
          {row.role ? <b>{String(row.role)}</b> : null}
          {lastLoginText ? (
            <>
              {row.role ? (
                <span className="m-user-card-sep" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <span>{lastLoginText}</span>
            </>
          ) : null}
        </small>
      </span>
      <i className="fas fa-chevron-right" aria-hidden="true" />
    </button>
  );
}

export default function AccountPage() {
  const account = useMobileAccount();
  const { i18n } = account;
  const [scopeOpen, setScopeOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const companyCode = String(account.selectedCompany?.company_id || "").toUpperCase();
  const groupId = String(
    account.selectedGroup ||
      account.selectedCompany?.group_id ||
      account.selectedCompany?.link_source_group ||
      "",
  )
    .trim()
    .toUpperCase();

  const scopeCompany = account.groupsAllMode || account.groupAllMode
    ? i18n.all
    : account.companyId
      ? companyCode
      : groupId;
  const sidebarGroup = account.companyId ? groupId : "";
  const overlayOpen = scopeOpen || formOpen || linkOpen || currencyOpen || sortOpen;

  const openCardEdit = useCallback(
    async (row) => {
      if (await account.openEdit(row)) setFormOpen(true);
    },
    [account],
  );

  const sortedLabel = useMemo(() => {
    const labels = {
      account: i18n.sortAccount,
      name: i18n.sortName,
      role: i18n.sortRole,
      lastLogin: i18n.sortLastLogin,
    };
    return `${labels[account.sortKey]} · ${
      account.sortDirection === "asc" ? i18n.ascending : i18n.descending
    }`;
  }, [account.sortDirection, account.sortKey, i18n]);

  const stickyBar = (
    <div className="m-account-sticky">
      <div className="m-account-scope-row">
        <button type="button" className="m-account-scope-btn tap-scale" onClick={() => setScopeOpen(true)}>
          <ScopeBreadcrumb
            i18n={i18n}
            groupId={groupId}
            companyCode={companyCode}
            groupsAllMode={account.groupsAllMode}
            groupAllMode={account.groupAllMode}
            groupOnlyMode={!account.companyId && Boolean(groupId)}
          />
          <i className="fas fa-sliders" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="m-account-settings-btn tap-scale"
          disabled={!account.canMutate}
          onClick={async () => {
            if (await account.openCurrency()) setCurrencyOpen(true);
          }}
          aria-label={i18n.currencySetting}
        >
          <i className="fas fa-gear" aria-hidden="true" />
        </button>
      </div>
      <label className="m-account-search">
        <i className="fas fa-magnifying-glass" aria-hidden="true" />
        <input
          value={account.search}
          onChange={(e) => account.setSearch(e.target.value)}
          placeholder={i18n.searchAccounts}
        />
      </label>
      <div className="m-account-chips">
        <Chip
          active={account.showInactive}
          onClick={() => account.setShowInactive((value) => !value)}
        >
          {i18n.showInactive}
        </Chip>
        <Chip active={sortOpen} onClick={() => setSortOpen(true)}>
          <i className="fas fa-arrow-down-wide-short" aria-hidden="true" /> {sortedLabel}
        </Chip>
      </div>
    </div>
  );

  if (account.blocked) return null;

  return (
    <MobileShell
      i18n={i18n}
      me={account.me}
      companyCode={scopeCompany}
      groupId={sidebarGroup}
      onLogout={account.logout}
      onRefresh={account.refresh}
      refreshing={account.refreshing}
      stickyBar={stickyBar}
      lang={account.lang}
      onLangChange={account.setLang}
      overlayOpen={overlayOpen}
      floatingAction={
        <button
          type="button"
          className="m-account-fab tap-scale"
          disabled={!account.canMutate}
          onClick={async () => {
            if (await account.openCreate()) setFormOpen(true);
          }}
          aria-label={i18n.addAccount}
        >
          <i className="fas fa-plus" aria-hidden="true" />
        </button>
      }
      overlay={
        <>
          <AccountScopeSheet open={scopeOpen} onClose={() => setScopeOpen(false)} account={account} />
          <AccountFormSheet
            open={formOpen}
            onClose={() => setFormOpen(false)}
            account={account}
            onLinkAccount={async () => {
              if (await account.loadLinks()) {
                setFormOpen(false);
                setLinkOpen(true);
              }
            }}
          />
          <LinkAccountSheet open={linkOpen} onClose={() => setLinkOpen(false)} account={account} />
          <CurrencySettingSheet
            open={currencyOpen}
            onClose={() => setCurrencyOpen(false)}
            account={account}
          />
          <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} account={account} />
        </>
      }
    >
      <div className="m-account-page">
        {account.toast ? (
          <div className={`m-account-toast ${account.toast.tone}`}>{account.toast.message}</div>
        ) : null}
        {account.error ? <div className="m-account-error">{account.error}</div> : null}
        {account.loading ? (
          <div className="m-account-loading">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{i18n.loadingAccounts}</span>
          </div>
        ) : account.accounts.length ? (
          <div className="m-account-list">
            {account.accounts.map((row) => (
              <AccountCard key={row.id} row={row} account={account} onOpen={openCardEdit} />
            ))}
          </div>
        ) : (
          <div className="m-account-empty">
            <i className="fas fa-address-book" aria-hidden="true" />
            <p>{i18n.noAccounts}</p>
          </div>
        )}
      </div>
    </MobileShell>
  );
}

function SortSheet({ open, onClose, account }) {
  const { i18n } = account;
  const choices = [
    ["account", i18n.sortAccount],
    ["name", i18n.sortName],
    ["role", i18n.sortRole],
    ["lastLogin", i18n.sortLastLogin],
  ];
  return (
    <div
      className={`m-sheet-overlay${open ? " m-sheet-overlay--open" : " m-sheet-overlay--closed"}`}
      aria-hidden={!open}
      inert={open ? undefined : ""}
    >
      <button type="button" className="m-sheet-backdrop" onClick={onClose} aria-label="Close" />
      <section className={`m-sheet-panel${open ? " m-sheet-panel--open" : " m-sheet-panel--closed"}`}>
        <div className="m-sheet-handle-wrap"><span className="m-sheet-handle" /></div>
        <header className="m-sheet-header">
          <h2 className="m-sheet-title">{i18n.sort}</h2>
          <button type="button" className="m-sheet-close" onClick={onClose}><i className="fas fa-xmark" /></button>
        </header>
        <div className="m-account-sort-list">
          {choices.map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={account.sortKey === key ? "is-active" : ""}
              onClick={() => {
                if (account.sortKey === key) {
                  account.setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
                } else {
                  account.setSortKey(key);
                  account.setSortDirection("asc");
                }
              }}
            >
              <span>{label}</span>
              {account.sortKey === key ? (
                <i className={`fas fa-arrow-${account.sortDirection === "asc" ? "up" : "down"}`} />
              ) : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
