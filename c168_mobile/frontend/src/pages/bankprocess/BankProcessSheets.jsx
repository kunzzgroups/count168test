import { useEffect, useMemo, useState } from "react";
import { useOverlayLock } from "../../hooks/useOverlayLock.js";
import {
  accountingDueRowKey,
  bankProcessFrequencyNormalized,
  bankProcessUiStatusKey,
  bankTypeLabel,
  canDeleteBankProcess,
  canShowBankResend,
  formatBankMoney,
  formatDueDisplayDate,
} from "../../lib/bankProcessApi.js";
import { formatDisplayDate } from "../../lib/dashboardDateUtils.js";
import { Pill } from "../dashboard/FilterSheet.jsx";

const STATUS_OPTIONS = ["ACTIVE", "INACTIVE", "OFFICIAL", "E_INVOICE", "BLOCK"];

const FREQ_OPTIONS = [
  { value: "1st_of_every_month", labelKey: "bankFreqFirstOfMonth" },
  { value: "monthly", labelKey: "bankFreqMonthly" },
  { value: "week", labelKey: "bankFreqWeek" },
  { value: "day", labelKey: "bankFreqDay" },
  { value: "once", labelKey: "bankFreqOnce" },
];

function SheetShell({ open, title, onClose, tall = false, children, footer = null }) {
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
        className={`m-sheet-panel${tall ? " m-sheet-panel--tall" : ""}${
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
        <div className="m-sheet-body m-sheet-body--spaced">{children}</div>
        {footer ? <div className="m-sheet-footer">{footer}</div> : null}
      </section>
    </div>
  );
}

function statusLabel(key, i18n) {
  const k = String(key || "").toUpperCase().replace(/-/g, "_");
  if (k === "ACTIVE") return i18n.bankStatusActive;
  if (k === "INACTIVE") return i18n.bankStatusInactive;
  if (k === "OFFICIAL") return i18n.bankStatusOfficial;
  if (k === "E_INVOICE") return i18n.bankStatusEInvoice;
  if (k === "BLOCK") return i18n.bankStatusBlock;
  return k;
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

/** Card detail + status + remark/resend entry points. */
export function BankProcessActionsSheet({
  open,
  onClose,
  row,
  i18n,
  busy = false,
  onApplyStatus,
  onOpenRemark,
  onOpenResend,
  onOpenEdit,
  onDelete,
}) {
  const current = bankProcessUiStatusKey(row);
  const [draftStatus, setDraftStatus] = useState(current);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setDraftStatus(bankProcessUiStatusKey(row));
      setConfirmDelete(false);
    }
  }, [open, row]);

  if (!row) return null;

  const owner = String(row.supplier || "").trim() || "—";
  const supplier = String(row.card_lower || "").trim() || "—";
  const canResend = canShowBankResend(row);
  const canDelete = canDeleteBankProcess(row);

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      tall
      title={i18n.bankActionsTitle}
      footer={
        <>
          <button type="button" className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale" onClick={onClose}>
            {i18n.cancel}
          </button>
          <button
            type="button"
            className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
            disabled={busy || draftStatus === current}
            onClick={() => onApplyStatus?.(draftStatus)}
          >
            {i18n.bankSaveStatus}
          </button>
        </>
      }
    >
      <div className="m-bp-actions-head">
        <strong>
          {supplier} · {bankTypeLabel(row)}
        </strong>
        <p>{owner}</p>
      </div>

      <div className="m-bp-kv">
        <div>
          <span>{i18n.currency}</span>
          <strong>{String(row.country || "—").toUpperCase()}</strong>
        </div>
        <div>
          <span>{i18n.bankContract || "Contract"}</span>
          <strong>{row.contract || "—"}</strong>
        </div>
        <div>
          <span>{i18n.bankCost}</span>
          <strong>{formatBankMoney(row.cost)}</strong>
        </div>
        <div>
          <span>{i18n.bankPrice}</span>
          <strong>{formatBankMoney(row.price)}</strong>
        </div>
        <div>
          <span>{i18n.bankProfit}</span>
          <strong>{formatBankMoney(row.profit)}</strong>
        </div>
        <div>
          <span>{i18n.bankCustomer || "Customer"}</span>
          <strong>{row.customer || "—"}</strong>
        </div>
      </div>

      {row.remark ? <p className="m-bp-remark-preview">{row.remark}</p> : null}

      <p className="m-bp-section-label">{i18n.bankStatus}</p>
      <div className="m-filter-pill-wrap">
        {STATUS_OPTIONS.map((opt) => (
          <Pill key={opt} active={draftStatus === opt} onClick={() => setDraftStatus(opt)}>
            {statusLabel(opt, i18n)}
          </Pill>
        ))}
      </div>

      <div className="m-bp-action-row">
        {onOpenEdit ? (
          <button type="button" className="m-bp-action-btn tap-scale" onClick={onOpenEdit} disabled={busy}>
            <i className="fas fa-pen" aria-hidden="true" />
            {i18n.bankEdit}
          </button>
        ) : null}
        <button type="button" className="m-bp-action-btn tap-scale" onClick={onOpenRemark} disabled={busy}>
          <i className="fas fa-comment" aria-hidden="true" />
          {i18n.bankRemark}
        </button>
        {canResend ? (
          <button type="button" className="m-bp-action-btn tap-scale" onClick={onOpenResend} disabled={busy}>
            <i className="fas fa-rotate-right" aria-hidden="true" />
            {i18n.bankResend}
          </button>
        ) : null}
        {canDelete && onDelete ? (
          <button
            type="button"
            className="m-bp-action-btn m-bp-action-btn--danger tap-scale"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <i className="fas fa-trash" aria-hidden="true" />
            {i18n.delete}
          </button>
        ) : null}
      </div>

      {confirmDelete ? (
        <div className="m-bp-delete-confirm">
          <p>{i18n.bankDeleteConfirm}</p>
          <div className="m-bp-action-row">
            <button
              type="button"
              className="m-bp-action-btn tap-scale"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              {i18n.cancel}
            </button>
            <button
              type="button"
              className="m-bp-action-btn m-bp-action-btn--danger tap-scale"
              disabled={busy}
              onClick={() => onDelete?.(row)}
            >
              {i18n.delete}
            </button>
          </div>
        </div>
      ) : null}
    </SheetShell>
  );
}

export function BankProcessRemarkSheet({ open, onClose, row, i18n, busy, onSave }) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (open) setDraft(String(row?.remark || ""));
  }, [open, row]);

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title={i18n.bankRemark}
      footer={
        <>
          <button type="button" className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale" onClick={onClose}>
            {i18n.cancel}
          </button>
          <button
            type="button"
            className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
            disabled={busy}
            onClick={() => onSave?.(draft)}
          >
            {i18n.save || i18n.apply}
          </button>
        </>
      }
    >
      <label className="m-bp-field">
        <span>{i18n.bankRemark}</span>
        <textarea
          rows={6}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={i18n.bankRemarkPlaceholder}
        />
      </label>
    </SheetShell>
  );
}

export function BankProcessResendSheet({ open, onClose, row, i18n, busy, onSubmit }) {
  const [dayStart, setDayStart] = useState("");
  const [dayEnd, setDayEnd] = useState("");
  const [frequency, setFrequency] = useState("1st_of_every_month");

  useEffect(() => {
    if (!open || !row) return;
    setDayStart(String(row.day_start || row.date || "").slice(0, 10));
    setDayEnd(String(row.day_end || "").slice(0, 10));
    setFrequency(bankProcessFrequencyNormalized(row.day_start_frequency || row.frequency));
  }, [open, row]);

  const fq = bankProcessFrequencyNormalized(frequency);
  const dayEndDisabled = fq === "once" || fq === "monthly" || fq === "week" || fq === "day";

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      title={i18n.bankResendTitle}
      footer={
        <>
          <button type="button" className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale" onClick={onClose}>
            {i18n.cancel}
          </button>
          <button
            type="button"
            className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
            disabled={busy || !dayStart}
            onClick={() => onSubmit?.({ dayStart, dayEnd: dayEndDisabled ? "" : dayEnd, frequency: fq })}
          >
            {i18n.bankResend}
          </button>
        </>
      }
    >
      <p className="m-bp-resend-target">
        {i18n.bankProcessLabel}: <strong>{row?.supplier || row?.bank || "—"}</strong>
      </p>
      <DateTapRow label={i18n.bankDayStart} value={dayStart} onChange={setDayStart} />
      <DateTapRow
        label={i18n.bankDayEnd}
        value={dayEnd}
        onChange={setDayEnd}
        disabled={dayEndDisabled}
      />
      <p className="m-bp-section-label">{i18n.bankFrequency}</p>
      <div className="m-filter-pill-wrap">
        {FREQ_OPTIONS.map((opt) => (
          <Pill key={opt.value} active={fq === opt.value} onClick={() => setFrequency(opt.value)}>
            {i18n[opt.labelKey] || opt.value}
          </Pill>
        ))}
      </div>
    </SheetShell>
  );
}

export function BankProcessDueSheet({
  open,
  onClose,
  i18n,
  rows,
  loading,
  busy,
  onRefresh,
  onPost,
  onDismiss,
}) {
  const [selected, setSelected] = useState(() => new Set());
  const [dismissSelected, setDismissSelected] = useState(() => new Set());

  useEffect(() => {
    if (!open) return;
    const postable = rows.filter((r) => !r.already_posted_today);
    setSelected(new Set(postable.map((r) => accountingDueRowKey(r)).filter(Boolean)));
    setDismissSelected(new Set());
  }, [open, rows]);

  const postable = useMemo(() => rows.filter((r) => !r.already_posted_today), [rows]);
  const selectedRows = rows.filter((r) => selected.has(accountingDueRowKey(r)) && !r.already_posted_today);
  const dismissRows = rows.filter((r) => dismissSelected.has(accountingDueRowKey(r)));

  const toggle = (setFn, key) => {
    if (!key) return;
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <SheetShell
      open={open}
      onClose={onClose}
      tall
      title={`${i18n.bankAccountingDue}${rows.length ? ` · ${rows.length}` : ""}`}
      footer={
        <>
          <button
            type="button"
            className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale"
            disabled={busy || dismissRows.length === 0}
            onClick={() => onDismiss?.(dismissRows)}
          >
            {i18n.delete}
          </button>
          <button
            type="button"
            className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
            disabled={busy || selectedRows.length === 0}
            onClick={() => onPost?.(selectedRows)}
          >
            {i18n.bankPostTransaction}
          </button>
        </>
      }
    >
      <div className="m-bp-due-toolbar">
        <button type="button" className="m-bp-action-btn tap-scale" onClick={() => onRefresh?.(false)} disabled={loading || busy}>
          <i className="fas fa-rotate" aria-hidden="true" />
          {i18n.bankRefresh}
        </button>
        <button
          type="button"
          className="m-bp-action-btn tap-scale"
          onClick={() => onRefresh?.(true)}
          disabled={loading || busy}
        >
          <i className="fas fa-clock-rotate-left" aria-hidden="true" />
          {i18n.bankRestoreDismissed}
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="m-mt-state">
          <i className="fas fa-spinner fa-spin" aria-hidden="true" />
          <p>{i18n.loading}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="m-mt-state">
          <i className="fas fa-inbox" aria-hidden="true" />
          <p>{i18n.bankNoDue}</p>
        </div>
      ) : (
        <div className="m-bp-due-list">
          {rows.map((r) => {
            const key = accountingDueRowKey(r);
            const posted = !!r.already_posted_today;
            return (
              <article key={key || `${r.id}-${r.monthly_billing_month}`} className={`m-bp-due-card${posted ? " is-posted" : ""}`}>
                <div className="m-bp-due-card-top">
                  <label className="m-bp-due-check">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      disabled={posted || busy}
                      onChange={() => toggle(setSelected, key)}
                    />
                    <span>{i18n.bankPost}</span>
                  </label>
                  <label className="m-bp-due-check">
                    <input
                      type="checkbox"
                      checked={dismissSelected.has(key)}
                      disabled={busy}
                      onChange={() => toggle(setDismissSelected, key)}
                    />
                    <span>{i18n.delete}</span>
                  </label>
                </div>
                <strong>{r.supplier || r.card_owner || r.bank || "—"}</strong>
                <p className="m-bp-due-meta">
                  {r.bank || "—"} · {formatDueDisplayDate(r.day_start)} →{" "}
                  {formatDueDisplayDate(r.billing_period_start || r.monthly_billing_month)}
                </p>
                {posted ? <span className="m-bp-due-posted">{i18n.bankPostedToday}</span> : null}
              </article>
            );
          })}
          <p className="m-bp-due-foot">
            {(i18n.bankDueAwaiting || "{n} awaiting").replace("{n}", String(postable.length))}
          </p>
        </div>
      )}
    </SheetShell>
  );
}
