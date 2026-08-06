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

  // While a new scope is loading, show 0.00 instead of the outgoing scope's real
  // numbers — keep `showEarnings` as-is so the card count doesn't flicker 3↔4.
  const kpiForDisplay = page.scopeDataPending
    ? {
        profit: 0,
        expenses: 0,
        earnings: 0,
        netProfit: 0,
        showEarnings: page.kpi.showEarnings,
        comparisons: null,
      }
    : page.kpi;

  // Same readiness the KPI cards reveal on — pins the Currency card to always
  // appear after KPI/chart instead of racing them on however fast its own
  // (independent) earnings-by-currency fetch happens to resolve.
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
            /* Live selection highlight — do not freeze pills while KPI/chart/pie catch up. */
            effectiveDateRangeText={effectiveDateRangeText}
            groupIds={page.groupIds}
            selectedGroup={page.selectedGroup}
            groupsAllMode={page.groupsAllMode}
            groupAllMode={page.groupAllMode}
            companiesForPicker={page.companiesForPicker}
            companyId={page.companyId}
            mergedSubsetIds={page.mergedSubsetIds}
            currencies={page.currencies}
            currencyCode={page.currencyCode}
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
            {/* No skeleton — KPI/chart/currency stay mounted and self-represent their own
                loading state (0.00 defaults, chart placeholder, currency shimmer) instead of
                being hidden behind a full-surface placeholder. */}
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
                  earningsByCurrencyLoading={page.earningsByCurrencyLoading || page.scopeDataPending}
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
