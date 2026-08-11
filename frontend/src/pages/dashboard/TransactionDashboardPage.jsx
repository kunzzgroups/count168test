import { useMemo, useRef } from "react";
import { useDashboardDateRange, useDashboardDateRangeState } from "./hooks/useDashboardDateRange.js";
import { useDashboardLang } from "./hooks/useDashboardLang.js";
import { useDashboardPage } from "./hooks/useDashboardPage.js";
import { DashboardCalendarPopup } from "./components/DashboardCalendarPopup.jsx";
import { DashboardCompanyAccessModal } from "./components/DashboardCompanyAccessModal.jsx";
import { DashboardEarningsSummary } from "./components/DashboardEarningsSummary.jsx";
import { DashboardFilterPanel } from "./components/DashboardFilterPanel.jsx";
import { DashboardKpiGrid } from "./components/DashboardKpiGrid.jsx";
import { DashboardTrendChart } from "./components/DashboardTrendChart.jsx";
import {
  DASHBOARD_FILTER_PAINT_PACKAGE_KEY,
  DASHBOARD_LOGIN_FILTER_APPLIED_KEY,
} from "../../utils/company/sharedCompanyFilter.js";
import "../../../public/css/userlist.css";
import "../../../public/css/transaction.css";
import "../../../public/css/report-outlined-fields.css";
import "../../../public/css/date-range-picker.css";

/** Current login fingerprint used to scope the filter paint sticky (never cross-account). */
function currentStickyOwnerKey() {
  if (typeof sessionStorage === "undefined") return "";
  return String(sessionStorage.getItem(DASHBOARD_LOGIN_FILTER_APPLIED_KEY) || "").trim();
}

/** Complete filter package = currencies + (companies or genuinely no groups). */
function isFilterPackageComplete(pkg) {
  if (!pkg?.currencies?.length) return false;
  return (pkg.companiesForPicker?.length || 0) > 0 || (pkg.groupIds?.length || 0) === 0;
}

function readStickyPackage() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DASHBOARD_FILTER_PAINT_PACKAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    const ownerKey = typeof p.ownerKey === "string" ? p.ownerKey.trim() : "";
    const currentOwner = currentStickyOwnerKey();
    // Hard reject only when both sides are known and differ (cross-login leakage).
    // If currentOwner is empty mid-bootstrap, still restore same-tab package so
    // Admin↔Home does not white-out while login filter key is re-applied.
    if (ownerKey && currentOwner && ownerKey !== currentOwner) return null;
    // Legacy packages without ownerKey cannot be trusted once a current owner exists.
    if (currentOwner && !ownerKey) return null;
    const currencies = Array.isArray(p.currencies) ? p.currencies : [];
    const companiesForPicker = Array.isArray(p.companiesForPicker) ? p.companiesForPicker : [];
    const groupIds = Array.isArray(p.groupIds) ? p.groupIds : [];
    const pkg = {
      ownerKey,
      groupIds,
      companiesForPicker,
      currencies,
      currencyCode: typeof p.currencyCode === "string" ? p.currencyCode : "",
      selectedGroup: p.selectedGroup ?? null,
      groupsAllMode: Boolean(p.groupsAllMode),
      groupAllMode: Boolean(p.groupAllMode),
      companyId: p.companyId ?? null,
      dateText: typeof p.dateText === "string" ? p.dateText : "",
    };
    if (!isFilterPackageComplete(pkg)) return null;
    return pkg;
  } catch {
    return null;
  }
}

function writeStickyPackage(pkg) {
  if (typeof sessionStorage === "undefined" || !pkg) return;
  if (!isFilterPackageComplete(pkg)) return;
  try {
    sessionStorage.setItem(DASHBOARD_FILTER_PAINT_PACKAGE_KEY, JSON.stringify(pkg));
  } catch {
    /* quota */
  }
}

