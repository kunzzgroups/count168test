import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDashboardDateRange, useDashboardDateRangeState } from "./hooks/useDashboardDateRange.js";
import { useDashboardLang } from "./hooks/useDashboardLang.js";
import { useDashboardPage } from "./hooks/useDashboardPage.js";
import { DashboardCalendarPopup } from "./components/DashboardCalendarPopup.jsx";
import { DashboardCompanyAccessModal } from "./components/DashboardCompanyAccessModal.jsx";
import { DashboardEarningsSummary } from "./components/DashboardEarningsSummary.jsx";
import { DashboardFilterPanel } from "./components/DashboardFilterPanel.jsx";
import { DashboardKpiGrid } from "./components/DashboardKpiGrid.jsx";
import { DashboardTrendChart } from "./components/DashboardTrendChart.jsx";
import "../../../public/css/userlist.css";
import "../../../public/css/transaction.css";
import "../../../public/css/report-outlined-fields.css";
import "../../../public/css/date-range-picker.css";

const FILTER_PKG_SS_KEY = "dashboard.filterPaintPackage.v1";

function readStickyPackage() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FILTER_PKG_SS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    const currencies = Array.isArray(p.currencies) ? p.currencies : [];
    const companiesForPicker = Array.isArray(p.companiesForPicker) ? p.companiesForPicker : [];
    const groupIds = Array.isArray(p.groupIds) ? p.groupIds : [];
    if (!currencies.length) return null;
    if (groupIds.length > 0 && !companiesForPicker.length) return null;
    return {
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
  } catch {
    return null;
  }
}

function writeStickyPackage(pkg) {
  if (typeof sessionStorage === "undefined" || !pkg) return;
  try {
    sessionStorage.setItem(FILTER_PKG_SS_KEY, JSON.stringify(pkg));
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

  // Session-sticky full package: filter stays “dead” (complete) across refresh / load races.
  const stickyRef = useRef(readStickyPackage());
  if (
    page.currencies?.length &&
    ((page.companiesForPicker?.length || 0) > 0 || (page.groupIds?.length || 0) === 0)
  ) {
    stickyRef.current = {
      groupIds: page.groupIds?.length ? page.groupIds : stickyRef.current?.groupIds || [],
      companiesForPicker: page.companiesForPicker?.length
        ? page.companiesForPicker
        : stickyRef.current?.companiesForPicker || [],
      currencies: page.currencies,
      currencyCode: page.currencyCode || stickyRef.current?.currencyCode || "",
      selectedGroup: page.selectedGroup,
      groupsAllMode: page.groupsAllMode,
      groupAllMode: page.groupAllMode,
      companyId: page.companyId,
      dateText: effectiveDateRangeText || stickyRef.current?.dateText || "",
    };
    writeStickyPackage(stickyRef.current);
  }

  const sticky = stickyRef.current;
  const packageReady = Boolean(
    sticky?.currencies?.length &&
      ((sticky.companiesForPicker?.length || 0) > 0 || (sticky.groupIds?.length || 0) === 0)
  );

  // One surface for filter + KPI/chart — never show one without the other.
  // Once unlocked, stay unlocked (sticky package keeps filter complete / “dead”).
  const [surfaceReady, setSurfaceReady] = useState(packageReady);
  useLayoutEffect(() => {
    if (surfaceReady) return;
    if (packageReady) setSurfaceReady(true);
  }, [surfaceReady, packageReady, sticky?.currencies, sticky?.companiesForPicker, sticky?.groupIds]);

  useLayoutEffect(() => {
    if (surfaceReady || !page.gcBootstrapReady) return undefined;
    const t = window.setTimeout(() => {
      if (stickyRef.current?.currencies?.length) setSurfaceReady(true);
      else setSurfaceReady(true);
    }, 900);
    return () => window.clearTimeout(t);
  }, [surfaceReady, page.gcBootstrapReady]);

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
          {surfaceReady ? (
            <>
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
            </>
          ) : null}
        </div>
      </div>

      <DashboardCalendarPopup i18n={i18n} periodPresets={periodPresets} dateFrom={dateFrom} />
    </>
  );
}
