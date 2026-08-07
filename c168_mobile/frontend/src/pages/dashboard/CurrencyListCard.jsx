import { memo } from "react";
import {
  formatFrankfurterUnitRate,
  getCurrencyColor,
  resolveEarningsRowDisplayAmounts,
} from "../../lib/dashboardEarnings.js";
import { formatCurrency } from "../../lib/dashboardFormat.js";
import { getCurrencyMeta } from "../../lib/currencyMeta.js";

const CurrencyListCard = memo(function CurrencyListCard({
  i18n,
  lang,
  currencyCode,
  rows,
  exchangeRates,
  exchangeRatesLoading,
  useConverted,
  loading,
}) {
  const sorted = [...rows].sort((a, b) => {
    const av = Math.abs(Number(a.earningsConverted ?? a.earnings) || 0);
    const bv = Math.abs(Number(b.earningsConverted ?? b.earnings) || 0);
    return bv - av;
  });
  const displayRows = sorted.length ? sorted : [];

  if (!rows?.length && !loading) {
    return (
      <section className="m-dash-card m-dash-card--padded">
        <h2 className="m-dash-card-title">{i18n.currencies}</h2>
        <p className="m-dash-card-empty" style={{ marginTop: "1.5rem", marginBottom: "0.5rem" }}>
          {i18n.noData}
        </p>
      </section>
    );
  }

  return (
    <section className="m-dash-card m-dash-currency-list">
      <div className="m-dash-currency-list-head">
        <h2 className="m-dash-card-title">{i18n.currencies}</h2>
        {!loading && displayRows.length > 0 ? (
          <span className="m-dash-currency-list-count">{displayRows.length}</span>
        ) : null}
      </div>

      <ul className="m-dash-currency-rows">
        {displayRows.map((row, index) => {
          const code = String(row.code).toUpperCase();
          const meta = getCurrencyMeta(code, lang);
          const color = getCurrencyColor(code, index);
          const { primary } = resolveEarningsRowDisplayAmounts(
            row,
            currencyCode,
            exchangeRates.rates,
            useConverted,
          );
          const rateLabel = formatFrankfurterUnitRate(code, currencyCode, exchangeRates.rates);
          const amount = loading ? "…" : primary != null ? formatCurrency(primary) : formatCurrency(0);
          const negative = Number(primary) < 0;

          return (
            <li key={code}>
              <div className="m-dash-currency-row">
                <span className="m-dash-currency-flag" aria-hidden="true">
                  {meta.flag}
                </span>

                <div className="m-dash-currency-main">
                  <p className="m-dash-currency-code">
                    <span className="m-dash-currency-dot" style={{ backgroundColor: color }} aria-hidden="true" />
                    {code}
                  </p>
                  <p className="m-dash-currency-name">{meta.name}</p>
                </div>

                <div className="m-dash-currency-amounts">
                  <p className={`m-dash-currency-amount${negative ? " m-dash-currency-amount--neg" : ""}`}>
                    {amount}
                  </p>
                  <p className="m-dash-currency-rate">
                    {i18n.rate} {exchangeRatesLoading ? "…" : rateLabel}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

export default CurrencyListCard;
