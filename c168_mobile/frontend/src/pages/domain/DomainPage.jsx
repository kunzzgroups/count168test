import { useCallback, useMemo, useState } from "react";
import MobileShell from "../../components/layout/MobileShell.jsx";
import { useIncrementalList } from "../../hooks/useIncrementalList.js";
import { useMobileDomain } from "../../hooks/useMobileDomain.js";
import {
  MAX_VISIBLE_CHIPS,
  forceSearchValue,
  formatDomainFeeSettingsInlineSummary,
} from "../../lib/domainHelpers.js";
import {
  DomainConfirmSheet,
  DomainExpirationSheet,
  DomainFeeSheet,
  DomainFormSheet,
} from "./DomainSheets.jsx";
import "../account/account.css";
import "./domain.css";

function resolveGroupsFull(domain) {
  if (Array.isArray(domain?.groups_full) && domain.groups_full.length > 0) {
    return domain.groups_full;
  }
  const raw = String(domain?.group_ids || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((group_code) => ({ group_code, expiration_date: null }));
}

function DomainCard({ domain, domainApi, onEdit, onCompanyExp, onGroupExp }) {
  const { i18n, t, selectMode, checkedIds, toggleChecked, isDeletable } = domainApi;
  const companiesFull = Array.isArray(domain.companies_full) ? domain.companies_full : [];
  const companyList = companiesFull.map((c) => c.company_id).filter(Boolean);
  const visible = companyList.slice(0, MAX_VISIBLE_CHIPS);
  const hidden = companyList.slice(MAX_VISIBLE_CHIPS);
  const groupsFull = resolveGroupsFull(domain);
  const groupList = groupsFull.map((g) => g.group_code).filter(Boolean);
  const visibleGroups = groupList.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenGroups = groupList.slice(MAX_VISIBLE_CHIPS);
  const deletable = isDeletable(domain);
  const checked = checkedIds.has(domain.id);

  return (
    <article className={`m-account-card m-domain-card${checked ? " is-selected" : ""}`}>
      <div className="m-domain-card-top">
        {selectMode ? (
          <label className="m-domain-check">
            <input
              type="checkbox"
              disabled={!deletable}
              checked={checked}
              onChange={(e) => toggleChecked(domain.id, e.target.checked)}
              aria-label={t("selectOwnerForDelete")}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="m-account-card-main tap-scale m-domain-card-main"
          onClick={() => {
            if (selectMode) {
              if (deletable) toggleChecked(domain.id, !checked);
              return;
            }
            onEdit(domain);
          }}
          aria-label={`${i18n.tapForDetail}: ${domain.owner_code}`}
        >
          <span className="m-account-avatar">{String(domain.owner_code || "D").slice(0, 2)}</span>
          <span className="m-account-card-copy">
            <strong>{String(domain.owner_code || "").toUpperCase()}</strong>
            <span>{String(domain.name || "").toUpperCase()}</span>
            <small>{String(domain.email || "").toLowerCase()}</small>
          </span>
          {!selectMode ? <i className="fas fa-chevron-right" aria-hidden="true" /> : null}
        </button>
      </div>

      <div className="m-domain-chip-block">
        <span className="m-domain-chip-label">{t("groupIdLabel")}</span>
        <div className="m-domain-chip-row">
          {groupList.length === 0 ? (
            <span className="m-domain-muted">—</span>
          ) : (
            <>
              {visibleGroups.map((gid) => (
                <button
                  key={gid}
                  type="button"
                  className="m-domain-chip m-domain-chip--group tap-scale"
                  onClick={() => onGroupExp(groupsFull)}
                >
                  {gid}
                </button>
              ))}
              {hiddenGroups.length > 0 ? (
                <button
                  type="button"
                  className="m-domain-chip m-domain-chip--more tap-scale"
                  onClick={() => onGroupExp(groupsFull)}
                >
                  +{hiddenGroups.length}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="m-domain-chip-block">
        <span className="m-domain-chip-label">{t("companiesWithColon")}</span>
        <div className="m-domain-chip-row">
          {companyList.length === 0 ? (
            <span className="m-domain-muted">—</span>
          ) : (
            <>
              {visible.map((cid) => (
                <button
                  key={cid}
                  type="button"
                  className="m-domain-chip tap-scale"
                  onClick={() => onCompanyExp(companiesFull)}
                >
                  {cid}
                </button>
              ))}
              {hidden.length > 0 ? (
                <button
                  type="button"
                  className="m-domain-chip m-domain-chip--more tap-scale"
                  onClick={() => onCompanyExp(companiesFull)}
                >
                  +{hidden.length}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="m-domain-card-meta">
        <span>
          {t("createdBy")} {String(domain.created_by || "—").toUpperCase()}
        </span>
        {!selectMode ? (
          <button type="button" className="m-domain-edit-link tap-scale" onClick={() => onEdit(domain)}>
            {t("edit")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function DomainPage() {
  const domain = useMobileDomain();
  const { i18n, t } = domain;
  const [feeOpen, setFeeOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState(null);
  const [expCompanies, setExpCompanies] = useState(null);
  const [expGroups, setExpGroups] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const { visible, hasMore, sentinelRef } = useIncrementalList(domain.filteredDomains, 40);

  const feeSummary = useMemo(() => {
    if (!domain.domainPeriodPrices) return "";
    return formatDomainFeeSettingsInlineSummary(domain.domainPeriodPrices, t);
  }, [domain.domainPeriodPrices, t]);

  const openAdd = useCallback(() => {
    setEditingDomain(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((row) => {
    setEditingDomain(row);
    setFormOpen(true);
  }, []);

  const overlayOpen = feeOpen || formOpen || Boolean(expCompanies) || Boolean(expGroups) || Boolean(confirm);

  const stickyBar = (
    <div className="m-account-sticky">
      <div className="m-domain-heading">
        <h1>{t("domainList")}</h1>
        {feeSummary ? <p className="m-domain-fee-summary">{feeSummary}</p> : null}
      </div>
      <label className="m-account-search">
        <i className="fas fa-magnifying-glass" aria-hidden="true" />
        <input
          value={domain.search}
          onChange={(e) => domain.setSearch(forceSearchValue(e.target.value))}
          placeholder={t("searchPlaceholder")}
        />
      </label>
      <div className="m-account-chips">
        <button type="button" className="m-account-chip tap-scale" onClick={() => setFeeOpen(true)}>
          {t("price")}
        </button>
        <button
          type="button"
          className={`m-account-chip tap-scale${domain.selectMode ? " is-active" : ""}`}
          onClick={() => {
            if (domain.selectMode) domain.clearSelection();
            else domain.setSelectMode(true);
          }}
        >
          {domain.selectMode ? i18n.doneSelect : i18n.selectMode}
        </button>
        {domain.selectMode ? (
          <button
            type="button"
            className="m-account-chip m-domain-chip-danger tap-scale"
            disabled={domain.checkedIds.size === 0}
            onClick={() => void domain.deleteSelected()}
          >
            {domain.checkedIds.size > 0
              ? t("deleteWithCount", { count: domain.checkedIds.size })
              : t("delete")}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (domain.blocked) return null;

  return (
    <MobileShell
      i18n={i18n}
      me={domain.me}
      companyCode={domain.companyCode}
      groupId={domain.groupId}
      onLogout={domain.logout}
      onRefresh={domain.refresh}
      refreshing={domain.refreshing}
      stickyBar={stickyBar}
      lang={domain.lang}
      onLangChange={domain.setLang}
      overlayOpen={overlayOpen}
      floatingAction={
        <button
          type="button"
          className="m-account-fab tap-scale"
          onClick={openAdd}
          aria-label={t("addDomainBtn")}
        >
          <i className="fas fa-plus" aria-hidden="true" />
        </button>
      }
      overlay={
        <>
          <DomainFeeSheet
            open={feeOpen}
            onClose={() => setFeeOpen(false)}
            domain={domain}
          />
          <DomainExpirationSheet
            open={Boolean(expCompanies)}
            onClose={() => setExpCompanies(null)}
            mode="company"
            rows={expCompanies || []}
            t={t}
          />
          <DomainExpirationSheet
            open={Boolean(expGroups)}
            onClose={() => setExpGroups(null)}
            mode="group"
            rows={expGroups || []}
            t={t}
          />
          <DomainConfirmSheet
            open={Boolean(confirm)}
            onClose={() => setConfirm(null)}
            message={confirm?.message || ""}
            onConfirm={confirm?.onConfirm}
            t={t}
          />
          <DomainFormSheet
            open={formOpen}
            onClose={() => setFormOpen(false)}
            domain={domain}
            editingDomain={editingDomain}
            setConfirm={setConfirm}
          />
        </>
      }
    >
      <div className="m-account-page m-domain-page">
        {domain.toast ? (
          <div className={`m-account-toast ${domain.toast.tone}`}>{domain.toast.message}</div>
        ) : null}
        {domain.error ? <div className="m-account-error">{domain.error}</div> : null}
        {domain.loading ? (
          <div className="m-account-loading">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{i18n.loading}</span>
          </div>
        ) : visible.length ? (
          <div className="m-account-list">
            {visible.map((row) => (
              <DomainCard
                key={row.id}
                domain={row}
                domainApi={domain}
                onEdit={openEdit}
                onCompanyExp={setExpCompanies}
                onGroupExp={setExpGroups}
              />
            ))}
            {hasMore ? <div ref={sentinelRef} className="m-admin-sentinel" aria-hidden="true" /> : null}
          </div>
        ) : (
          <div className="m-account-empty">
            <i className="fas fa-globe" aria-hidden="true" />
            <p>{i18n.noDomains}</p>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
