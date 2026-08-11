import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { memo, useMemo } from "react";
import {
  buildEarningsPieSlices,
  buildEarningsShareByCode,
  computePieCenterMetrics,
  formatFrankfurterUnitRate,
  getCurrencyColor,
  resolveEarningsRowDisplayAmounts,
} from "../../lib/dashboardEarnings.js";
import { formatCurrency, formatCurrencyHero } from "../../lib/dashboardFormat.js";
import { getCurrencyMeta } from "../../lib/currencyMeta.js";

function resolveRowPrimary(row, currencyCode, rates, useConverted, isCompanyBreakdown) {
  const { primary } = resolveEarningsRowDisplayAmounts(
    row,
    currencyCode,
    rates,
    !isCompanyBreakdown && useConverted,
  );
  return primary;
}

const EarningsPanelCard = memo(function EarningsPanelCard({
  i18n,
  lang,
  currencyCode,
  rows,
  exchangeRates,
  exchangeRatesLoading,
  useConverted,
  loading,
  panelView = "currency",
  isCompanyBreakdown = false,
  note = "",
  tabs = null,
}) {
  const pieUseConverted = !isCompanyBreakdown && useConverted;
  const rates = exchangeRates?.rates || {};

  const displayRows = useMemo(() => {
    return [...(rows || [])].sort((a, b) => {
      const av = Math.abs(Number(a.earningsConverted ?? a.earnings) || 0);
      const bv = Math.abs(Number(b.earningsConverted ?? b.earnings) || 0);
      return bv - av;
    });
  }, [rows]);

  const slices = useMemo(
    () =>
      buildEarningsPieSlices(displayRows, {
        useConverted: pieUseConverted,
        baseCode: isCompanyBreakdown ? "" : currencyCode,
      }),
    [displayRows, pieUseConverted, isCompanyBreakdown, currencyCode],
  );

  const heroTotal = useMemo(() => {
    if (!displayRows.length) return null;
    let sum = 0;
    let any = false;
    for (const row of displayRows) {
      const primary = resolveRowPrimary(row, currencyCode, rates, useConverted, isCompanyBreakdown);
      if (primary == null || !Number.isFinite(Number(primary))) continue;
      sum += Number(primary);
      any = true;
    }
    return any ? sum : null;
  }, [displayRows, currencyCode, rates, useConverted, isCompanyBreakdown]);

  const centerCode = isCompanyBreakdown
    ? displayRows?.[0]?.code || currencyCode
    : currencyCode;
  const shareByCode = buildEarningsShareByCode(displayRows, centerCode, {
    useConverted: pieUseConverted,
  });
  const center = computePieCenterMetrics(displayRows, centerCode, {
    useConverted: pieUseConverted,
  });

  const showPie = !loading && slices.length >= 2;
  const showList = displayRows.length > 1 || (displayRows.length === 1 && showPie);
  const single = !loading && displayRows.length === 1 ? displayRows[0] : null;
  const singleMeta = single && !isCompanyBreakdown ? getCurrencyMeta(String(single.code).toUpperCase(), lang) : null;
  const empty = !loading && !displayRows.length;

  const eyebrow =
    panelView === "earning"
      ? i18n.panelEyebrowEarning || i18n.earnings
      : panelView === "netProfitFor"
        ? i18n.panelEyebrowCompany || i18n.netProfit
        : i18n.panelEyebrowCurrency || i18n.currencyDistribution;

  const heroTone =
    heroTotal == null ? "" : Number(heroTotal) < 0 ? " is-neg" : Number(heroTotal) > 0 ? " is-pos" : "";

  return (
    <section className={`m-dash-earn-panel${tabs ? " m-dash-earn-panel--tabs" : ""}`}>
      {tabs}

      <div className="m-dash-earn-hero">
        <p className="m-dash-earn-eyebrow">{eyebrow}</p>
        {loading ? (
          <div className="m-dash-earn-amount-skel" aria-hidden="true" />
        ) : empty ? (
          <p className="m-dash-earn-empty">{i18n.noData}</p>
        ) : (
          <>
            <p className={`m-dash-earn-amount${heroTone}`}>
              {heroTotal == null ? "—" : formatCurrencyHero(heroTotal)}
            </p>
            <p className="m-dash-earn-meta">
              {isCompanyBreakdown ? (
                <>
                  <span>{displayRows.length}</span>
                  <span className="m-dash-earn-meta-sep" aria-hidden="true">
                    ·
                  </span>
                  <span>{i18n.companies || i18n.company}</span>
                </>
              ) : single ? (
                <>
                  {singleMeta?.flag ? (
                    <span className="m-dash-earn-flag" aria-hidden="true">
                      {singleMeta.flag}
                    </span>
                  ) : null}
                  <span>{String(single.code).toUpperCase()}</span>
                  {singleMeta?.name ? (
                    <>
                      <span className="m-dash-earn-meta-sep" aria-hidden="true">
                        ·
                      </span>
                      <span>{singleMeta.name}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <span>{String(currencyCode || "").toUpperCase()}</span>
                  <span className="m-dash-earn-meta-sep" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    {displayRows.length} {i18n.currency}
                  </span>
                </>
              )}
            </p>
          </>
        )}
      </div>

      {showPie ? (
        <div className="m-dash-earn-pie-block">
          <div className="m-dash-pie-wrap m-dash-earn-pie-wrap">
            <div className="m-dash-pie-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                  <Pie
                    key={panelView}
                    data={slices}
                    dataKey="value"
                    nameKey="code"
                    cx="50%"
                    cy="50%"
                    innerRadius="66%"
                    outerRadius="88%"
                    paddingAngle={slices.length > 3 ? 2 : 3}
                    stroke="#fff"
                    strokeWidth={2}
                    isAnimationActive
                    label={false}
                  >
                    {slices.map((entry, index) => (
                      <Cell key={entry.code || index} fill={entry.fill} stroke="#fff" strokeWidth={2} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="m-dash-pie-center" aria-hidden="true">
                <span className="m-dash-pie-center-pct">{Number(center.pct).toFixed(1)}%</span>
                <span className="m-dash-pie-center-code">{center.code}</span>
              </div>
            </div>
            <ul className="m-dash-pie-legend">
              {slices.slice(0, 5).map((item, index) => {
                const code = String(item.code).toUpperCase();
                const pct = shareByCode[code] ?? 0;
                return (
                  <li key={code} className="m-dash-pie-legend-item">
                    <span
                      className="m-dash-pie-legend-dot"
                      style={{ backgroundColor: item.fill || getCurrencyColor(code, index) }}
                      aria-hidden="true"
                    />
                    <span className="m-dash-pie-legend-code">{code}</span>
                    <span className="m-dash-pie-legend-pct">{pct.toFixed(1)}%</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      {showList ? (
        <ul className="m-dash-earn-rows">
          {displayRows.map((row, index) => {
            const code = String(row.code).toUpperCase();
            const meta = isCompanyBreakdown ? null : getCurrencyMeta(code, lang);
            const color = getCurrencyColor(code, index);
            const primary = resolveRowPrimary(row, currencyCode, rates, useConverted, isCompanyBreakdown);
            const amount = loading ? "…" : primary != null ? formatCurrency(primary) : formatCurrency(0);
            const negative = Number(primary) < 0;
            const pct = shareByCode[code] ?? 0;
            const showRate = !isCompanyBreakdown && useConverted && String(code) !== String(currencyCode).toUpperCase();
            const rateLabel = showRate ? formatFrankfurterUnitRate(code, currencyCode, rates) : "";
            const subtitle = isCompanyBreakdown
              ? row.group
                ? `${i18n.groupIdShort || "Group"} ${row.group}`
                : i18n.company
              : meta?.name;

            return (
              <li key={`${code}-${row.group || index}`} className="m-dash-earn-row">
                {isCompanyBreakdown ? (
                  <span className="m-dash-earn-avatar" style={{ backgroundColor: color }} aria-hidden="true">
                    {code.slice(0, 2)}
                  </span>
                ) : (
                  <span className="m-dash-earn-avatar m-dash-earn-avatar--flag" aria-hidden="true">
                    {meta?.flag || code.slice(0, 2)}
                  </span>
                )}
                <div className="m-dash-earn-row-main">
                  <div className="m-dash-earn-row-top">
                    <p className="m-dash-earn-row-code">{code}</p>
                    <p className={`m-dash-earn-row-amount${negative ? " is-neg" : ""}`}>{amount}</p>
                  </div>
                  <div className="m-dash-earn-row-sub">
                    <span>{subtitle}</span>
                    {showRate ? (
                      <span>
                        {i18n.rate} {exchangeRatesLoading ? "…" : rateLabel}
                      </span>
                    ) : showPie ? (
                      <span>{pct.toFixed(1)}%</span>
                    ) : null}
                  </div>
                  {showPie ? (
                    <div className="m-dash-earn-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }} />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {note && !empty ? <p className="m-dash-earn-note">{note}</p> : null}
    </section>
  );
});

export default EarningsPanelCard;
