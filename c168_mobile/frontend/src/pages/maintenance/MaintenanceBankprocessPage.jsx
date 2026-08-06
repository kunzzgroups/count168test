import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MobileShell from "../../components/layout/MobileShell.jsx";
import MobileSubpageHeader from "../../components/layout/MobileSubpageHeader.jsx";
import { useIncrementalList } from "../../hooks/useIncrementalList.js";
import { useMaintenanceSession } from "../../hooks/useMaintenanceSession.js";
import { companyHasBankPermission } from "../../lib/bankProcessApi.js";
import {
  bankprocessMaintenanceRowKey,
  deleteBankprocessMaintenanceRecords,
  fetchCompanyCurrencies,
  formatMaintenanceAmount,
  isBankprocessMaintenanceRowSelectable,
  searchBankprocessMaintenance,
  toggleBankprocessMaintenanceBatchSelection,
} from "../../lib/maintenanceApi.js";
import { notifyTransactionListInvalidated } from "../../lib/transactionPaymentLogic.js";
import {
  maintenanceScopeIsReady,
  maintenanceScopeKey,
  todayYmd,
  ymdToDmy,
} from "../../lib/mobileMaintenanceScope.js";
import { getMaintenanceText } from "../../translateFile/maintenanceTranslate.js";
import { canAccessBankprocessMaintenance } from "../../utils/mobilePermissions.js";
import { MaintenanceFilterBar, MaintenanceFilterSheet } from "./MaintenanceSheets.jsx";
import "./maintenance.css";

