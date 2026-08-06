import { useEffect, useState } from "react";
import { useOverlayLock } from "../../hooks/useOverlayLock.js";
import {
  BANK_PICK_ACCOUNT_ROLES,
  createBankPickAccount,
  fetchAccountRoles,
} from "../../lib/bankProcessApi.js";

/**
 * Nested quick-create account for Bank Process form fields.
 */
export function BankProcessAccountQuickSheet({
  open,
  onClose,
  i18n,
  companyId,
  busy = false,
  onBusy,
  onCreated,
  onError,
}) {
  useOverlayLock(open, onClose);
  const [roles, setRoles] = useState([...BANK_PICK_ACCOUNT_ROLES]);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) return;
    setAccountId("");
    setName("");
    setRole("");
    setPassword("");
    const ac = new AbortController();
    (async () => {
      try {
        const list = await fetchAccountRoles({ companyId, signal: ac.signal });
        if (!ac.signal.aborted) setRoles(list);
      } catch {
        if (!ac.signal.aborted) setRoles([...BANK_PICK_ACCOUNT_ROLES]);
      }
    })();
    return () => ac.abort();
  }, [open, companyId]);

  const handleSave = async () => {
    if (busy) return;
    if (!accountId.trim() || !name.trim() || !role.trim() || !password.trim()) {
      onError?.(i18n.bankAccountRequired);
      return;
    }
    onBusy?.(true);
    try {
      const created = await createBankPickAccount({
        companyId,
        accountId,
        name,
        role,
        password,
      });
      onCreated?.(created);
      onClose?.();
    } catch (e) {
      onError?.(e?.message || i18n.bankAccountCreateFailed);
    } finally {
      onBusy?.(false);
    }
  };

  return (
    <div
      className={`m-sheet-overlay m-bp-ps-overlay${open ? " m-sheet-overlay--open" : " m-sheet-overlay--closed"}`}
      aria-hidden={!open}
      inert={open ? undefined : ""}
    >
      <button type="button" className="m-sheet-backdrop" onClick={onClose} aria-label="Close" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={i18n.bankAddAccountTitle}
        className={`m-sheet-panel${open ? " m-sheet-panel--open" : " m-sheet-panel--closed"}`}
      >
        <div className="m-sheet-handle-wrap" aria-hidden="true">
          <span className="m-sheet-handle" />
        </div>
        <header className="m-sheet-header">
          <h2 className="m-sheet-title">{i18n.bankAddAccountTitle}</h2>
          <button type="button" className="m-sheet-close tap-scale" onClick={onClose} aria-label="Close">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </header>
        <div className="m-sheet-body m-sheet-body--spaced">
          <label className="m-bp-field">
            <span>{i18n.bankAccountId}</span>
            <input
              type="text"
              autoCapitalize="characters"
              value={accountId}
              onChange={(e) => setAccountId(String(e.target.value).toUpperCase())}
            />
          </label>
          <label className="m-bp-field">
            <span>{i18n.bankAccountName}</span>
            <input
              type="text"
              autoCapitalize="characters"
              value={name}
              onChange={(e) => setName(String(e.target.value).toUpperCase())}
            />
          </label>
          <label className="m-bp-field">
            <span>{i18n.bankAccountRole}</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{i18n.bankSelectRole}</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="m-bp-field">
            <span>{i18n.bankAccountPassword}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>
        <div className="m-sheet-footer">
          <button type="button" className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale" onClick={onClose}>
            {i18n.cancel}
          </button>
          <button
            type="button"
            className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
            disabled={busy}
            onClick={() => void handleSave()}
          >
            {i18n.save}
          </button>
        </div>
      </section>
    </div>
  );
}