export default function TransactionDashboardPage() {
  const { i18n } = useDashboardLang();
  const { dateFrom, setDateFrom, dateTo, setDateTo } = useDashboardDateRangeState();

  const page = useDashboardPage({ i18n, dateFrom, dateTo, setDateFrom, setDateTo });
  const { effectiveDateRangeText, periodPresets } = useDashboardDateRange({
    me: page.me,
    i18n,
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
  });

  // Session-sticky full package: keep filter chrome filled across Admin↔Home remount.
  // Cross-login safety: ownerKey mismatch reject + clearDashboardFilterSession on logout.
  // Intentionally no surfaceReady gate — blanking the main column is worse than a brief
  // frozen/partial filter (freezeFilter + sticky) while KPI reloads.
  const stickyRef = useRef(readStickyPackage());
  const ownerKey = currentStickyOwnerKey();
  if (stickyRef.current?.ownerKey && ownerKey && stickyRef.current.ownerKey !== ownerKey) {
    stickyRef.current = null;
  }

  if (page.currencies?.length) {
    const sameOwner =
      !ownerKey ||
      !stickyRef.current?.ownerKey ||
      stickyRef.current.ownerKey === ownerKey;
    const prev = sameOwner ? stickyRef.current : null;
    const next = {
      ownerKey: ownerKey || prev?.ownerKey || "",
      groupIds: page.groupIds?.length ? page.groupIds : prev?.groupIds || page.groupIds || [],
      companiesForPicker: page.companiesForPicker?.length
        ? page.companiesForPicker
        : prev?.companiesForPicker || page.companiesForPicker || [],
      currencies: page.currencies,
      currencyCode: page.currencyCode || prev?.currencyCode || "",
      selectedGroup: page.selectedGroup,
      groupsAllMode: page.groupsAllMode,
      groupAllMode: page.groupAllMode,
      companyId: page.companyId,
      dateText: effectiveDateRangeText || prev?.dateText || "",
    };
    if (isFilterPackageComplete(next)) {
      stickyRef.current = next;
      writeStickyPackage(stickyRef.current);
    }
  }

  const sticky = stickyRef.current;

  // Freeze filter chrome while KPI/chart catch up — selection + pills stay put (dead board).
  const freezeFilter = page.loading || page.scopeDataPending;
  const painted = sticky || {
    groupIds: [],
    companiesForPicker: [],
    currencies: [],
    currencyCode: "",
    selectedGroup: null,
    groupsAllMode: false,
    groupAllMode: false,
    companyId: null,
    dateText: effectiveDateRangeText,
  };

  const filterDateText =
    freezeFilter && painted.dateText ? painted.dateText : effectiveDateRangeText || painted.dateText;
  const filterGroupIds = painted.groupIds?.length ? painted.groupIds : page.groupIds || [];
  const filterCompanies = painted.companiesForPicker?.length
    ? painted.companiesForPicker
    : page.companiesForPicker || [];
  const filterCurrencies = painted.currencies?.length ? painted.currencies : page.currencies || [];
  const filterCurrencyCode =
    (freezeFilter ? painted.currencyCode : page.currencyCode) || painted.currencyCode || "";
  const filterSelectedGroup = freezeFilter ? painted.selectedGroup : page.selectedGroup;
  const filterGroupsAll = freezeFilter ? painted.groupsAllMode : page.groupsAllMode;
  const filterGroupAll = freezeFilter ? painted.groupAllMode : page.groupAllMode;
  const filterCompanyId = freezeFilter ? painted.companyId : page.companyId;

  const kpiForDisplay = useMemo(
    () =>
      page.scopeDataPending
        ? {
            profit: 0,
            expenses: 0,
            earnings: 0,
            netProfit: 0,
            showEarnings: page.kpi.showEarnings,
            comparisons: null,
          }
        : page.kpi,
    [page.scopeDataPending, page.kpi]
  );

  const kpiChartReady = !(page.loading || page.scopeDataPending);

  return (
    <>
      <div className="dashboard-container">
        <DashboardCompanyAccessModal
          open={page.companyAccessModal.open}
          message={page.companyAccessModal.message}
          onClose={page.closeCompanyAccessModal}
        />

        {page.loadError && (
          <div className="dashboard-card" style={{ marginBottom: 12, color: "#b91c1c" }}>
            {page.loadError}
          </div>
        )}

        <div id="app" className="dashboard-content">
          <DashboardFilterPanel
            i18n={i18n}
            effectiveDateRangeText={filterDateText}
            groupIds={filterGroupIds}
            selectedGroup={filterSelectedGroup}
            groupsAllMode={filterGroupsAll}
            groupAllMode={filterGroupAll}
            companiesForPicker={filterCompanies}
            companyId={filterCompanyId}
            mergedSubsetIds={freezeFilter ? null : page.mergedSubsetIds}
            currencies={filterCurrencies}
            currencyCode={filterCurrencyCode}
            onPickGroup={page.handlePickGroup}
            onPickAllGroups={page.handlePickAllGroups}
            onPickCompany={page.handlePickCompany}
            onPickAllInGroup={page.handlePickAllInGroup}
            onCurrencyChange={page.handleCurrencyChange}
            onCurrencyDropOn={page.handleCurrencyDropOn}
          />

          <div
            className="dashboard-data-surface"
            aria-busy={page.scopeDataPending ? "true" : undefined}
          >
            <div className="dashboard-data-surface__live">
              <DashboardKpiGrid
                i18n={i18n}
                kpi={kpiForDisplay}
                kpiCompareLabel={page.kpiCompareLabel}
                kpiFooter={page.kpiFooter}
                loading={page.loading || page.scopeDataPending}
              />

              <div
                className={`dashboard-panels-row${
                  page.showSummaryPanelTabs ? " dashboard-panels-row--with-summary-tabs" : ""
                }`}
              >
                <DashboardTrendChart
                  i18n={i18n}
                  chartRows={page.scopeDataPending ? [] : page.chartRows}
                  chartSeries={page.chartSeries}
                  chartVisible={page.chartVisible}
                  onToggleSeries={page.toggleChartSeries}
                  chartDateRangeText={page.chartDateRangeText}
                  chartXAxisLayout={page.chartXAxisLayout}
                  chartScopeKey={page.displayScopeKey || page.dashboardScopeKey}
                />
                <DashboardEarningsSummary
                  i18n={i18n}
                  currencyCode={page.displayFilterCurrencyCode ?? page.currencyCode}
                  currencies={page.displayCurrencies ?? page.currencies}
                  panelCurrencyRows={page.panelCurrencyRows}
                  useConvertedEarnings={page.useConvertedEarnings}
                  earningsBreakdownShowsRate={page.earningsBreakdownShowsRate}
                  summaryPanelLabel={page.summaryPanelLabel}
                  summaryEarningsValue={page.summaryEarningsValue}
                  summaryConversionNote={page.summaryConversionNote}
                  summaryEarningsLoading={page.summaryEarningsLoading || page.scopeDataPending}
                  earningsPanelStable={page.earningsPanelStable}
                  earningsByCurrencyLoading={
                    page.earningsByCurrencyLoading || page.scopeDataPending
                  }
                  exchangeRates={page.exchangeRates}
                  exchangeRatesLoading={page.exchangeRatesLoading}
                  exchangeRateScopeKey={page.exchangeRateScopeKey}
                  showSummaryPanelTabs={page.showSummaryPanelTabs}
                  showEarningPanelTab={page.showEarningPanelTab}
                  showNetProfitForTab={page.showNetProfitForTab}
                  earningsPanelView={page.earningsPanelView}
                  onEarningsPanelViewChange={page.setEarningsPanelView}
                  kpiChartReady={kpiChartReady}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <DashboardCalendarPopup i18n={i18n} periodPresets={periodPresets} dateFrom={dateFrom} />
    </>
  );
}
