import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Reorder, useDragControls } from "framer-motion";
import { useOverlayLock } from "../../hooks/useOverlayLock.js";
import {
  PERIOD_PRESET_KEYS,
  periodPresetRange,
  todayYmd,
} from "../../lib/dashboardDateUtils.js";
import { fetchMobileCurrencyCodes } from "../../lib/dashboardCurrencies.js";
import {
  companiesForPicker as resolveCompaniesForPicker,
  resolveCompanyPickForGroup,
} from "../../lib/dashboardScope.js";
import { dashboardLabel } from "../../translateFile/dashboardTranslate.js";
import ScopeBreadcrumb from "./ScopeBreadcrumb.jsx";
import {
  Pill,
  buildDefaultDraft,
  buildDraftFromDash,
  buildGcScopeIdentity,
  draftGroupOnlyMode,
  resolveDraftCurrencies,
  resolveGroupsAllDraft,
} from "./FilterSheet.jsx";
import "./filter-chips.css";

/**
 * 方案A filter chips — one chip per dimension, each opens a focused mini sheet.
 * Date sheet: preset pills above an inline month calendar (range highlight,
 * today dot, month paging). Scope sheet: search + Group/Company two-pane org
 * picker with an "Active:" badge and Confirm (IG › CX) footer.
 */

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdOf(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function monthCells(year, month) {
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function parseYmdParts(ymd, fallback) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return fallback;
  return { year: Number(m[1]), month: Number(m[2]) - 1 };
}

function monthTitle(year, month, lang) {
  const locale = String(lang).toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
  return new Date(year, month, 1).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

function MiniSheet({ open, onClose, title, children, footer }) {
  useOverlayLock(open, onClose);
  // Portal to <body>: the chips live inside the sticky bar, whose overflow and
  // pull-refresh transform would otherwise hijack the fixed overlay's position
  // and clip the panel.
  return createPortal(
    <div
      className={`m-sheet-overlay m-sheet-overlay--high${
        open ? " m-sheet-overlay--open" : " m-sheet-overlay--closed"
      }`}
      aria-hidden={!open}
      inert={open ? undefined : ""}
    >
      <button type="button" aria-label="Close" onClick={onClose} className="m-sheet-backdrop" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`m-sheet-panel m-fchip-panel${
          open ? " m-sheet-panel--open" : " m-sheet-panel--closed"
        }`}
      >
        <div className="m-sheet-header">
          <h2 className="m-sheet-title">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="m-sheet-close tap-scale">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <div className="m-sheet-body m-fchip-body">{children}</div>
        {footer ? <div className="m-sheet-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

function useChipDraft(dash, open) {
  const [draft, setDraft] = useState(() => buildDraftFromDash(dash));
  useEffect(() => {
    if (open) setDraft(buildDraftFromDash(dash));
    // Re-seed only on open; dash identity churn while closed is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const apply = useCallback(
    (next) => {
      if (typeof dash.applyFilters === "function") void dash.applyFilters(next);
    },
    [dash],
  );
  return [draft, setDraft, apply];
}

/* ── Date chip: presets row + inline range calendar ─────────────────────── */

export function DateFilterChip({ dash, i18n, lang }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft, apply] = useChipDraft(dash, open);
  const [cursor, setCursor] = useState(() => parseYmdParts(dash.dateFrom, parseYmdParts(todayYmd(), { year: new Date().getFullYear(), month: new Date().getMonth() })));
  useOverlayLock(open, () => setOpen(false));

  useEffect(() => {
    if (open) setCursor(parseYmdParts(draft.dateFrom || dash.dateFrom || todayYmd(), parseYmdParts(todayYmd(), { year: new Date().getFullYear(), month: new Date().getMonth() })));
    // Re-anchor the visible month when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const maxDay = todayYmd();
  const cells = monthCells(cursor.year, cursor.month);
  const today = maxDay;

  const pickDay = (ymd) => {
    if (ymd > maxDay) return;
    setDraft((prev) => {
      if (!prev.dateFrom || (prev.dateFrom && prev.dateTo)) {
        return { ...prev, activePreset: "", dateFrom: ymd, dateTo: "" };
      }
      let [s, e] = [prev.dateFrom, ymd];
      if (e < s) [s, e] = [e, s];
      return { ...prev, activePreset: "", dateFrom: s, dateTo: e };
    });
  };

  const shiftMonth = (delta) =>
    setCursor((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const resetWindow = () => {
    const def = buildDefaultDraft(dash);
    setDraft((prev) => ({
      ...prev,
      dateFrom: def.dateFrom,
      dateTo: def.dateTo,
      activePreset: def.activePreset,
    }));
    setCursor(parseYmdParts(def.dateFrom, cursor));
  };

  return (
    <>
      <button type="button" className="m-fchip tap-scale" onClick={() => setOpen(true)}>
        <i className="far fa-calendar m-fchip-icon" aria-hidden="true" />
        <span className="m-fchip-value">{dash.dateRangeText}</span>
        <i className="fas fa-chevron-down m-fchip-caret" aria-hidden="true" />
      </button>

      <MiniSheet
        open={open}
        onClose={() => setOpen(false)}
        title={i18n.dateRange || "Date"}
        footer={
          <>
            <button
              type="button"
              className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale"
              onClick={resetWindow}
            >
              {i18n.reset || "Reset"}
            </button>
            <button
              type="button"
              className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale"
              onClick={() => setOpen(false)}
            >
              {i18n.cancel || "Cancel"}
            </button>
            <button
              type="button"
              className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
              onClick={() => {
                apply(draft);
                setOpen(false);
              }}
            >
              {i18n.applyFilter}
            </button>
          </>
        }
      >
        <div className="m-filter-pill-scroll">
          {PERIOD_PRESET_KEYS.map((key) => (
            <Pill
              key={key}
              active={draft.activePreset === key}
              onClick={() => {
                const range = periodPresetRange(key);
                if (!range) return;
                setDraft((prev) => ({
                  ...prev,
                  activePreset: key,
                  dateFrom: range.dateFrom,
                  dateTo: range.dateTo,
                }));
                setCursor(parseYmdParts(range.dateFrom, cursor));
              }}
            >
              {dashboardLabel(i18n, key)}
            </Pill>
          ))}
        </div>

        <div className="m-fchip-cal">
          <div className="m-fchip-cal-head">
            <button
              type="button"
              className="m-fchip-cal-nav tap-scale"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              <i className="fas fa-chevron-left" aria-hidden="true" />
            </button>
            <span className="m-fchip-cal-title">{monthTitle(cursor.year, cursor.month, dash.lang || lang || "en")}</span>
            <button
              type="button"
              className="m-fchip-cal-nav tap-scale"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              <i className="fas fa-chevron-right" aria-hidden="true" />
            </button>
          </div>

          <div className="m-fchip-cal-grid m-fchip-cal-weekdays">
            {WEEKDAY_LABELS.map((d) => (
              <span key={d} className="m-fchip-cal-wd">
                {d}
              </span>
            ))}
          </div>

          <div className="m-fchip-cal-grid">
            {cells.map((day, idx) => {
              if (day == null) return <span key={`pad-${idx}`} />;
              const ymd = ymdOf(cursor.year, cursor.month, day);
              const isEdge = ymd === draft.dateFrom || ymd === draft.dateTo;
              const isInRange =
                draft.dateFrom && draft.dateTo && ymd > draft.dateFrom && ymd < draft.dateTo;
              const isToday = ymd === today;
              const isFuture = ymd > maxDay;
              return (
                <button
                  key={ymd}
                  type="button"
                  disabled={isFuture}
                  className={[
                    "m-fchip-cal-day",
                    isEdge ? " is-edge" : "",
                    isInRange ? " is-inrange" : "",
                    isToday ? " is-today" : "",
                    isFuture ? " is-off" : "",
                  ]
                    .join("")
                    .trim()}
                  onClick={() => pickDay(ymd)}
                >
                  {day}
                  {isToday ? <span className="m-fchip-cal-todaydot" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </MiniSheet>
    </>
  );
}

/** Long-press (260ms) to lift a currency pill, then drag to reorder.
    A quick tap still selects; the row still scrolls from the gaps. */
function DraggableCurrencyPill({ code, active, disabled, onSelect, onDragEndPersist }) {
  const controls = useDragControls();
  const holdTimer = useRef(null);
  const draggedRef = useRef(false);

  const startHold = (e) => {
    if (disabled) return;
    draggedRef.current = false;
    holdTimer.current = setTimeout(() => {
      draggedRef.current = true;
      controls.start(e);
    }, 260);
  };
  const cancelHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  return (
    <Reorder.Item
      value={code}
      dragListener={false}
      dragControls={controls}
      className="m-fchip-reorder-item"
      whileDrag={{ scale: 1.08 }}
      onDragStart={() => {
        draggedRef.current = true;
      }}
      onDragEnd={() => {
        cancelHold();
        onDragEndPersist?.();
      }}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
    >
      <button
        type="button"
        disabled={disabled}
        aria-pressed={active}
        className={`m-filter-pill${active ? " m-filter-pill--active" : ""} m-fchip-currency-pill tap-scale`}
        onClick={() => {
          if (!draggedRef.current) onSelect();
        }}
      >
        {code}
      </button>
    </Reorder.Item>
  );
}

/* ── Scope chip: Group/Company two-pane org picker ─────────────────────────── */

function scopeShortLabel(dash, draft) {
  const group = String(draft.selectedGroup || "").toUpperCase();
  const row = dash.companies?.find((c) => Number(c.id) === Number(draft.companyId));
  const code = String(row?.company_id || "").toUpperCase();
  if (draft.groupsAllMode) return `${i18nAll(dash)} › ${code || i18nAll(dash)}`;
  if (draft.groupAllMode) return `${group} › ${i18nAll(dash)}`;
  if (group && !code) return group;
  return `${group || i18nAll(dash)} › ${code || i18nAll(dash)}`;
}

function i18nAll(dash) {
  return String(dash?.i18n?.all || "All").toUpperCase();
}

export function ScopeFilterChip({ dash, i18n, groupId, companyCode, groupOnlyMode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft, apply] = useChipDraft(dash, open);
  const [draftCurrencies, setDraftCurrencies] = useState(() => resolveDraftCurrencies(dash));
  const appliedGcIdentityRef = useRef("");
  const txMode = Array.isArray(dash.categories);
  useOverlayLock(open, () => setOpen(false));

  const scopeEmpty =
    !groupId && !companyCode && !dash.groupsAllMode && !dash.groupAllMode && !groupOnlyMode;

  useEffect(() => {
    if (!open) return undefined;
    const next = buildDraftFromDash(dash);
    setDraft(next);
    appliedGcIdentityRef.current = buildGcScopeIdentity(next);
    // Seed from the company's full currency list (sync) so the pills are never
    // reduced to a single code while the scope fetch is in flight or aborted.
    setDraftCurrencies(
      Array.isArray(dash.currencies) && dash.currencies.length
        ? [...dash.currencies]
        : resolveDraftCurrencies(dash),
    );
    // Re-seed only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Currency codes follow the draft Group/Company (parity with FilterSheet).
  useEffect(() => {
    if (!open) return undefined;
    const companies = Array.isArray(dash.companies) ? dash.companies : [];
    if (!companies.length) return undefined;

    const hasCompany = Number.isFinite(Number(draft.companyId)) && Number(draft.companyId) > 0;
    const groupOnly = draftGroupOnlyMode(draft);
    if (!hasCompany && !groupOnly && !draft.groupsAllMode && !draft.groupAllMode) {
      return undefined;
    }

    const draftIdentity = buildGcScopeIdentity(draft);
    const scopeChanged =
      Boolean(appliedGcIdentityRef.current) && appliedGcIdentityRef.current !== draftIdentity;
    const ac = new AbortController();

    (async () => {
      try {
        const codes = await fetchMobileCurrencyCodes({
          companyId: draft.companyId,
          selectedGroup: draft.selectedGroup,
          groupAllMode: draft.groupAllMode,
          groupsAllMode: draft.groupsAllMode,
          companies,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        const next = codes.length ? codes : ["MYR"];
        setDraftCurrencies(next);
        if (scopeChanged) {
          const first = next[0] || "MYR";
          setDraft((prev) =>
            txMode
              ? { ...prev, selectedCurrencies: [first], currency: first }
              : { ...prev, currency: first },
          );
        } else {
          setDraft((prev) => {
            const prevCode = String(prev.currency || "").toUpperCase();
            if (txMode) {
              const kept = (prev.selectedCurrencies || [])
                .map((c) => String(c || "").toUpperCase())
                .filter((c) => next.includes(c));
              return kept.length
                ? prev
                : { ...prev, selectedCurrencies: [next[0] || "MYR"], currency: next[0] || "MYR" };
            }
            return next.includes(prevCode) ? prev : { ...prev, currency: next[0] || "MYR" };
          });
        }
      } catch (e) {
        if (e?.name !== "AbortError") {
          setDraftCurrencies((prev) => (prev.length ? prev : ["MYR"]));
        }
      }
    })();

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    dash.companies,
    dash.categories,
    draft.companyId,
    draft.selectedGroup,
    draft.groupAllMode,
    draft.groupsAllMode,
  ]);

  const canUseGroupOnly = dash.canUseGroupOnlyForGroup || (() => false);
  const showGroupOnlyHint = dash.groupIds?.some((gid) => canUseGroupOnly(gid));
  const groupOnlyDraft = draftGroupOnlyMode(draft);

  const groupList = dash.groupIds || [];
  const companiesForPicker = resolveCompaniesForPicker(dash.companies, {
    selectedGroup: draft.selectedGroup,
    groupsAllMode: draft.groupsAllMode,
    preferredCompanyId: draft.companyId,
  });
  const companyList = companiesForPicker;
  const companiesInGroup = (gid) =>
    (dash.companies || []).filter((c) => String(c.group_id || "").trim().toUpperCase() === gid)
      .length;

  const activeLabel = scopeShortLabel(dash, draft);
  const confirmLabel = activeLabel;

  const draftCurrenciesRef = useRef(draftCurrencies);
  draftCurrenciesRef.current = draftCurrencies;
  const persistCurrencyOrder = useCallback(() => {
    const order = draftCurrenciesRef.current;
    if (!Array.isArray(order) || !order.length) return;
    persistUserCurrencyDisplayOrder(order);
    const cid = Number(draft.companyId) > 0 ? Number(draft.companyId) : null;
    if (cid != null) persistCurrencyDisplayOrder(cid, order);
    saveUserCurrencyOrder(order, {
      companyId: cid != null ? cid : undefined,
      groupId: cid == null ? String(draft.selectedGroup || "").toUpperCase() : undefined,
    }).catch(() => {
      /* localStorage mirrors already updated */
    });
  }, [draft.companyId, draft.selectedGroup]);

  const handleCurrencyReorder = useCallback(
    (nextOrder) => {
      if (Array.isArray(nextOrder) && nextOrder.length) setDraftCurrencies(nextOrder);
    },
    [],
  );

  return (
    <>
      <button type="button" className="m-fchip tap-scale" onClick={() => setOpen(true)}>
        <span className="m-fchip-value">
          {scopeEmpty ? (
            <span className="m-scope-text m-scope-text--muted">{i18n.all}</span>
          ) : (
            <ScopeBreadcrumb
              i18n={i18n}
              groupId={groupId}
              companyCode={companyCode}
              groupsAllMode={dash.groupsAllMode}
              groupAllMode={dash.groupAllMode}
              groupOnlyMode={groupOnlyMode}
            />
          )}
        </span>
        <i className="fas fa-chevron-down m-fchip-caret" aria-hidden="true" />
      </button>

      <MiniSheet
        open={open}
        onClose={() => setOpen(false)}
        title={String(i18n.company || "Scope").replace(/:\s*$/, "")}
        footer={
          <>
            <button
              type="button"
              className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale"
              onClick={() => setOpen(false)}
            >
              {i18n.cancel || "Close"}
            </button>
            <button
              type="button"
              className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
              onClick={() => {
                apply(draft);
                setOpen(false);
              }}
            >
              {i18n.confirm || "Confirm"} ({confirmLabel})
            </button>
          </>
        }
      >
        <div className="m-fchip-org">
          <section className="m-fchip-pane">
            <h4 className="m-fchip-pane-title">
              <i className="fas fa-layer-group" aria-hidden="true" /> {i18n.groupId}
            </h4>
            <div className="m-fchip-pane-list">
              <button
                type="button"
                className={`m-fchip-org-row${draft.groupsAllMode ? " is-selected" : ""}`}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    ...resolveGroupsAllDraft(dash, prev),
                  }))
                }
              >
                <span className="m-fchip-org-avatar" aria-hidden="true">
                  <i className="fas fa-globe" />
                </span>
                <span className="m-fchip-org-main">
                  <strong>{i18n.all}</strong>
                </span>
                {draft.groupsAllMode ? (
                  <i className="fas fa-check m-fchip-org-check" aria-hidden="true" />
                ) : null}
              </button>

              {groupList.map((gid) => (
                <button
                  key={gid}
                  type="button"
                  className={`m-fchip-org-row${
                    draft.selectedGroup === gid && !draft.groupsAllMode ? " is-selected" : ""
                  }`}
                  onClick={() => {
                    const patch = pickGroupPatch(dash, draft, gid);
                    if (patch) setDraft(patch);
                  }}
                >
                  <span className="m-fchip-org-avatar" aria-hidden="true">
                    {gid.slice(0, 2)}
                  </span>
                  <span className="m-fchip-org-main">
                    <strong>{gid}</strong>
                  </span>
                  <span className="m-fchip-org-count">{companiesInGroup(gid)}</span>
                </button>
              ))}

              {groupList.length === 0 ? <p className="m-fchip-hint">—</p> : null}
            </div>
          </section>

          <section className="m-fchip-pane">
            <h4 className="m-fchip-pane-title">
              <i className="fas fa-building" aria-hidden="true" /> {i18n.company}
            </h4>
            <div className="m-fchip-pane-list">
              {companiesForPicker.length > 1 || draft.selectedGroup || draft.groupsAllMode ? (
                <button
                  type="button"
                  className={`m-fchip-org-row${draft.groupAllMode ? " is-selected" : ""}`}
                  disabled={!draft.selectedGroup && !draft.groupsAllMode}
                  onClick={() =>
                    setDraft((prev) => {
                      if (prev.groupsAllMode) {
                        return { ...prev, groupAllMode: true, selectedGroup: null, companyId: null };
                      }
                      return {
                        ...prev,
                        groupAllMode: true,
                        groupsAllMode: false,
                        companyId:
                          Number.isFinite(Number(prev.companyId)) && Number(prev.companyId) > 0
                            ? prev.companyId
                            : (resolveCompanyPickForGroup(
                                dash.companies,
                                prev.selectedGroup,
                                prev.companyId,
                              )?.id ?? null),
                      };
                    })
                  }
                >
                  <span className="m-fchip-org-avatar" aria-hidden="true">
                    <i className="fas fa-border-all" />
                  </span>
                  <span className="m-fchip-org-main">
                    <strong>{i18n.all}</strong>
                  </span>
                  {draft.groupAllMode ? (
                    <i className="fas fa-check m-fchip-org-check" aria-hidden="true" />
                  ) : null}
                </button>
              ) : null}

              {companyList.map((c) => {
                const label = String(c.company_id || c.name || c.id).toUpperCase();
                const active =
                  !draft.groupAllMode &&
                  !groupOnlyDraft &&
                  Number(draft.companyId) === Number(c.id);
                const name = String(c.name || "").trim();
                return (
                  <button
                    key={label}
                    type="button"
                    className={`m-fchip-org-row${active ? " is-selected" : ""}`}
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        groupAllMode: false,
                        groupsAllMode: false,
                        companyId: c.id,
                        selectedGroup:
                          prev.selectedGroup ||
                          (c.group_id ? String(c.group_id).trim().toUpperCase() : null),
                      }))
                    }
                  >
                    <span className="m-fchip-org-avatar" aria-hidden="true">
                      {label.slice(0, 2)}
                    </span>
                    <span className="m-fchip-org-main">
                      <strong>{label}</strong>
                      {name && name.toUpperCase() !== label ? <small>{name}</small> : null}
                    </span>
                    {active ? (
                      <i className="fas fa-check m-fchip-org-check" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}

              {companyList.length === 0 ? (
                <p className="m-fchip-hint">
                  {i18n.groupCompanyHint || "Pick a group first"}
                </p>
              ) : null}
            </div>
          </section>
        </div>

        {draftCurrencies.length > 0 && (
          <section className="m-fchip-block">
            <h4 className="m-fchip-block-title">
              <i className="fas fa-coins" aria-hidden="true" /> {i18n.currency}
            </h4>
            <Reorder.Group
              axis="x"
              as="div"
              values={draftCurrencies}
              onReorder={handleCurrencyReorder}
              className="m-filter-pill-scroll m-fchip-currency-row"
            >
              {txMode
                ? draftCurrencies.map((code) => (
                    <DraggableCurrencyPill
                      key={code}
                      code={code}
                      active={draft.selectedCurrencies.includes(code)}
                      onSelect={() =>
                        setDraft((prev) => {
                          const set = new Set(prev.selectedCurrencies);
                          if (set.has(code)) {
                            if (set.size <= 1) return prev; // keep ≥1 currency
                            set.delete(code);
                          } else {
                            set.add(code);
                          }
                          const next = [...set];
                          return { ...prev, selectedCurrencies: next, currency: next[0] || code };
                        })
                      }
                      onDragEndPersist={persistCurrencyOrder}
                    />
                  ))
                : draftCurrencies.map((code) => (
                    <DraggableCurrencyPill
                      key={code}
                      code={code}
                      active={draft.currency === code}
                      onSelect={() => setDraft((prev) => ({ ...prev, currency: code }))}
                      onDragEndPersist={persistCurrencyOrder}
                    />
                  ))}
            </Reorder.Group>
            <p className="m-fchip-hint">
              {i18n.currencyReorderHint || "Long-press a currency to reorder"}
            </p>
          </section>
        )}
      </MiniSheet>
    </>
  );
}

function pickGroupPatch(dash, draft, gid) {
  const group = String(gid || "").trim().toUpperCase();
  if (!group) return null;
  const allowGroupOnly = (dash.canUseGroupOnlyForGroup || (() => false))(group);
  const pick = allowGroupOnly
    ? null
    : resolveCompanyPickForGroup(dash.companies, group, draft.companyId);
  return {
    ...draft,
    selectedGroup: group,
    groupsAllMode: false,
    groupAllMode: false,
    companyId: allowGroupOnly ? null : (pick?.id ?? draft.companyId),
  };
}

export function CategoryFilterChip({ dash, i18n }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft, apply] = useChipDraft(dash, open);
  useOverlayLock(open, () => setOpen(false));

  const categories = useMemo(() => {
    if (!Array.isArray(dash.categories)) return [];
    return dash.categories
      .map((cat) => {
        const value =
          typeof cat === "string" ? cat.trim() : String(cat?.value ?? cat?.id ?? cat?.name ?? "").trim();
        const label =
          typeof cat === "string" ? value : String(cat?.label ?? cat?.name ?? value).trim() || value;
        return { value, label };
      })
      .filter((c) => c.value);
  }, [dash.categories]);

  const selected = draft.selectedCategories || [];
  const chipLabel = selected.length
    ? `${dash.m?.category || i18n.category || "Category"} · ${selected.length}`
    : dash.m?.category || i18n.category || "Category";

  if (!categories.length) return null;

  return (
    <>
      <button type="button" className="m-fchip tap-scale" onClick={() => setOpen(true)}>
        <i className="fas fa-tags m-fchip-icon" aria-hidden="true" />
        <span className="m-fchip-value">{chipLabel}</span>
        <i className="fas fa-chevron-down m-fchip-caret" aria-hidden="true" />
      </button>

      <MiniSheet
        open={open}
        onClose={() => setOpen(false)}
        title={dash.m?.category || i18n.category || "Category"}
        footer={
          <button
            type="button"
            className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale"
            onClick={() => {
              apply(draft);
              setOpen(false);
            }}
          >
            {i18n.applyFilter}
          </button>
        }
      >
        <div className="m-filter-pill-wrap">
          <Pill
            active={selected.length === 0}
            onClick={() => setDraft((prev) => ({ ...prev, selectedCategories: [] }))}
          >
            {i18n.all}
          </Pill>
          {categories.map((cat) => {
            const active = selected.includes(cat.value);
            return (
              <Pill
                key={cat.value}
                active={active}
                onClick={() =>
                  setDraft((prev) => {
                    const has = prev.selectedCategories.includes(cat.value);
                    return {
                      ...prev,
                      selectedCategories: has
                        ? prev.selectedCategories.filter((x) => x !== cat.value)
                        : [...prev.selectedCategories, cat.value],
                    };
                  })
                }
              >
                {cat.label}
              </Pill>
            );
          })}
        </div>
      </MiniSheet>
    </>
  );
}

