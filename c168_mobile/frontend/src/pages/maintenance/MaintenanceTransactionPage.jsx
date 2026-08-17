import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MobileShell from "../../components/layout/MobileShell.jsx";
import MobileSubpageHeader from "../../components/layout/MobileSubpageHeader.jsx";
import { useIncrementalList } from "../../hooks/useIncrementalList.js";
import { useMaintenanceSession } from "../../hooks/useMaintenanceSession.js";
import {
  formatMaintenanceAmount,
  searchTransactionMaintenance,
} from "../../lib/maintenanceApi.js";
import {
  maintenanceScopeIsReady,
  maintenanceScopeKey,
  todayYmd,
  ymdToDmy,
} from "../../lib/mobileMaintenanceScope.js";
import { canAccessTransactionMaintenance } from "../../utils/mobilePermissions.js";
import { MaintenanceFilterBar, MaintenanceFilterSheet, MaintenanceSearchBar } from "./MaintenanceSheets.jsx";
import "./maintenance.css";

const SEARCH_FIELDS = [
  "process",
  "id_product",
  "account",
  "from_account",
  "description",
  "remark",
  "currency",
  "rate",
  "cr",
  "dr",
  "created_by",
  "dts_created",
];

/** Transaction Maintenance is Games-only on mobile (no Category filter). */
const TXN_CATEGORY = "Games";

function matchesQuery(row, q) {
  if (!q) return true;
  return SEARCH_FIELDS.some((f) => String(row?.[f] ?? "").toUpperCase().includes(q));
}

export default function MaintenanceTransactionPage() {
  const s = useMaintenanceSession({ canAccess: canAccessTransactionMaintenance });
  const { i18n, scope } = s;

  const [dateFrom, setDateFrom] = useState(todayYmd);
  const [dateTo, setDateTo] = useState(todayYmd);
  const [activePreset, setActivePreset] = useState("today");
  const [process, setProcess] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const seqRef = useRef(0);
  const scopeReady = maintenanceScopeIsReady(scope);
  const scopeCacheKey = maintenanceScopeKey(scope);

  const loadList = useCallback(
    async (signal) => {
      if (!scopeReady) return;
      const seq = ++seqRef.current;
      setListLoading(true);
      setListError("");
      try {
        const data = await searchTransactionMaintenance({
          scope,
          dateFrom: ymdToDmy(dateFrom),
          dateTo: ymdToDmy(dateTo),
          category: TXN_CATEGORY,
          process,
          signal,
        });
        if (seq !== seqRef.current) return;
        setRows(data);
      } catch (e) {
        if (e?.name === "AbortError" || seq !== seqRef.current) return;
        setListError(e?.message || i18n.loadFailed);
        setRows([]);
      } finally {
        if (seq === seqRef.current) setListLoading(false);
      }
    },
    [scope, scopeReady, dateFrom, dateTo, process, i18n.loadFailed],
  );

  useEffect(() => {
    if (!s.me || !scopeReady) return undefined;
    const ac = new AbortController();
    loadList(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.me, scopeCacheKey, dateFrom, dateTo, process]);

  const displayRows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return rows.filter((r) => matchesQuery(r, q));
  }, [rows, query]);
  const { visible, hasMore, sentinelRef, shown, total } = useIncrementalList(displayRows);

  const scopeLabel = s.groupMode
    ? s.selectedGroup || i18n.group
    : String(s.selectedCompany?.company_id || "").toUpperCase() || i18n.company;

  const stickyBar = (
    <div className="m-mt-sticky">
      <MobileSubpageHeader
        backTo="/maintenance"
        backAriaLabel={i18n.backToHub}
        title={i18n.txMaintenanceTitle}
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
      <MaintenanceSearchBar
        value={query}
        onChange={setQuery}
        placeholder={i18n.searchPlaceholder}
        clearAriaLabel={i18n.reset}
      />
    </div>
  );

  if (s.blocked) return null;

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
      overlayOpen={filterOpen}
      overlay={
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
          withProcess
          process={process}
          readOnlyNote
          onApply={async (next) => {
            const scopeChanged =
              next.scope.mode !== scope?.mode ||
              String(next.scope.groupId ?? "") !== String(scope?.groupId ?? "") ||
              Number(next.scope.companyId ?? 0) !== Number(scope?.companyId ?? 0);
            if (scopeChanged) {
              await s.applyScope(
                next.scope.mode === "group"
                  ? { mode: "group", groupId: next.scope.groupId }
                  : { mode: "company", companyId: next.scope.companyId },
              );
            }
            setDateFrom(next.dateFrom);
            setDateTo(next.dateTo);
            setActivePreset(next.activePreset);
            setProcess(next.process ?? "");
          }}
        />
      }
    >
      <div className="m-mt-content">
        {s.toast ? (
          <div className={`m-mt-toast${s.toast.tone === "error" ? " is-error" : ""}`}>
            {s.toast.message}
          </div>
        ) : null}
        {listError ? <div className="m-mt-error">{listError}</div> : null}

        {listLoading && displayRows.length === 0 ? (
          <div className="m-mt-state">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <p>{i18n.loading}</p>
          </div>
        ) : displayRows.length === 0 ? (
          <div className="m-mt-state">
            <i className="fas fa-inbox" aria-hidden="true" />
            <p>{i18n.noData}</p>
          </div>
        ) : (
          <>
            <div className="m-mt-list">
              {visible.map((row, idx) => (
                <TransactionCard key={`${row.data_type}-${idx}`} row={row} i18n={i18n} />
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
    </MobileShell>
  );
}

function TransactionCard({ row, i18n }) {
  const isCr = row.cr !== null && row.cr !== undefined && row.cr !== "";
  const amount = isCr ? row.cr : row.dr;
  const deleted = Number(row.is_deleted) === 1;
  const title = row.data_type === "datacapture" ? row.id_product || row.process : row.process;

  return (
    <article className={`m-mt-card${deleted ? " is-deleted" : ""}`}>
      <div className="m-mt-card-head">
        <div className="m-mt-card-title">
          <strong>{title && title !== "-" ? title : i18n.process}</strong>
          {deleted ? <span className="m-mt-del-tag">{i18n.deletedTag}</span> : null}
        </div>
        <span className={`m-mt-amount ${isCr ? "is-cr" : "is-dr"}`}>
          {isCr ? "CR" : "DR"} {formatMaintenanceAmount(amount)}
        </span>
      </div>
      <div className="m-mt-card-acc">
        <span>{row.account && row.account !== "-" ? row.account : "—"}</span>
        {row.currency && row.currency !== "-" ? (
          <span className="m-mt-tag">{row.currency}</span>
        ) : null}
        {row.rate ? <span className="m-mt-rate">@{row.rate}</span> : null}
      </div>
      {row.description && row.description !== "-" ? (
        <p className="m-mt-desc">{row.description}</p>
      ) : null}
      {row.remark && row.remark !== "-" ? <p className="m-mt-remark">{row.remark}</p> : null}
      <div className="m-mt-card-foot">
        <span>{row.dts_created}</span>
        <span>
          {i18n.submitter} {row.created_by}
        </span>
      </div>
      {deleted && row.deleted_by ? (
        <p className="m-mt-del-info">
          {i18n.deletedBy} {row.deleted_by}
          {row.dts_deleted ? ` · ${row.dts_deleted}` : ""}
        </p>
      ) : null}
    </article>
  );
}
