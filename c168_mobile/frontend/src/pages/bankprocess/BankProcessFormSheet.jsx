import { useEffect, useMemo, useRef, useState } from "react";
import { useOverlayLock } from "../../hooks/useOverlayLock.js";
import {
  BANK_PROCESS_CONTRACT_OPTIONS,
  BANK_PROCESS_TYPES,
  calcBankNetProfitDisplay,
  contractBillingEndYmdForBankForm,
  EMPTY_BANK_FORM,
  fetchBankCountries,
  fetchBankPickAccounts,
  fetchBanksByCountry,
  formatBankAccountDisplay,
  formatBankMoneyFixed2,
  parseBankContractRentalMonthsForDayEnd,
  parseProfitSharingToRows,
  profitSharingDisplayLabel,
  sanitizeBankMoneyTyping,
  serializeProfitSharingRows,
  submitBankProcess,
} from "../../lib/bankProcessApi.js";
import { formatDisplayDate } from "../../lib/dashboardDateUtils.js";
import { Pill } from "../dashboard/FilterSheet.jsx";
import { BankProcessAccountQuickSheet } from "./BankProcessAccountQuickSheet.jsx";
import { BankProcessProfitSharingSheet } from "./BankProcessProfitSharingSheet.jsx";

const FREQ_OPTIONS = [
  { value: "1st_of_every_month", labelKey: "bankFreqFirstOfMonth" },
  { value: "monthly", labelKey: "bankFreqMonthly" },
  { value: "week", labelKey: "bankFreqWeek" },
  { value: "day", labelKey: "bankFreqDay" },
  { value: "once", labelKey: "bankFreqOnce" },
];

