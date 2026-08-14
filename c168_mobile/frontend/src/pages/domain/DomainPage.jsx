import { useCallback, useRef, useState } from "react";
import MobileShell from "../../components/layout/MobileShell.jsx";
import MobileSubpageHeader from "../../components/layout/MobileSubpageHeader.jsx";
import { useIncrementalList } from "../../hooks/useIncrementalList.js";
import { useMobileDomain } from "../../hooks/useMobileDomain.js";
import { MAX_VISIBLE_CHIPS, forceSearchValue } from "../../lib/domainHelpers.js";
import {
  DomainConfirmSheet,
  DomainExpirationSheet,
  DomainFeeSheet,
  DomainFormSheet,
} from "./DomainSheets.jsx";
import "../account/account.css";
import "./domain.css";

const LONG_PRESS_MS = 480;

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

function DomainCard({ domain, domainApi, onEdit, onCompanyExp, onGroupExp, onLongPressSelect }) {
  const { i18n, t, selectMode, checkedIds, toggleChecked, isDeletable } = domainApi;
  const companiesFull = Array.isArray(domain.companies_full) ? domain.companies_full : [];
  const companyList = companiesFull.map((c) => c.company_id).filter(Boolean);
  const groupsFull = resolveGroupsFull(domain);
  const groupList = groupsFull.map((g) => g.group_code).filter(Boolean);

  const groupBudget = Math.min(groupList.length, MAX_VISIBLE_CHIPS);
  const visibleGroups = groupList.slice(0, groupBudget);
  const companyBudget = Math.max(0, MAX_VISIBLE_CHIPS - visibleGroups.length);
  const visibleCompanies = companyList.slice(0, companyBudget);
  const hiddenCount =
    groupList.length - visibleGroups.length + (companyList.length - visibleCompanies.length);

  const deletable = isDeletable(domain);
  const checked = checkedIds.has(domain.id);
  const hasChips = groupList.length > 0 || companyList.length > 0;

  const pressTimer = useRef(null);
  const longPressed = useRef(false);

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    longPressed.current = false;
    clearPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onLongPressSelect(domain);
    }, LONG_PRESS_MS);
  };

  const onPointerEnd = () => clearPress();

  return (
    <article
      className={`m-account-card m-domain-card${checked ? " is-selected" : ""}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerLeave={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
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
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            if (selectMode) {
              if (deletable) toggleChecked(domain.id, !checked);
              return;
            }
            onEdit(domain);
          }}
          aria-label={`${i18n.tapForDetail}: ${domain.owner_code}`}
        >
          <span className="m-account-avatar">
            {String(domain.owner_code || "D").slice(0, 2)}
          </span>
          <span className="m-account-card-copy">
            <strong>{String(domain.owner_code || "").toUpperCase()}</strong>
            <span>{String(domain.name || "").toUpperCase()}</span>
            <small>{String(domain.email || "").toLowerCase()}</small>
          </span>
          {!selectMode ? <i className="fas fa-chevron-right" aria-hidden="true" /> : null}
        </button>
      </div>

      {hasChips ? (
        <div className="m-domain-chips-bar">
          {visibleGroups.length > 0 ? (
            <div className="m-domain-chip-lane">
              <span className="m-domain-chip-cat m-domain-chip-cat--group">{t("groupChipLabel")}</span>
              <div className="m-domain-chip-row">
                {visibleGroups.map((gid) => (
                  <button
                    key={`g-${gid}`}
                    type="button"
                    className="m-domain-chip m-domain-chip--group tap-scale"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onGroupExp(groupsFull)}
                  >
                    {gid}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {visibleCompanies.length > 0 || (hiddenCount > 0 && companyList.length > 0) ? (
            <div className="m-domain-chip-lane">
              <span className="m-domain-chip-cat">{t("companyChipLabel")}</span>
              <div className="m-domain-chip-row">
                {visibleCompanies.map((cid) => (
                  <button
                    key={`c-${cid}`}
                    type="button"
                    className="m-domain-chip tap-scale"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onCompanyExp(companiesFull)}
                  >
                    {cid}
                  </button>
                ))}
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    className="m-domain-chip m-domain-chip--more tap-scale"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      if (companyList.length > visibleCompanies.length) onCompanyExp(companiesFull);
                      else onGroupExp(groupsFull);
                    }}
                  >
                    +{hiddenCount}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="m-account-card-actions m-domain-card-foot">
        <span className="m-domain-created">
          {t("createdBy")} {String(domain.created_by || "—").toUpperCase()}
        </span>
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

  const openAdd = useCallback(() => {
    setEditingDomain(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((row) => {
    setEditingDomain(row);
    setFormOpen(true);
  }, []);

  const onLongPressSelect = useCallback(
    (row) => {
      if (!domain.isDeletable(row)) {
        domain.notify(t("cannotDeleteOwnersWithCompanies"), "error");
        return;
      }
      if (!domain.selectMode) domain.setSelectMode(true);
      domain.toggleChecked(row.id, true);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(12);
      }
    },
    [domain, t],
  );

  const overlayOpen = feeOpen || formOpen || Boolean(expCompanies) || Boolean(expGroups) || Boolean(confirm);

  const stickyBar = (
    <div className="m-account-sticky m-domain-sticky">
      <MobileSubpageHeader
        backTo="/more"
        backAriaLabel={t("backToMore")}
        title={t("domainList")}
        trailing={
          <button
            type="button"
            className="m-domain-price-pill tap-scale"
            onClick={() => setFeeOpen(true)}
            aria-label={t("price")}
          >
            <i className="fas fa-tags" aria-hidden="true" />
            {t("price")}
          </button>
        }
      />
      <label className="m-account-search">
        <i className="fas fa-magnifying-glass" aria-hidden="true" />
        <input
          value={domain.search}
          onChange={(e) => domain.setSearch(forceSearchValue(e.target.value))}
          placeholder={t("searchPlaceholder")}
        />
      </label>
      {domain.selectMode ? (
        <div className="m-account-chips">
          <button
            type="button"
            className="m-account-chip is-active tap-scale"
            onClick={() => domain.clearSelection()}
          >
            {i18n.doneSelect}
          </button>
          <button
            type="button"
            className="m-account-chip m-domain-chip-danger tap-scale"
            disabled={domain.checkedIds.size === 0}
            onClick={() => {
              const prep = domain.prepareBulkDelete();
              if (!prep) return;
              setConfirm({
                message: prep.message,
                onConfirm: () => {
                  void domain.executeBulkDelete(prep.valid);
                },
              });
            }}
          >
            {domain.checkedIds.size > 0
              ? t("deleteWithCount", { count: domain.checkedIds.size })
              : t("delete")}
          </button>
        </div>
      ) : (
        <p className="m-domain-select-hint">{t("longPressToSelect")}</p>
      )}
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
          <DomainFeeSheet open={feeOpen} onClose={() => setFeeOpen(false)} domain={domain} />
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
          <DomainFormSheet
            open={formOpen}
            onClose={() => setFormOpen(false)}
            domain={domain}
            editingDomain={editingDomain}
            setConfirm={setConfirm}
          />
          <DomainConfirmSheet
            open={Boolean(confirm)}
            onClose={() => setConfirm(null)}
            message={confirm?.message || ""}
            onConfirm={confirm?.onConfirm}
            t={t}
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
                onLongPressSelect={onLongPressSelect}
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
