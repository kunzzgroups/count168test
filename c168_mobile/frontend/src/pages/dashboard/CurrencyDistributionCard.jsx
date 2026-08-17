import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { memo, useEffect, useRef } from "react";
import {
  buildEarningsPieSlices,
  buildEarningsShareByCode,
  computePieCenterMetrics,
  getCurrencyColor,
} from "../../lib/dashboardEarnings.js";
import { formatCurrency } from "../../lib/dashboardFormat.js";

function stripRechartsFocus(root) {
  if (!root) return;
  root.querySelectorAll(".recharts-wrapper, .recharts-surface, svg").forEach((node) => {
    if (node.hasAttribute("tabindex")) node.removeAttribute("tabindex");
    if (node instanceof HTMLElement || node instanceof SVGElement) {
      node.style.outline = "none";
      node.style.webkitTapHighlightColor = "transparent";
    }
  });
}

const CurrencyDistributionCard = memo(function CurrencyDistributionCard({
  i18n,
  currencyCode,
  rows,
  useConverted,
  loading,
  summaryValue = null,
  summaryLabel = "",
  conversionNote = "",
  title,
  badgeLabel,
  isCompanyBreakdown = false,
  tabs = null,
  footer = null,
}) {
  const pieHostRef = useRef(null);
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
      pct: shareByCode[String(row.code).toUpperCase()],
    }))
    .filter((item) => item.pct != null && Number(item.pct) >= 0.05)
    .sort((a, b) => Number(b.pct) - Number(a.pct));

  const empty = !loading && slices.length === 0;
  const headTitle = title || i18n.currencyDistribution;
  const headBadge = badgeLabel || i18n.currency;
  const showSummary = summaryValue != null && !empty;
  const caption = [summaryLabel || headTitle, currencyCode].filter(Boolean).join(" · ");

  useEffect(() => {
    const root = pieHostRef.current;
    if (!root || loading || empty) return;
    stripRechartsFocus(root);
    const observer = new MutationObserver(() => stripRechartsFocus(root));
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["tabindex"] });
    return () => observer.disconnect();
  }, [loading, empty, slices.length, isCompanyBreakdown, currencyCode]);

  return (
    <section
      className={`m-dash-card m-dash-earnings-panel${tabs ? " m-dash-earnings-panel--segmented" : ""}${
        footer ? " m-dash-earnings-panel--grouped" : ""
      }`}
    >
      <div className="m-dash-earnings-panel-top">
        {tabs}

        {showSummary ? (
          <div className="m-dash-panel-summary">
            <p className="m-dash-panel-summary-caption">{caption}</p>
            <p className="m-dash-panel-summary-value">
              {loading ? <span className="m-dash-panel-summary-skeleton" /> : formatCurrency(summaryValue)}
            </p>
            {conversionNote ? (
              <p className="m-dash-panel-summary-note">{conversionNote}</p>
            ) : null}
          </div>
        ) : (
          <div className="m-dash-card-head m-dash-card-head--spaced">
            <h2 className="m-dash-card-title">{headTitle}</h2>
            {legend.length > 0 && (
              <span className="m-dash-card-badge">
                {legend.length} {headBadge}
              </span>
            )}
          </div>
        )}

        {empty ? (
          <p className="m-dash-card-empty" style={{ height: "8.75rem" }}>
            {i18n.noData}
          </p>
        ) : (
          <div className="m-dash-pie-wrap">
            <div
              ref={pieHostRef}
              className="m-dash-pie-chart"
              onMouseDown={(e) => {
                e.preventDefault();
              }}
            >
              {loading ? (
                <div className="m-dash-pie-skeleton" />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 2, right: 2, bottom: 2, left: 2 }} style={{ outline: "none" }}>
                      <Pie
                        key={isCompanyBreakdown ? "company" : "currency"}
                        data={slices.length ? slices : [{ code: "—", value: 1, fill: "var(--m-color-ring)" }]}
                        dataKey="value"
                        nameKey="code"
                        cx="50%"
                        cy="50%"
                        innerRadius="66%"
                        outerRadius="88%"
                        paddingAngle={slices.length > 3 ? 2 : 3}
                        stroke="var(--m-color-surface)"
                        strokeWidth={2}
                        activeShape={false}
                        isAnimationActive
                        label={false}
                      >
                        {(slices.length ? slices : [{ code: "empty", fill: "var(--m-color-ring)" }]).map((entry, index) => (
                          <Cell key={entry.code || index} fill={entry.fill} stroke="var(--m-color-surface)" strokeWidth={2} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  {slices.length > 0 && (
                    <div className="m-dash-pie-center" aria-hidden="true">
                      <span className="m-dash-pie-center-pct">
                        {center.pct != null ? `${Number(center.pct).toFixed(1)}%` : "—"}
                      </span>
                      <span className="m-dash-pie-center-code">{center.code}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <ul className="m-dash-pie-legend">
              {(loading
                ? Array.from({ length: 4 }, (_, i) => ({ code: `s${i}`, pct: 0, color: "var(--m-color-ring)" }))
                : legend
              ).map((item) => (
                <li key={item.code} className="m-dash-pie-legend-item">
                  <span className="m-dash-pie-legend-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  <span className="m-dash-pie-legend-code">
                    {loading ? (
                      <span className="m-dash-pie-legend-skel" />
                    ) : (
                      item.code
                    )}
                  </span>
                  <span className="m-dash-pie-legend-pct">
                    {loading ? "—" : `${Number(item.pct).toFixed(1)}%`}
                  </span>
                </li>
              ))}
              {!loading && legend.length === 0 && (
                <li className="m-dash-pie-legend-empty">{i18n.noData}</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {footer ? <div className="m-dash-earnings-panel-footer">{footer}</div> : null}
    </section>
  );
});

export default CurrencyDistributionCard;