function Field({ label, children }) {
  return (
    <label className="m-bp-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }) {
  return (
    <section className="m-bp-form-section">
      <h3 className="m-bp-form-section-title">{title}</h3>
      <div className="m-bp-form-block">{children}</div>
    </section>
  );
}

function DateTapRow({ label, value, onChange, disabled }) {
  return (
    <label className={`m-tx-date-row${disabled ? " m-tx-date-row--disabled" : ""}`}>
      <span className="m-tx-date-icon">
        <i className="far fa-calendar" aria-hidden="true" />
      </span>
      <span className="m-tx-date-main">
        <span className="m-tx-date-label">{label}</span>
        <span className="m-tx-date-value">{value ? formatDisplayDate(value) : "—"}</span>
      </span>
      <i className="fas fa-chevron-right m-tx-date-chevron" aria-hidden="true" />
      <input
        type="date"
        value={value || ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="m-tx-date-input"
        aria-label={label}
      />
    </label>
  );
}

function accountLabel(a) {
  return formatBankAccountDisplay(a.account_id || a.code, a.name, String(a.id));
}

function mapSubmitError(code, i18n) {
  switch (code) {
    case "DAY_END_BEFORE_START":
      return i18n.bankDayEndEarlier;
    case "DAY_END_REQUIRED_FOR_CAP":
      return i18n.bankDayEndRequiredForCap;
    case "CONTRACT_REQUIRED":
      return i18n.bankContractRequired;
    case "SELECT_COUNTRY":
      return i18n.bankSelectCountry;
    case "SELECT_TYPE":
      return i18n.bankSelectType;
    case "SELECT_BANK":
      return i18n.bankSelectBank;
    case "NAME_REQUIRED":
      return i18n.bankNameRequired;
    default:
      return code || i18n.bankSaveFailed;
  }
}

/**
 * Add / Edit Bank Process — single scroll, desktop-aligned sections.
 */
export function BankProcessFormSheet({
  open,
  onClose,
  i18n,
  companyId,
  editMode = false,
  initialForm = null,
  busy = false,
  onBusy,
  onSaved,
  onError,
}) {
  const [form, setForm] = useState({ ...EMPTY_BANK_FORM });
  const [countries, setCountries] = useState([]);
  const [banks, setBanks] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [psOpen, setPsOpen] = useState(false);
  const [psSeed, setPsSeed] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountTargetField, setAccountTargetField] = useState("");
  const contractSyncKeysRef = useRef({ day_start: "", contract: "", frequency: "" });

  useOverlayLock(open && !psOpen && !accountOpen, onClose);

  useEffect(() => {
    if (!open) {
      setPsOpen(false);
      setAccountOpen(false);
      contractSyncKeysRef.current = { day_start: "", contract: "", frequency: "" };
      return;
    }
    setForm(initialForm ? { ...EMPTY_BANK_FORM, ...initialForm } : { ...EMPTY_BANK_FORM });
  }, [open, initialForm]);

  useEffect(() => {
    if (!open || !companyId) return undefined;
    const ac = new AbortController();
    setLoadingMeta(true);
    (async () => {
      try {
        const [cList, aList] = await Promise.all([
          fetchBankCountries(companyId, { signal: ac.signal }),
          fetchBankPickAccounts(companyId, { signal: ac.signal }),
        ]);
        if (ac.signal.aborted) return;
        setCountries(cList);
        setAccounts(aList);
      } catch (e) {
        if (e?.name !== "AbortError") onError?.(e?.message || i18n.loadFailed);
      } finally {
        if (!ac.signal.aborted) setLoadingMeta(false);
      }
    })();
    return () => ac.abort();
  }, [open, companyId, onError, i18n.loadFailed]);

  useEffect(() => {
    if (!open || !companyId || !form.country || editMode) {
      if (!form.country) setBanks([]);
      return undefined;
    }
    const ac = new AbortController();
    (async () => {
      try {
        const list = await fetchBanksByCountry(companyId, form.country, { signal: ac.signal });
        if (!ac.signal.aborted) setBanks(list);
      } catch (e) {
        if (e?.name !== "AbortError") setBanks([]);
      }
    })();
    return () => ac.abort();
  }, [open, companyId, form.country, editMode]);

  useEffect(() => {
    if (!open) return;
    const next = calcBankNetProfitDisplay(form.cost, form.price, form.profit_sharing);
    setForm((f) => (String(f.profit) === next ? f : { ...f, profit: next }));
  }, [open, form.cost, form.price, form.profit_sharing]);

  useEffect(() => {
    if (!open) {
      contractSyncKeysRef.current = { day_start: "", contract: "", frequency: "" };
      return;
    }
    const frequencyNorm = String(form.day_start_frequency || "1st_of_every_month");
    if (frequencyNorm === "once" || frequencyNorm === "week" || frequencyNorm === "day") return;
    if (editMode && form.day_end_monthly_cap_enabled && frequencyNorm === "1st_of_every_month") return;

    const start = String(form.day_start || "").trim();
    const contract = String(form.contract || "").trim();
    const frequency = frequencyNorm;
    const prev = contractSyncKeysRef.current;
    const keysChanged =
      prev.day_start !== start || prev.contract !== contract || prev.frequency !== frequency;
    contractSyncKeysRef.current = { day_start: start, contract, frequency };
    if (!keysChanged || !start) return;

    const term = parseBankContractRentalMonthsForDayEnd(contract);
    const calculated = term ? contractBillingEndYmdForBankForm(start, term, frequency) : null;
    if (!calculated) {
      setForm((prevForm) => {
        const cur = String(prevForm.day_end || "").trim();
        if (cur && cur < start) return { ...prevForm, day_end: start };
        return prevForm;
      });
      return;
    }
    setForm((prevForm) => (prevForm.day_end === calculated ? prevForm : { ...prevForm, day_end: calculated }));
  }, [
    open,
    editMode,
    form.day_start,
    form.contract,
    form.day_start_frequency,
    form.day_end_monthly_cap_enabled,
  ]);

  const fq = String(form.day_start_frequency || "1st_of_every_month");
  const dayEndDisabled = fq === "once" || fq === "week" || fq === "day" || fq === "monthly";
  const contractDisabled = fq === "once" || fq === "week" || fq === "day";
  const showCap =
    editMode && fq === "1st_of_every_month" && String(form.day_end || "").trim().length > 0;
  const dayEndLockedByCap = showCap && !!form.day_end_monthly_cap_enabled;

  const profitSharingRows = useMemo(
    () => parseProfitSharingToRows(form.profit_sharing, accounts),
    [form.profit_sharing, accounts],
  );

  const patch = (partial) => setForm((prev) => ({ ...prev, ...partial }));

  const blurMoney = (key) => {
    setForm((prev) => {
      const raw = String(prev[key] ?? "").trim();
      if (!raw) return prev;
      return { ...prev, [key]: formatBankMoneyFixed2(raw) };
    });
  };

  const title = editMode ? i18n.bankEditTitle : i18n.bankAddTitle;

  const openProfitSharing = () => {
    setPsSeed(
      profitSharingRows.length
        ? profitSharingRows
        : [{ accountId: "", accountLabel: "", amount: "" }],
    );
    setPsOpen(true);
  };

  const removeProfitSharingAt = (idx) => {
    const next = profitSharingRows.filter((_, i) => i !== idx);
    patch({ profit_sharing: serializeProfitSharingRows(next, accounts) });
  };

  const handlePsConfirm = (rows) => {
    patch({ profit_sharing: serializeProfitSharingRows(rows, accounts) });
    setPsOpen(false);
  };

  const openAddAccount = (field) => {
    setAccountTargetField(field);
    setAccountOpen(true);
  };

  const handleAccountCreated = async (created) => {
    try {
      const list = await fetchBankPickAccounts(companyId);
      setAccounts(list);
    } catch {
      /* keep existing list; still apply id */
    }
    if (accountTargetField) {
      patch({ [accountTargetField]: String(created.id) });
    }
  };

  const handleSave = async () => {
    if (busy) return;
    onBusy?.(true);
    try {
      await submitBankProcess(form, { companyId, editMode });
      onSaved?.(editMode);
      onClose?.();
    } catch (e) {
      onError?.(mapSubmitError(e?.message, i18n));
    } finally {
      onBusy?.(false);
    }
  };

  return (
    <>
      <div
        className={`m-sheet-overlay${open ? " m-sheet-overlay--open" : " m-sheet-overlay--closed"}`}
        aria-hidden={!open}
        inert={open ? undefined : ""}
      >
        <button
          type="button"
          className="m-sheet-backdrop"
          onClick={() => {
            if (!psOpen && !accountOpen) onClose?.();
          }}
          aria-label="Close"
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`m-sheet-panel m-sheet-panel--tall${
            open ? " m-sheet-panel--open" : " m-sheet-panel--closed"
          }`}
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
          <div className="m-sheet-body m-sheet-body--spaced">
            {loadingMeta ? (
              <div className="m-mt-state">
                <i className="fas fa-spinner fa-spin" aria-hidden="true" />
                <p>{i18n.loading}</p>
              </div>
            ) : null}

            <Section title={i18n.bankSectionBankInfo}>
              <Field label={i18n.bankCountryCurrency}>
                {editMode ? (
                  <input type="text" readOnly value={form.country || ""} />
                ) : (
                  <select
                    value={form.country || ""}
                    onChange={(e) => patch({ country: e.target.value, bank: "" })}
                  >
                    <option value="">{i18n.bankSelectCountry}</option>
                    {countries.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={i18n.bankBank}>
                {editMode ? (
                  <input type="text" readOnly value={form.bank || ""} />
                ) : (
                  <select
                    value={form.bank || ""}
                    disabled={!form.country}
                    onChange={(e) => patch({ bank: e.target.value })}
                  >
                    <option value="">{i18n.bankSelectBank}</option>
                    {banks.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <p className="m-bp-section-label">{i18n.bankType}</p>
              {editMode ? (
                <input type="text" readOnly value={form.type || ""} />
              ) : (
                <div className="m-filter-pill-wrap">
                  {BANK_PROCESS_TYPES.map((t) => (
                    <Pill key={t} active={form.type === t} onClick={() => patch({ type: t })}>
                      {i18n[`bankType_${t}`] || t}
                    </Pill>
                  ))}
                </div>
              )}
              <Field label={i18n.bankCardOwner}>
                <input
                  type="text"
                  value={form.name || ""}
                  readOnly={editMode}
                  autoCapitalize="characters"
                  onChange={(e) => patch({ name: e.target.value })}
                  style={{ textTransform: "uppercase" }}
                  placeholder={i18n.bankCardOwnerPlaceholder}
                />
              </Field>
            </Section>

            <Section title={i18n.bankSectionDetail}>
              <div className="m-bp-field-with-add">
                <Field label={i18n.bankSupplier}>
                  <select
                    value={form.card_merchant_id || ""}
                    onChange={(e) => patch({ card_merchant_id: e.target.value })}
                  >
                    <option value="">{i18n.bankSelectAccount}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {accountLabel(a)}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  className="m-bp-inline-add tap-scale"
                  onClick={() => openAddAccount("card_merchant_id")}
                  disabled={busy}
                  aria-label={i18n.bankAddAccountTitle}
                >
                  <i className="fas fa-plus" aria-hidden="true" />
                </button>
              </div>
              <Field label={i18n.bankBuyPrice}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.cost || ""}
                  onChange={(e) => patch({ cost: sanitizeBankMoneyTyping(e.target.value) })}
                  onBlur={() => blurMoney("cost")}
                  placeholder="0.00"
                />
              </Field>
              <div className="m-bp-field-with-add">
                <Field label={i18n.bankCustomer}>
                  <select
                    value={form.customer_id || ""}
                    onChange={(e) => patch({ customer_id: e.target.value })}
                  >
                    <option value="">{i18n.bankSelectAccount}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {accountLabel(a)}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  className="m-bp-inline-add tap-scale"
                  onClick={() => openAddAccount("customer_id")}
                  disabled={busy}
                  aria-label={i18n.bankAddAccountTitle}
                >
                  <i className="fas fa-plus" aria-hidden="true" />
                </button>
              </div>
              <Field label={i18n.bankSellPrice}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.price || ""}
                  onChange={(e) => patch({ price: sanitizeBankMoneyTyping(e.target.value) })}
                  onBlur={() => blurMoney("price")}
                  placeholder="0.00"
                />
              </Field>
              <div className="m-bp-field-with-add">
                <Field label={i18n.bankProfitAccount}>
                  <select
                    value={form.profit_account_id || ""}
                    onChange={(e) => patch({ profit_account_id: e.target.value })}
                  >
                    <option value="">{i18n.bankSelectAccount}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {accountLabel(a)}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  className="m-bp-inline-add tap-scale"
                  onClick={() => openAddAccount("profit_account_id")}
                  disabled={busy}
                  aria-label={i18n.bankAddAccountTitle}
                >
                  <i className="fas fa-plus" aria-hidden="true" />
                </button>
              </div>
              <Field label={i18n.bankProfit}>
                <input type="text" readOnly value={form.profit || ""} placeholder="0.00" />
              </Field>
            </Section>

            <Section title={i18n.bankSectionSchedule}>
              <DateTapRow
                label={i18n.bankDayStart}
                value={form.day_start || ""}
                onChange={(v) =>
                  patch({
                    day_start: v,
                    day_end: v && form.day_end && form.day_end < v ? "" : form.day_end,
                  })
                }
              />
              <DateTapRow
                label={i18n.bankDayEnd}
                value={form.day_end || ""}
                onChange={(v) => patch({ day_end: v })}
                disabled={dayEndDisabled || dayEndLockedByCap}
              />
              {showCap ? (
                <label className="m-bp-check-row">
                  <input
                    type="checkbox"
                    checked={!!form.day_end_monthly_cap_enabled}
                    onChange={(e) => patch({ day_end_monthly_cap_enabled: e.target.checked })}
                  />
                  <span>{i18n.bankMonthlyCap}</span>
                </label>
              ) : null}
              <p className="m-bp-section-label">{i18n.bankFrequency}</p>
              <div className="m-filter-pill-wrap">
                {FREQ_OPTIONS.map((opt) => (
                  <Pill
                    key={opt.value}
                    active={fq === opt.value}
                    onClick={() =>
                      patch({
                        day_start_frequency: opt.value,
                        ...(opt.value === "once" || opt.value === "week" || opt.value === "day"
                          ? {
                              day_end: "",
                              contract: opt.value === "once" ? "" : form.contract,
                            }
                          : {}),
                        ...(opt.value === "once" ? { insurance: "" } : {}),
                        ...(opt.value !== "1st_of_every_month"
                          ? { day_end_monthly_cap_enabled: false }
                          : {}),
                      })
                    }
                  >
                    {i18n[opt.labelKey] || opt.value}
                  </Pill>
                ))}
              </div>
              <Field label={i18n.bankContract}>
                <select
                  value={form.contract || ""}
                  disabled={contractDisabled}
                  onChange={(e) => patch({ contract: e.target.value })}
                >
                  <option value="">{i18n.bankSelectContract}</option>
                  {BANK_PROCESS_CONTRACT_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={i18n.bankInsurance}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.insurance || ""}
                  disabled={fq === "once"}
                  onChange={(e) => patch({ insurance: e.target.value })}
                  placeholder="0.00"
                />
              </Field>
            </Section>

            <section className="m-bp-form-section">
              <div className="m-bp-ps-section-head">
                <h3 className="m-bp-form-section-title">{i18n.bankSelectedProfitSharing}</h3>
                <button
                  type="button"
                  className="m-bp-ps-plus tap-scale"
                  onClick={openProfitSharing}
                  disabled={busy}
                  aria-label={i18n.bankAddProfitSharing}
                  title={i18n.bankAddProfitSharing}
                >
                  <i className="fas fa-plus" aria-hidden="true" />
                </button>
              </div>
              <div className="m-bp-form-block">
                {profitSharingRows.length === 0 ? (
                  <p className="m-bp-ps-empty">{i18n.bankNoProfitSharing}</p>
                ) : (
                  <ul className="m-bp-ps-list">
                    {profitSharingRows.map((row, idx) => (
                      <li key={`${row.accountId || row.accountLabel}-${idx}`} className="m-bp-ps-item">
                        <span className="m-bp-ps-item-name">
                          {profitSharingDisplayLabel(row, accounts)}
                        </span>
                        <span className="m-bp-ps-item-amt">
                          {formatBankMoneyFixed2(row.amount)}
                        </span>
                        <button
                          type="button"
                          className="m-bp-ps-item-remove tap-scale"
                          onClick={() => removeProfitSharingAt(idx)}
                          aria-label={i18n.bankRemoveRow}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <Section title={i18n.bankSectionNotes}>
              <Field label={i18n.bankSop}>
                <textarea
                  rows={3}
                  value={form.sop || ""}
                  onChange={(e) => patch({ sop: e.target.value })}
                  placeholder={i18n.bankSopPlaceholder}
                />
              </Field>
              <Field label={i18n.bankRemark}>
                <textarea
                  rows={3}
                  value={form.remark || ""}
                  onChange={(e) => patch({ remark: e.target.value })}
                  placeholder={i18n.bankRemarkPlaceholder}
                />
              </Field>
            </Section>
          </div>
          <div className="m-sheet-footer">
            <button
              type="button"
              className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale"
              disabled={busy}
              onClick={onClose}
            >
              {i18n.cancel}
            </button>
            <button
              type="button"
              className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
              disabled={busy || loadingMeta}
              onClick={() => void handleSave()}
            >
              {i18n.save}
            </button>
          </div>
        </section>
      </div>

      <BankProcessProfitSharingSheet
        open={psOpen}
        onClose={() => setPsOpen(false)}
        i18n={i18n}
        accounts={accounts}
        initialRows={psSeed}
        onConfirm={handlePsConfirm}
      />
      <BankProcessAccountQuickSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        i18n={i18n}
        companyId={companyId}
        busy={busy}
        onBusy={onBusy}
        onCreated={(created) => void handleAccountCreated(created)}
        onError={onError}
      />
    </>
  );
}
