import { Fragment, useMemo, useState } from "react";
import MobileShell from "../../components/layout/MobileShell.jsx";
import { useMobileMember } from "../../hooks/useMobileMember.js";
import { computeTableTotals } from "../../lib/memberHelpers.js";
import { moneyToneClass } from "../../lib/money/moneyToneClass.js";
import {
  formatPaymentHistoryMoney,
  formatRateForHistoryDisplay,
  getHistoryRemark,
} from "../../lib/transactionFormat.js";
import { formatMemberRowDescription } from "../../translateFile/memberTranslate.js";
import ExportPdfSheet from "../transaction/ExportPdfSheet.jsx";
import MemberFilterSheet from "./MemberFilterSheet.jsx";
import "../account/account.css";
import "../transaction/transaction-history.css";
import "./member.css";

function MoneyTone({ value, children }) {
  return <span className={moneyToneClass(value)}>{children}</span>;
}

function productLabel(row) {
  if (row?.is_bank_process_transaction && row?.card_owner) return String(row.card_owner);
  return String(row?.id_product || row?.process || "-");
}

function CurrencySection({ currency, rows, t, lang, expandedKey, setExpandedKey }) {
  const totals = useMemo(() => computeTableTotals(rows), [rows]);
  return (
    <section className="m-member-ccy" aria-label={t("currencyTitle", { currency })}>
      <h2 className="m-member-ccy-title">{t("currencyTitle", { currency })}</h2>
      <div className="m-tx-hist-list">
        {rows.length === 0 ? (
          <div className="m-account-empty">
            <p>{t("noData")}</p>
          </div>
        ) : (
          rows.map((row, idx) => {
            const key = `${currency}-${row.transaction_id || idx}-${row.date || ""}`;
            const open = expandedKey === key;
            return (
              <Fragment key={key}>
                <button
                  type="button"
                  className={`m-tx-hist-row tap-scale${open ? " is-open" : ""}`}
                  onClick={() => setExpandedKey(open ? null : key)}
                >
                  <span className="m-tx-hist-row-main">
                    <strong>{row.date || "—"}</strong>
                    <small>{productLabel(row)}</small>
                  </span>
                  <span className="m-tx-hist-row-bal">
                    <MoneyTone value={row.balance}>{formatPaymentHistoryMoney(row.balance)}</MoneyTone>
                  </span>
                </button>
                {open ? (
                  <div className="m-tx-hist-detail">
                    <div>
                      <span>{t("colRate")}</span>
                      <strong>{formatRateForHistoryDisplay(row.rate)}</strong>
                    </div>
                    <div>
                      <span>{t("colWinLoss")}</span>
                      <strong>
                        <MoneyTone value={row.win_loss}>{formatPaymentHistoryMoney(row.win_loss)}</MoneyTone>
                      </strong>
                    </div>
                    <div>
                      <span>{t("colCrDr")}</span>
                      <strong>
                        <MoneyTone value={row.cr_dr}>{formatPaymentHistoryMoney(row.cr_dr)}</MoneyTone>
                      </strong>
                    </div>
                    <div>
                      <span>{t("colDescription")}</span>
                      <strong>{formatMemberRowDescription(lang, row)}</strong>
                    </div>
                    <div>
                      <span>{t("colRemark")}</span>
                      <strong>{getHistoryRemark(row) || "—"}</strong>
                    </div>
                  </div>
                ) : null}
              </Fragment>
            );
          })
        )}
      </div>
      {rows.length > 0 ? (
        <div className="m-member-total">
          <strong>{t("totalRow", { currency })}</strong>
          <div className="m-member-total-grid">
            <span>
              {t("colWinLoss")}:{" "}
              <MoneyTone value={totals.totalWinLoss.toString()}>
                {formatPaymentHistoryMoney(totals.totalWinLoss.toString())}
              </MoneyTone>
            </span>
            <span>
              {t("colCrDr")}:{" "}
              <MoneyTone value={totals.totalCrDr.toString()}>
                {formatPaymentHistoryMoney(totals.totalCrDr.toString())}
              </MoneyTone>
            </span>
            <span>
              {t("colBalance")}:{" "}
              <MoneyTone value={totals.closingBalance.toString()}>
                {formatPaymentHistoryMoney(totals.closingBalance.toString())}
              </MoneyTone>
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function MemberPage() {
  const api = useMobileMember();
  const { i18n, t, lang } = api;
  const [filterOpen, setFilterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [expandedKey, setExpandedKey] = useState(null);

  const exportScope = useMemo(
    () => ({
      accountDbId: api.viewAccountId,
      companyId: api.companyId || undefined,
      groupId: api.groupId || undefined,
      dateFrom: api.dateFromYmd,
      dateTo: api.dateToYmd,
      currency: api.isAllSelected ? "ALL" : api.selectedCurrencies.join(","),
    }),
    [
      api.viewAccountId,
      api.companyId,
      api.groupId,
      api.dateFromYmd,
      api.dateToYmd,
      api.isAllSelected,
      api.selectedCurrencies,
    ],
  );

  const accountCode = String(api.viewAccount?.account_id || "").toUpperCase();
  const accountName = String(api.viewAccount?.name || "").trim();
  const filterSummary = [
    `${api.dateFromYmd} — ${api.dateToYmd}`,
    accountCode || null,
    api.isAllSelected ? t("all") : api.selectedCurrencies.join(", ") || t("selectCurrency"),
  ]
    .filter(Boolean)
    .join(" · ");

  const stickyBar = (
    <div className="m-member-sticky">
      <div className="m-member-heading">
        <div>
          <h1>{t("winLoss")}</h1>
          <p>{t("pageSubtitle")}</p>
        </div>
        <div className="m-member-heading-actions">
          <button
            type="button"
            className="m-member-icon-btn tap-scale"
            onClick={() => setFilterOpen(true)}
            aria-label={t("filters")}
          >
            <i className="fas fa-sliders" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="m-member-icon-btn tap-scale"
            onClick={() => setExportOpen(true)}
            aria-label={t("exportPdf")}
          >
            <i className="fas fa-file-pdf" aria-hidden="true" />
          </button>
        </div>
      </div>
      <button type="button" className="m-member-filter-summary tap-scale" onClick={() => setFilterOpen(true)}>
        <i className="fas fa-filter" aria-hidden="true" />
        <span>{filterSummary}</span>
      </button>
    </div>
  );

  if (api.bootLoading) {
    return (
      <div className="m-account-loading" style={{ padding: "3rem 1rem" }}>
        <i className="fas fa-spinner fa-spin" aria-hidden="true" />
        <span>{t("loading")}</span>
      </div>
    );
  }

  return (
    <MobileShell
      i18n={i18n}
      me={api.me}
      companyCode={api.companyCode}
      groupId={api.groupIdLabel}
      onLogout={api.logout}
      onRefresh={api.refresh}
      refreshing={api.refreshing}
      stickyBar={stickyBar}
      lang={lang}
      onLangChange={api.setLang}
      showBottomNav={false}
      overlayOpen={filterOpen || exportOpen}
      overlay={
        <>
          <MemberFilterSheet
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            t={t}
            companies={api.companies}
            companyId={api.companyId}
            linkedAccounts={api.linkedAccounts}
            viewAccountId={api.viewAccountId}
            dateFromYmd={api.dateFromYmd}
            dateToYmd={api.dateToYmd}
            availableCurrencies={api.availableCurrencies}
            isAllSelected={api.isAllSelected}
            selectedCurrencies={api.selectedCurrencies}
            onApply={api.applyFilters}
            onSwitchCompany={api.switchCompany}
            onSwitchAccount={api.switchAccount}
            onSetCurrencyAll={api.setCurrencyAll}
            onToggleCurrency={api.toggleCurrency}
          />
          <ExportPdfSheet
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            m={i18n}
            scope={exportScope}
            accountCode={accountCode}
            accountName={accountName}
            lang={lang}
          />
        </>
      }
    >
      <div className="m-member-page">
        {api.toast ? (
          <div className={`m-account-toast ${api.toast.tone}`}>{api.toast.message}</div>
        ) : null}

        {api.loadingTable ? (
          <div className="m-account-loading">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{t("loading")}</span>
          </div>
        ) : api.groupedRows.length === 0 ? (
          <div className="m-account-empty">
            <i className="fas fa-receipt" aria-hidden="true" />
            <p>{t("noDataInRange")}</p>
          </div>
        ) : (
          api.groupedRows.map(([currency, rows]) => (
            <CurrencySection
              key={currency}
              currency={currency}
              rows={rows}
              t={t}
              lang={lang}
              expandedKey={expandedKey}
              setExpandedKey={setExpandedKey}
            />
          ))
        )}
      </div>
    </MobileShell>
  );
}