export default function MaintenanceBankprocessPage() {
  const s = useMaintenanceSession({ canAccess: canAccessBankprocessMaintenance });
  const { i18n, lang, scope } = s;

  const [dateFrom, setDateFrom] = useState(todayYmd);
  const [dateTo, setDateTo] = useState(todayYmd);
  const [activePreset, setActivePreset] = useState("today");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [currency, setCurrency] = useState("");
  const [currencyCodes, setCurrencyCodes] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bankReady, setBankReady] = useState(false);

  const seqRef = useRef(0);
  const bankCacheRef = useRef(new Map());
  const scopeReady = maintenanceScopeIsReady(scope);
  const scopeCacheKey = maintenanceScopeKey(scope);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  /** Prefer a Bank company (desktop sidebar gate). */
  useEffect(() => {
    if (!s.me || s.loading || !s.companies.length) return undefined;
    const ac = new AbortController();
    (async () => {
      const currentCode = String(s.selectedCompany?.company_id || "").trim();
      if (currentCode) {
        const ok = await companyHasBankPermission(currentCode, ac.signal);
        if (ac.signal.aborted) return;
        if (ok) {
          setBankReady(true);
          return;
        }
      }
      for (const c of s.companies) {
        const code = String(c.company_id || "").trim();
        if (!code) continue;
        let hit = bankCacheRef.current.get(code);
        if (hit === undefined) {
          hit = await companyHasBankPermission(code, ac.signal);
          if (ac.signal.aborted) return;
          bankCacheRef.current.set(code, hit);
        }
        if (hit) {
          await s.applyScope({ mode: "company", companyId: Number(c.id) });
          if (!ac.signal.aborted) setBankReady(true);
          return;
        }
      }
      if (!ac.signal.aborted) {
        setBankReady(false);
        setListError(i18n.bankUnauthorizedCompany);
      }
    })().catch((e) => {
      if (e?.name !== "AbortError") setListError(e?.message || i18n.loadFailed);
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.me, s.loading, s.companies]);

  useEffect(() => {
    if (!scopeReady || scope?.mode !== "company" || !scope.companyId) {
      setCurrencyCodes([]);
      return undefined;
    }
    const ac = new AbortController();
    fetchCompanyCurrencies(scope.companyId, ac.signal)
      .then((codes) => {
        if (ac.signal.aborted) return;
        setCurrencyCodes(codes);
        setCurrency((prev) => (prev && codes.includes(prev) ? prev : ""));
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setCurrencyCodes([]);
      });
    return () => ac.abort();
  }, [scopeReady, scope?.mode, scope?.companyId]);

  const loadList = useCallback(
    async (signal) => {
      if (!scopeReady || scope?.mode !== "company" || !scope.companyId) {
        setListError(i18n.bpNeedCompany || i18n.bankNeedCompany);
        setRows([]);
        return;
      }
      if (!bankReady) return;
      const seq = ++seqRef.current;
      setListLoading(true);
      setListError("");
      try {
        const data = await searchBankprocessMaintenance({
          companyId: scope.companyId,
          dateFrom: ymdToDmy(dateFrom),
          dateTo: ymdToDmy(dateTo),
          currency,
          query: debouncedQuery,
          signal,
        });
        if (seq !== seqRef.current) return;
        setRows(data);
        setSelectedIds(new Set());
      } catch (e) {
        if (e?.name === "AbortError" || seq !== seqRef.current) return;
        setListError(e?.message || i18n.loadFailed);
        setRows([]);
      } finally {
        if (seq === seqRef.current) setListLoading(false);
      }
    },
    [
      scope,
      scopeReady,
      bankReady,
      dateFrom,
      dateTo,
      currency,
      debouncedQuery,
      i18n.loadFailed,
      i18n.bpNeedCompany,
      i18n.bankNeedCompany,
    ],
  );

  useEffect(() => {
    if (!s.me || !scopeReady || !bankReady) return undefined;
    const ac = new AbortController();
    loadList(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.me, scopeCacheKey, dateFrom, dateTo, currency, debouncedQuery, bankReady]);

  const { visible, hasMore, sentinelRef, shown, total } = useIncrementalList(rows);

  const toggleRow = useCallback(
    (row) => {
      if (!isBankprocessMaintenanceRowSelectable(row)) return;
      setSelectedIds((prev) =>
        toggleBankprocessMaintenanceBatchSelection(prev, rows, row.transaction_id),
      );
    },
    [rows],
  );

  const selectedList = useMemo(
    () =>
      rows.filter(
        (r) =>
          isBankprocessMaintenanceRowSelectable(r) &&
          selectedIds.has(Number(r.transaction_id)),
      ),
    [rows, selectedIds],
  );

  const doDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const ids = [...selectedIds];
      await deleteBankprocessMaintenanceRecords({ transactionIds: ids });
      notifyTransactionListInvalidated("mobile_bankprocess_maintenance_delete");
      s.notify(getMaintenanceText(lang, "deleteSuccess", { n: ids.length }), "success");
      setConfirmOpen(false);
      await loadList();
    } catch (e) {
      s.notify(e?.message || i18n.deleteFailed, "error");
    } finally {
      setDeleting(false);
    }
  }, [selectedIds, s, lang, i18n.deleteFailed, loadList]);

  const scopeLabel = s.groupMode
    ? s.selectedGroup || i18n.group
    : String(s.selectedCompany?.company_id || "").toUpperCase() || i18n.company;

  const stickyBar = (
    <div className="m-mt-sticky">
      <MobileSubpageHeader
        backTo="/maintenance"
        backAriaLabel={i18n.backToHub}
        title={i18n.bpMaintenanceTitle}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: i18n.bpSearchPlaceholder,
          clearAriaLabel: i18n.reset,
        }}
      />
      <MaintenanceFilterBar
        i18n={i18n}
        dateFrom={dateFrom}
        dateTo={dateTo}
        groupMode={s.groupMode}
        selectedGroup={s.selectedGroup}
        selectedCompany={s.selectedCompany}
        onOpen={() => setFilterOpen(true)}
      />
    </div>
  );

  if (s.blocked) return null;

  const selectedCount = selectedList.length;

  return (
    <MobileShell
      i18n={i18n}
      me={s.me}
      companyCode={scopeLabel}
      onLogout={s.logout}
      onRefresh={() => loadList()}
      refreshing={listLoading}
      stickyBar={stickyBar}
      lang={s.lang}
      onLangChange={s.setLang}
      overlayOpen={filterOpen || confirmOpen}
      overlay={
        <>
          <MaintenanceFilterSheet
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            i18n={i18n}
            dateFrom={dateFrom}
            dateTo={dateTo}
            activePreset={activePreset}
            groupMode={s.groupMode}
            selectedGroup={s.selectedGroup}
            companyId={s.companyId}
            companies={s.companies}
            groupIds={s.groupIds}
            allowedGroupIds={s.allowedGroupIds}
            currencies={currencyCodes}
            currency={currency}
            readOnlyNote
            readOnlyNoteText={i18n.bpScopeNote}
            onApply={async (next) => {
              const nextScope = next.scope;
              const scopeChanged =
                nextScope.mode !== scope?.mode ||
                String(nextScope.groupId ?? "") !== String(scope?.groupId ?? "") ||
                Number(nextScope.companyId ?? 0) !== Number(scope?.companyId ?? 0);
              if (scopeChanged) {
                if (nextScope.mode === "group") {
                  setListError(i18n.bpNeedCompany || i18n.bankNeedCompany);
                  setBankReady(false);
                  setRows([]);
                }
                const ok = await s.applyScope(
                  nextScope.mode === "group"
                    ? { mode: "group", groupId: nextScope.groupId }
                    : { mode: "company", companyId: nextScope.companyId },
                );
                if (ok && nextScope.mode === "company") {
                  const row = s.companies.find((c) => Number(c.id) === Number(nextScope.companyId));
                  const code = String(row?.company_id || "").trim();
                  if (code) {
                    const hasBank = await companyHasBankPermission(code);
                    bankCacheRef.current.set(code, hasBank);
                    setBankReady(hasBank);
                    if (!hasBank) {
                      setListError(i18n.bankUnauthorizedCompany);
                      setRows([]);
                    }
                  } else {
                    setBankReady(true);
                  }
                }
              }
              setDateFrom(next.dateFrom);
              setDateTo(next.dateTo);
              setActivePreset(next.activePreset);
              setCurrency(next.currency ?? "");
            }}
          />
          <DeleteConfirm
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            i18n={i18n}
            lang={lang}
            items={selectedList}
            deleting={deleting}
            onConfirm={doDelete}
          />
        </>
      }
    >
      <div className="m-mt-content m-mt-content--pay">
        {s.toast ? (
          <div className={`m-mt-toast${s.toast.tone === "error" ? " is-error" : ""}`}>
            {s.toast.message}
          </div>
        ) : null}
        {listError ? <div className="m-mt-error">{listError}</div> : null}

        {listLoading && rows.length === 0 ? (
          <div className="m-mt-state">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <p>{i18n.loading}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="m-mt-state">
            <i className="fas fa-inbox" aria-hidden="true" />
            <p>{i18n.noData}</p>
          </div>
        ) : (
          <>
            <div className="m-mt-list">
              {visible.map((row, idx) => (
                <BankprocessCard
                  key={bankprocessMaintenanceRowKey(row, idx)}
                  row={row}
                  i18n={i18n}
                  selectable={isBankprocessMaintenanceRowSelectable(row)}
                  selected={selectedIds.has(Number(row.transaction_id))}
                  onToggle={() => toggleRow(row)}
                />
              ))}
            </div>
            {hasMore ? (
              <div ref={sentinelRef} className="m-mt-more">
                <i className="fas fa-spinner fa-spin" aria-hidden="true" />
                <span>
                  {shown} / {total}
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {selectedCount > 0 ? (
        <div className="m-mt-actionbar">
          <span>{getMaintenanceText(lang, "selectedCount", { n: selectedCount })}</span>
          <button type="button" className="m-mt-delete-btn tap-scale" onClick={() => setConfirmOpen(true)}>
            <i className="fas fa-trash" aria-hidden="true" /> {i18n.delete}
          </button>
        </div>
      ) : null}
    </MobileShell>
  );
}

function BankprocessCard({ row, i18n, selectable, selected, onToggle }) {
  const deleted = Number(row.is_deleted) === 1 || row.is_deleted === true || row.is_deleted === "1";

  return (
    <article className={`m-mt-card m-mt-pay-card${deleted ? " is-deleted" : ""}`}>
      <button
        type="button"
        className={`m-mt-check${selected ? " is-on" : ""}${selectable ? "" : " is-disabled"}`}
        onClick={onToggle}
        disabled={!selectable}
        aria-label="select"
      >
        {selected ? <i className="fas fa-check" aria-hidden="true" /> : null}
      </button>
      <div className="m-mt-pay-body">
        <div className="m-mt-card-head">
          <div className="m-mt-card-title">
            <span className="m-mt-type-tag is-slate">
              {row.account && row.account !== "-" ? String(row.account).toUpperCase() : "—"}
            </span>
            {deleted ? <span className="m-mt-del-tag">{i18n.deletedTag}</span> : null}
          </div>
          <span className="m-mt-pay-amount">
            {row.currency && row.currency !== "-" ? `${row.currency} ` : ""}
            {formatMaintenanceAmount(row.amount)}
          </span>
        </div>
        <div className="m-mt-pay-accs">
          <span>
            {i18n.accountFrom}:{" "}
            {row.from_account && row.from_account !== "-" ? row.from_account : "—"}
          </span>
        </div>
        {row.description && row.description !== "-" ? (
          <p className="m-mt-desc">{row.description}</p>
        ) : null}
        {row.remark && row.remark !== "-" ? (
          <p className="m-mt-remark">{String(row.remark).toUpperCase()}</p>
        ) : null}
        <div className="m-mt-card-foot">
          <span>{row.dts_created}</span>
          <span>
            {i18n.submitter} {row.created_by || row.deleter || "—"}
          </span>
        </div>
        {deleted && (row.deleter || row.deleted_by) ? (
          <p className="m-mt-del-info">
            {i18n.deletedBy} {row.deleter || row.deleted_by}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function DeleteConfirm({ open, onClose, i18n, lang, items, deleting, onConfirm }) {
  return (
    <div
      className={`m-sheet-overlay m-sheet-overlay--top${
        open ? " m-sheet-overlay--open" : " m-sheet-overlay--closed"
      }`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className="m-sheet-backdrop m-sheet-backdrop--heavy"
        onClick={deleting ? undefined : onClose}
        aria-label="Close"
      />
      <div
        className={`m-sheet-panel${open ? " m-sheet-panel--open" : " m-sheet-panel--closed"}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="m-sheet-handle-wrap" aria-hidden="true">
          <span className="m-sheet-handle" />
        </div>
        <div className="m-mt-confirm">
          <span className="m-mt-confirm-icon">
            <i className="fas fa-trash" aria-hidden="true" />
          </span>
          <h2>{getMaintenanceText(lang, "bpDeleteConfirmTitle", { n: items.length })}</h2>
          <p className="m-mt-confirm-body">{i18n.bpDeleteConfirmBody}</p>
          <div className="m-mt-confirm-warn">
            <i className="fas fa-triangle-exclamation" aria-hidden="true" /> {i18n.cannotUndo}
          </div>
          <div className="m-mt-confirm-list">
            {items.slice(0, 6).map((r) => (
              <div key={`c-${r.transaction_id}`} className="m-mt-confirm-item">
                <span className="m-mt-type-tag is-slate">{r.account}</span>
                <span className="m-mt-confirm-amt">
                  {r.currency && r.currency !== "-" ? `${r.currency} ` : ""}
                  {formatMaintenanceAmount(r.amount)}
                </span>
                <span className="m-mt-confirm-acc">{r.from_account}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="m-sheet-footer">
          <button
            type="button"
            className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale"
            onClick={onClose}
            disabled={deleting}
          >
            {i18n.cancel}
          </button>
          <button
            type="button"
            className="m-sheet-footer-btn m-mt-confirm-delete tap-scale"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? (
              <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            ) : (
              <>
                <i className="fas fa-trash" aria-hidden="true" /> {i18n.deleteRecords}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
