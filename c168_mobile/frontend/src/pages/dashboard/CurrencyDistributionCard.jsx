import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { memo } from "react";
import {
  buildEarningsPieSlices,
  buildEarningsShareByCode,
  computePieCenterMetrics,
  getCurrencyColor,
} from "../../lib/dashboardEarnings.js";

const CurrencyDistributionCard = memo(function CurrencyDistributionCard({
  i18n,
  currencyCode,
  rows,
  useConverted,
  loading,
  note = "",
  title,
  badgeLabel,
  isCompanyBreakdown = false,
  tabs = null,
  footer = null,
}) {
  const pieUseConverted = !isCompanyBreakdown && useConverted;
  const pieBaseCode = isCompanyBreakdown ? "" : currencyCode;
  const slices = buildEarningsPieSlices(rows, {
    useConverted: pieUseConverted,
    baseCode: pieBaseCode,
  });
  const centerCode = isCompanyBreakdown
    ? rows?.[0]?.code || currencyCode
    : currencyCode;
  const shareByCode = buildEarningsShareByCode(rows, centerCode, {
    useConverted: pieUseConverted,
  });
  const center = computePieCenterMetrics(rows, centerCode, {
    useConverted: pieUseConverted,
  });

  const legend = rows
    .map((row, index) => ({
      code: String(row.code).toUpperCase(),
      color: getCurrencyColor(row.code, index),
      pct: shareByCode[String(row.code).toUpperCase()] ?? 0,
    }))
    .filter((item) => item.pct >= 0.05)
    .sort((a, b) => b.pct - a.pct);

  const empty = !loading && slices.length === 0;
  const headTitle = title || i18n.currencyDistribution;
  const headBadge = badgeLabel || i18n.currency;

  return (
    <section
      className={`m-dash-card m-dash-earnings-panel${tabs ? " m-dash-earnings-panel--segmented" : ""}${
        footer ? " m-dash-earnings-panel--grouped" : ""
      }`}
    >
      <div className="m-dash-earnings-panel-top">
        {tabs}

        <div className="m-dash-card-head m-dash-card-head--spaced">
          <h2 className="m-dash-card-title">{headTitle}</h2>
          {legend.length > 0 && (
            <span className="m-dash-card-badge">
              {legend.length} {headBadge}
            </span>
          )}
        </div>

        {empty ? (
          <p className="m-dash-card-empty" style={{ height: "8.75rem" }}>
            {i18n.noData}
          </p>
        ) : (
          <div className="m-dash-pie-wrap">
            <div className="m-dash-pie-chart">
              {loading ? (
                <div className="m-dash-pie-skeleton" />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                      <Pie
                        key={isCompanyBreakdown ? "company" : "currency"}
                        data={slices.length ? slices : [{ code: "—", value: 1, fill: "#e2e8f0" }]}
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
                        {(slices.length ? slices : [{ code: "empty", fill: "#e2e8f0" }]).map((entry, index) => (
                          <Cell key={entry.code || index} fill={entry.fill} stroke="#fff" strokeWidth={2} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  {slices.length > 0 && (
                    <div className="m-dash-pie-center" aria-hidden="true">
                      <span className="m-dash-pie-center-pct">{Number(center.pct).toFixed(1)}%</span>
                      <span className="m-dash-pie-center-code">{center.code}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <ul className="m-dash-pie-legend">
              {(loading
                ? Array.from({ length: 4 }, (_, i) => ({ code: `s${i}`, pct: 0, color: "#e2e8f0" }))
                : legend
              ).map((item) => (
                <li key={item.code} className="m-dash-pie-legend-item">
                  <span className="m-dash-pie-legend-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  <span className="m-dash-pie-legend-code">
                    {loading ? (
                      <span className="inline-block h-3 w-8 animate-pulse rounded bg-slate-100" />
                    ) : (
                      item.code
                    )}
                  </span>
                  <span className="m-dash-pie-legend-pct">{loading ? "—" : `${item.pct.toFixed(1)}%`}</span>
                </li>
              ))}
              {!loading && legend.length === 0 && (
                <li className="text-[12px] font-semibold text-slate-400">{i18n.noData}</li>
              )}
            </ul>
          </div>
        )}
        {note && !empty ? <p className="m-dash-pie-note">{note}</p> : null}
      </div>

      {footer ? <div className="m-dash-earnings-panel-footer">{footer}</div> : null}
    </section>
  );
});

export default CurrencyDistributionCard;
