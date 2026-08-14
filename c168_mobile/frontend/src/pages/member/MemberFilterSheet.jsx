import { useEffect, useState } from "react";
import { useOverlayLock } from "../../hooks/useOverlayLock.js";
import "../transaction/add-transaction-sheet.css";
import "../account/account.css";
import "./member.css";

function Sheet({ open, title, onClose, children, footer = null }) {
  useOverlayLock(open, onClose);
  return (
    <div
      className={`m-sheet-overlay${open ? " m-sheet-overlay--open" : " m-sheet-overlay--closed"}`}
      aria-hidden={!open}
      inert={open ? undefined : ""}
    >
      <button type="button" className="m-sheet-backdrop" onClick={onClose} aria-label="Close" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`m-sheet-panel m-sheet-panel--tall${open ? " m-sheet-panel--open" : " m-sheet-panel--closed"}`}
      >
        <div className="m-sheet-handle-wrap" aria-hidden="true">
          <span className="m-sheet-handle" />
        </div>
        <header className="m-sheet-header">
          <h2 className="m-sheet-title">{title}</h2>
          <button type="button" className="m-sheet-close tap-scale" onClick={onClose} aria-label="Close">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </header>
        <div className="m-sheet-body m-account-sheet-body">{children}</div>
        {footer ? <footer className="m-account-sheet-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export default function MemberFilterSheet({
  open,
  onClose,
  t,
  companies,
  companyId,
  linkedAccounts,
  viewAccountId,
  dateFromYmd,
  dateToYmd,
  availableCurrencies,
  isAllSelected,
  selectedCurrencies,
  onApply,
  onSwitchCompany,
  onSwitchAccount,
  onSetCurrencyAll,
  onToggleCurrency,
}) {
  const [from, setFrom] = useState(dateFromYmd);
  const [to, setTo] = useState(dateToYmd);

  useEffect(() => {
    if (!open) return;
    setFrom(dateFromYmd);
    setTo(dateToYmd);
  }, [open, dateFromYmd, dateToYmd]);

  return (
    <Sheet
      open={open}
      title={t("filters")}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="m-account-primary-btn tap-scale"
          onClick={() => {
            void onApply?.({ fromYmd: from, toYmd: to });
            onClose?.();
          }}
        >
          {t("applyFilters")}
        </button>
      }
    >
      <div className="m-member-filter">
        <div className="m-member-filter-row">
          <label className="m-member-field">
            <span>{t("from")}</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="m-member-field">
            <span>{t("to")}</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>

        {companies.length > 1 ? (
          <div className="m-member-field">
            <span>{t("company")}</span>
            <div className="m-member-chips">
              {companies.map((c) => {
                const id = Number(c.id || c.company_db_id || 0);
                const code = String(c.company_id || c.company_code || id).toUpperCase();
                const active = id === Number(companyId);
                return (
                  <button
                    key={id || code}
                    type="button"
                    className={`m-member-chip tap-scale${active ? " is-active" : ""}`}
                    onClick={() => void onSwitchCompany?.(id, code)}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {linkedAccounts.length > 0 ? (
          <div className="m-member-field">
            <span>{t("account")}</span>
            <div className="m-member-chips">
              {linkedAccounts.map((a) => {
                const active = Number(a.id) === Number(viewAccountId);
                const code = String(a.account_id || a.id).toUpperCase();
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`m-member-chip tap-scale${active ? " is-active" : ""}`}
                    onClick={() => void onSwitchAccount?.(a.id, a.account_id, a.name)}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="m-member-field">
          <span>{t("currency")}</span>
          <div className="m-member-chips">
            {availableCurrencies.length > 1 ? (
              <button
                type="button"
                className={`m-member-chip tap-scale${isAllSelected ? " is-active" : ""}`}
                onClick={() => onSetCurrencyAll?.()}
              >
                {t("all")}
              </button>
            ) : null}
            {availableCurrencies.map((code) => {
              const active = !isAllSelected && selectedCurrencies.includes(code);
              const solo = availableCurrencies.length === 1 && selectedCurrencies.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  className={`m-member-chip tap-scale${active || solo || (availableCurrencies.length === 1 && isAllSelected) ? " is-active" : ""}`}
                  onClick={() => onToggleCurrency?.(code)}
                >
                  {code}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
