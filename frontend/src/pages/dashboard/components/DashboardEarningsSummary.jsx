import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatFrankfurterUnitRate } from "../../../utils/dashboard/frankfurterRates.js";
import {
  buildEarningsPieSlices,
  buildEarningsShareByCode,
  computeCurrencySharePct,
  computePieCenterMetrics,
  computeSectorTooltipPosition,
  getCurrencyColor,
  resolveEarningsPiePaddingAngle,
  resolveEarningsRowDisplayAmounts,
} from "../lib/dashboardEarnings.js";
import { DASHBOARD_EARNINGS_PIE_MIN_ANGLE } from "../lib/dashboardConstants.js";
import { formatCurrency, formatI18nTemplate } from "../lib/dashboardFormat.js";
import { EarningsPieSectorTooltip } from "./EarningsPieSectorTooltip.jsx";

export function DashboardEarningsSummary({
  i18n,
  currencyCode,
  currencies,
  panelCurrencyRows,
  useConvertedEarnings,
  earningsBreakdownShowsRate = false,
  summaryPanelLabel,
  summaryEarningsValue,
  summaryConversionNote,
  summaryEarningsLoading,
  earningsPanelStable = true,
  earningsByCurrencyLoading,
  exchangeRates,
  exchangeRatesLoading,
  exchangeRateScopeKey = "",
  showSummaryPanelTabs = false,
  showEarningPanelTab = false,
  showNetProfitForTab = false,
  earningsPanelView = "currency",
  onEarningsPanelViewChange,
}) {
  const pieAreaRef = useRef(null);
  const pieShellRef = useRef(null);
  const [pieShellLayout, setPieShellLayout] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [hoveredPieSector, setHoveredPieSector] = useState(null);
  const isCompanyBreakdownView = earningsPanelView === "netProfitFor";
  // Company rows use company_id as `code` — never apply FX base filtering / conversion.
  const pieUseConverted = !isCompanyBreakdownView && useConvertedEarnings;
  const pieBaseCode = isCompanyBreakdownView ? "" : currencyCode;

  const earningsPieSlices = useMemo(() => {
    return buildEarningsPieSlices(panelCurrencyRows, {
      useConverted: pieUseConverted,
      baseCode: pieBaseCode,
    });
  }, [panelCurrencyRows, pieUseConverted, pieBaseCode]);

  const earningsShareByCode = useMemo(() => {
    return buildEarningsShareByCode(panelCurrencyRows, pieBaseCode, {
      useConverted: pieUseConverted,
    });
  }, [panelCurrencyRows, pieBaseCode, pieUseConverted]);

  const pieCenterMetrics = useMemo(() => {
    const centerCode = isCompanyBreakdownView
      ? panelCurrencyRows?.[0]?.code || currencyCode
      : currencyCode;
    return computePieCenterMetrics(panelCurrencyRows, centerCode, {
      useConverted: pieUseConverted,
    });
  }, [panelCurrencyRows, currencyCode, pieUseConverted, isCompanyBreakdownView]);

  const currencyPieFillByCode = useMemo(() => {
    const map = {};
    panelCurrencyRows.forEach((row, index) => {
      map[row.code] = getCurrencyColor(row.code, index);
    });
    return map;
  }, [panelCurrencyRows]);

  const piePaddingAngle = useMemo(
    () => resolveEarningsPiePaddingAngle(earningsPieSlices.length),
    [earningsPieSlices.length]
  );

  const summaryPieReady =
    earningsPanelStable && earningsPieSlices.length > 0 && !summaryEarningsLoading;

  const pieCenterPct =
    pieCenterMetrics.pct == null || pieCenterMetrics.pct === ""
      ? null
      : Number(pieCenterMetrics.pct);
  useEffect(() => {
    setHoveredPieSector(null);
  }, [currencyCode, earningsPanelView]);

  const isRowAmountLoading = useCallback(
    (code) => {
      if (currencies.length <= 1) return summaryEarningsLoading;
      const row = panelCurrencyRows.find((r) => r.code === code);
      return row?.earnings == null;
    },
    [currencies.length, panelCurrencyRows, summaryEarningsLoading]
  );

  const isRowRateLoading = useCallback(() => {
    if (currencies.length <= 1) return false;
    return (
      exchangeRatesLoading ||
      (exchangeRateScopeKey && exchangeRates.scopeKey !== exchangeRateScopeKey)
    );
  }, [currencies.length, exchangeRatesLoading, exchangeRates.scopeKey, exchangeRateScopeKey]);

  useLayoutEffect(() => {
    const wrap = pieAreaRef.current;
    const shell = pieShellRef.current;
    if (!wrap || !shell) return undefined;

    const syncLayout = () => {
      setPieShellLayout({
        left: shell.offsetLeft,
        top: shell.offsetTop,
        width: shell.clientWidth,
        height: shell.clientHeight,
      });
    };

    syncLayout();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncLayout) : null;
    observer?.observe(wrap);
    observer?.observe(shell);
    window.addEventListener("resize", syncLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncLayout);
    };
  }, [summaryPieReady, currencyCode]);

  const handlePieSectorEnter = useCallback(
    (sectorData, index) => {
      const slice = earningsPieSlices[index];
      if (!slice || sectorData?.midAngle == null) return;
      setHoveredPieSector({
        slice,
        cx: sectorData.cx,
        cy: sectorData.cy,
        innerRadius: sectorData.innerRadius,
        outerRadius: sectorData.outerRadius,
        midAngle: sectorData.midAngle,
      });
    },
    [earningsPieSlices]
  );

  const hoveredPieTooltip = useMemo(() => {
    if (!hoveredPieSector || pieShellLayout.width <= 0) return null;
    const pos = computeSectorTooltipPosition(
      hoveredPieSector,
      pieShellLayout.width,
      pieShellLayout.height
    );
    if (!pos) return null;
    const slice = hoveredPieSector.slice;
    const row = panelCurrencyRows.find(
      (r) => String(r.code).toUpperCase() === String(slice?.code || "").toUpperCase()
    );
    const amounts = row
      ? resolveEarningsRowDisplayAmounts(
          row,
          currencyCode,
          exchangeRates.rates,
          pieUseConverted
        )
      : { primary: slice?.earnings ?? null, native: slice?.originalEarnings ?? null };
    const sharePct = row ? computeCurrencySharePct(row, earningsShareByCode) : null;
    const unitRateLabel = isCompanyBreakdownView
      ? null
      : formatFrankfurterUnitRate(slice?.code, currencyCode, exchangeRates.rates);
    return {
      slice,
      displayAmount: amounts.primary,
      nativeAmount: amounts.native,
      sharePct,
      unitRateLabel,
      left: pos.left + pieShellLayout.left,
      top: pos.top + pieShellLayout.top,
      placeAbove: pos.placeAbove,
      radial: pos.radial,
    };
  }, [
    hoveredPieSector,
    panelCurrencyRows,
    earningsShareByCode,
    pieUseConverted,
    isCompanyBreakdownView,
    currencyCode,
    exchangeRates.rates,
    pieShellLayout,
  ]);

  const showMultiCurrencyBreakdown = currencies.length > 1;
  const isStackedLayout = true;
  const isCompactTable = !showMultiCurrencyBreakdown;

  const summaryHero = (
    <div className="dashboard-summary-hero dashboard-summary-hero--compact">
      <span className="dashboard-summary-hero-caption">
        {summaryPanelLabel}
        {currencyCode ? ` · ${currencyCode}` : ""}
      </span>
      <div className="dashboard-summary-hero-value">
        <span className="dashboard-animated-value dashboard-summary-hero-value-anim">
          {formatCurrency(parseFloat(summaryEarningsValue) || 0)}
        </span>
      </div>
      {summaryConversionNote && (
        <span className="dashboard-summary-hero-conversion-note">{summaryConversionNote}</span>
      )}
    </div>
  );

  const summaryViewTabs = showSummaryPanelTabs ? (
    <div className="dashboard-summary-view-tabs" role="tablist" aria-label={i18n.statistics}>
      <button
        type="button"
        role="tab"
        aria-selected={earningsPanelView === "currency"}
        className={`dashboard-summary-view-tab${
          earningsPanelView === "currency" ? " is-active" : ""
        }`}
        onClick={() => onEarningsPanelViewChange?.("currency")}
      >
        {i18n.earningsChartTab}
      </button>
      {showNetProfitForTab && (
        <button
          type="button"
          role="tab"
          aria-selected={earningsPanelView === "netProfitFor"}
          className={`dashboard-summary-view-tab${
            earningsPanelView === "netProfitFor" ? " is-active" : ""
          }`}
          onClick={() => onEarningsPanelViewChange?.("netProfitFor")}
        >
          {i18n.netProfitChartTab}
        </button>
      )}
      {showEarningPanelTab && (
        <button
          type="button"
          role="tab"
          aria-selected={earningsPanelView === "earning"}
          className={`dashboard-summary-view-tab${
            earningsPanelView === "earning" ? " is-active" : ""
          }`}
          onClick={() => onEarningsPanelViewChange?.("earning")}
        >
          {i18n.earningChartTab}
        </button>
      )}
    </div>
  ) : null;

  return (
    <div
      className={`dashboard-panel-card dashboard-panel-card--summary${
        showSummaryPanelTabs ? " dashboard-panel-card--summary-has-tabs" : ""
      }${showEarningPanelTab ? " dashboard-panel-card--summary-has-earning-tab" : ""}${
        isStackedLayout ? " dashboard-panel-card--summary-compact" : ""
      }`}
    >
      <div
        className={`dashboard-summary-layout${
          isStackedLayout ? " is-compact-breakdown" : ""
        }${showMultiCurrencyBreakdown ? " is-multi-currency-layout" : ""}`}
      >
        <div className="dashboard-summary-top-row">
          {summaryViewTabs}
          {summaryHero}
          <div
            ref={pieAreaRef}
            className="dashboard-summary-pie-wrap"
            aria-hidden={!earningsPanelStable && !earningsPieSlices.length}
            onMouseLeave={() => setHoveredPieSector(null)}
          >
            <div ref={pieShellRef} className="dashboard-summary-pie-chart-shell">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                  <Pie
                    key={exchangeRateScopeKey || "pie"}
                    data={
                      earningsPieSlices.length
                        ? earningsPieSlices
                        : [{ code: "—", earnings: 0, value: 1, fill: "#e0e7ff" }]
                    }
                    dataKey="value"
                    nameKey="code"
                    cx="50%"
                    cy="50%"
                    innerRadius="62%"
                    outerRadius="84%"
                    paddingAngle={piePaddingAngle}
                    minAngle={DASHBOARD_EARNINGS_PIE_MIN_ANGLE}
                    stroke="#fff"
                    strokeWidth={2}
                    label={false}
                    activeShape={false}
                    isAnimationActive={false}
                    onMouseEnter={handlePieSectorEnter}
                    onMouseLeave={() => setHoveredPieSector(null)}
                  >
                    {(earningsPieSlices.length ? earningsPieSlices : [{ fill: "#e0e7ff" }]).map(
                      (entry, index) => (
                        <Cell key={entry.code || index} fill={entry.fill} stroke="#fff" strokeWidth={2} />
                      )
                    )}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {!summaryEarningsLoading &&
                earningsPanelStable &&
                earningsPieSlices.length > 0 &&
                !hoveredPieTooltip && (
                <div className="dashboard-summary-pie-center" aria-hidden="true">
                  <span className="dashboard-summary-pie-center-pct">
                    {pieCenterPct != null && Number.isFinite(pieCenterPct)
                      ? `${pieCenterPct.toFixed(1)}%`
                      : "—"}
                  </span>
                  <span className="dashboard-summary-pie-center-code">{pieCenterMetrics.code}</span>
                  <span className="dashboard-summary-pie-center-caption">{i18n.shareOfTotal}</span>
                </div>
              )}
            </div>
            {hoveredPieTooltip && (
              <div
                className={`dashboard-summary-pie-tooltip-anchor${
                  hoveredPieTooltip.radial ? " is-radial" : hoveredPieTooltip.placeAbove ? "" : " is-below"
                }`}
                style={{
                  left: hoveredPieTooltip.left,
                  top: hoveredPieTooltip.top,
                }}
              >
                <EarningsPieSectorTooltip
                  slice={hoveredPieTooltip.slice}
                  displayAmount={hoveredPieTooltip.displayAmount}
                  nativeAmount={hoveredPieTooltip.nativeAmount}
                  sharePct={hoveredPieTooltip.sharePct}
                  unitRateLabel={hoveredPieTooltip.unitRateLabel}
                  baseCode={currencyCode}
                  rateOneUnitTemplate={i18n.rateOneUnit}
                  nativeAmountTemplate={i18n.nativeAmountIn}
                  placeAbove={hoveredPieTooltip.placeAbove}
                />
              </div>
            )}
          </div>
        </div>
        <div
          className={`dashboard-summary-currency-list${
            showMultiCurrencyBreakdown ? " is-multi-currency" : ""
          }${isCompactTable ? " is-compact-breakdown" : ""}${
            earningsBreakdownShowsRate ? " is-with-original" : ""
          }`}
          aria-label={i18n.currencyBreakdown}
        >
          <div className="dashboard-summary-currency-list-head" aria-hidden="true">
            <span>{isCompanyBreakdownView ? i18n.breakdownCompany : i18n.breakdownCurrency}</span>
            <span>
              {showMultiCurrencyBreakdown && currencyCode
                ? `${i18n.breakdownAmount} (${currencyCode})`
                : i18n.breakdownAmount}
            </span>
            {(earningsBreakdownShowsRate || isCompanyBreakdownView) && (
              <span>{isCompanyBreakdownView ? i18n.breakdownGroup : i18n.breakdownOriginalAmount}</span>
            )}
            {!isCompanyBreakdownView && (
              <span>{earningsBreakdownShowsRate ? i18n.breakdownRate : i18n.breakdownShare}</span>
            )}
          </div>
          <div className="dashboard-summary-currency-list-body" role="list">
            {panelCurrencyRows.map((row, index) => {
              const rowAmountLoading = isRowAmountLoading(row.code);
              const rowRateLoading = isRowRateLoading();
              const sharePct = computeCurrencySharePct(row, earningsShareByCode);
              const { primary, native } = resolveEarningsRowDisplayAmounts(
                row,
                currencyCode,
                exchangeRates.rates,
                pieUseConverted
              );
              const unitRateLabel = earningsBreakdownShowsRate
                ? formatFrankfurterUnitRate(row.code, currencyCode, exchangeRates.rates)
                : null;
              const unitRateTitle =
                unitRateLabel && unitRateLabel !== "—"
                  ? formatI18nTemplate(i18n.rateOneUnit, {
                      from: row.code,
                      rate: unitRateLabel,
                      base: currencyCode,
                    })
                  : undefined;
              const showOriginalAmount =
                !isCompanyBreakdownView &&
                earningsBreakdownShowsRate &&
                useConvertedEarnings &&
                String(row.code).toUpperCase() !== String(currencyCode).toUpperCase();
              return (
                <div
                  key={row.code}
                  role="listitem"
                  className={`dashboard-summary-currency-row${row.code === currencyCode ? " is-active" : ""}`}
                  style={
                    row.code === currencyCode
                      ? {
                          "--currency-accent":
                            currencyPieFillByCode[row.code] || getCurrencyColor(row.code, index),
                        }
                      : undefined
                  }
                >
                  <div className="dashboard-summary-currency-label">
                    <span
                      className="dashboard-summary-currency-dot"
                      style={{
                        backgroundColor: currencyPieFillByCode[row.code] || getCurrencyColor(row.code, index),
                      }}
                      aria-hidden="true"
                    />
                    <span className="dashboard-summary-currency-code">{row.code}</span>
                  </div>
                  <div className="dashboard-summary-currency-amount-col">
                    <span className="dashboard-summary-currency-amount">
                      {rowAmountLoading
                        ? "…"
                        : primary != null
                          ? formatCurrency(primary)
                          : "—"}
                    </span>
                  </div>
                  {(earningsBreakdownShowsRate || isCompanyBreakdownView) && (
                    <div className="dashboard-summary-currency-original-col">
                      <span className="dashboard-summary-currency-original">
                        {isCompanyBreakdownView
                          ? row.group || "—"
                          : rowAmountLoading
                            ? "…"
                            : showOriginalAmount && native != null
                              ? formatCurrency(native)
                              : "—"}
                      </span>
                    </div>
                  )}
                  {!isCompanyBreakdownView && (
                    <span className="dashboard-summary-currency-rate" title={unitRateTitle}>
                      {rowRateLoading
                        ? "…"
                        : earningsBreakdownShowsRate
                          ? unitRateLabel && unitRateLabel !== "—"
                            ? unitRateLabel
                            : "—"
                          : sharePct != null
                            ? `${Number(sharePct).toFixed(1)}%`
                            : "—"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
