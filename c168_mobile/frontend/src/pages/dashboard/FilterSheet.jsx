import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOverlayLock } from "../../hooks/useOverlayLock.js";
import {
  PERIOD_PRESET_KEYS,
  daysInclusive,
  defaultDashboardDateRange,
  formatDisplayDate,
  formatYmd,
  parseYmd,
  periodPresetRange,
  todayYmd,
} from "../../lib/dashboardDateUtils.js";
import { companiesForPicker as resolveCompaniesForPicker, pickCompany, resolveCompanyPickForGroup } from "../../lib/dashboardScope.js";
import { dashboardLabel } from "../../translateFile/dashboardTranslate.js";

export function Pill({ active, disabled, onClick, block, tone = "blue", children }) {
  const activeMod =
    tone === "violet" ? "m-filter-pill--active-violet" : "m-filter-pill--active-blue";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`m-filter-pill tap-scale${block ? " m-filter-pill--block" : " m-filter-pill--inline"}${
        active ? ` ${activeMod}` : ""
      }`}
    >
      {children}
    </button>
  );
}

export function Section({ title, trailing, children }) {
  return (
    <div className="m-filter-section">
      <div className="m-filter-section-head">
        <p className="m-filter-section-title">{title}</p>
        {trailing}
      </div>
      {children}
    </div>
  );
}

export function DateRangeRow({ fromLabel, toLabel, dateFrom, dateTo, active, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`m-filter-range-row tap-scale${active ? " m-filter-range-row--active" : ""}`}
      aria-label={`${fromLabel} ${dateFrom ? formatDisplayDate(dateFrom) : "—"} · ${toLabel} ${dateTo ? formatDisplayDate(dateTo) : "—"}`}
    >
      <span className="m-filter-range-icon">
        <i className="far fa-calendar" aria-hidden="true" />
      </span>
      <span className="m-filter-range-fields">
        <span className="m-filter-range-field">
          <span className="m-filter-range-label">{fromLabel}</span>
          <span className="m-filter-range-value">{dateFrom ? formatDisplayDate(dateFrom) : "—"}</span>
        </span>
        <span className="m-filter-range-field">
          <span className="m-filter-range-label">{toLabel}</span>
          <span className="m-filter-range-value">{dateTo ? formatDisplayDate(dateTo) : "—"}</span>
        </span>
      </span>
      <span className="m-filter-range-chevron">
        <i className="fas fa-chevron-right" aria-hidden="true" />
      </span>
    </button>
  );
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function buildMonthCells(year, month) {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function cmpYmd(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function inRangeYmd(day, from, to) {
  if (!day || !from || !to) return false;
  const lo = cmpYmd(from, to) <= 0 ? from : to;
  const hi = cmpYmd(from, to) <= 0 ? to : from;
  return cmpYmd(day, lo) >= 0 && cmpYmd(day, hi) <= 0;
}

function buildDraftFromDash(dash) {
  return {
    dateFrom: dash.dateFrom,
    dateTo: dash.dateTo,
    activePreset: dash.activePreset || "",
    selectedGroup: dash.selectedGroup,
    groupsAllMode: dash.groupsAllMode,
    groupAllMode: dash.groupAllMode,
    companyId: dash.companyId,
    currency: dash.currency,
    selectedCategories: Array.isArray(dash.selectedCategories) ? [...dash.selectedCategories] : [],
  };
}

function buildDefaultDraft(dash) {
  const range = periodPresetRange("thisYear") || defaultDashboardDateRange();
  const fallback = pickCompany(dash.companies, dash.me?.company_id);
  return {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    activePreset: "thisYear",
    selectedGroup: null,
    groupsAllMode: false,
    groupAllMode: false,
    companyId: fallback?.id ?? null,
    currency: dash.currencies?.[0] || dash.currency || "MYR",
    selectedCategories: [],
  };
}

function draftGroupOnlyMode(draft) {
  const hasCompany = Number.isFinite(Number(draft.companyId)) && Number(draft.companyId) > 0;
  return Boolean(draft.selectedGroup && !draft.groupAllMode && !draft.groupsAllMode && !hasCompany);
}

export function DateRangeCalendarSheet({ open, onClose, dateFrom, dateTo, maxYmd, labels, onApply }) {
  const [cursor, setCursor] = useState(() => parseYmd(dateFrom || maxYmd || todayYmd()));
  const [draftFrom, setDraftFrom] = useState(dateFrom || "");
  const [draftTo, setDraftTo] = useState(dateTo || "");
  const [picking, setPicking] = useState("start");

  useEffect(() => {
    if (!open) return;
    setDraftFrom(dateFrom || "");
    setDraftTo(dateTo || "");
    setPicking("start");
    setCursor(parseYmd(dateFrom || maxYmd || todayYmd()));
  }, [open, dateFrom, dateTo, maxYmd]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);
  const monthLabel = cursor.toLocaleString("en", { month: "long", year: "numeric" });

  const commitRange = (from, to) => {
    if (!from || !to) return;
    let lo = from;
    let hi = to;
    if (cmpYmd(hi, lo) < 0) {
      const tmp = lo;
      lo = hi;
      hi = tmp;
    }
    onApply?.(lo, hi);
    onClose?.();
  };

  const pickDay = (dayNum) => {
    if (!dayNum) return;
    const ymd = formatYmd(new Date(year, month, dayNum));
    if (maxYmd && cmpYmd(ymd, maxYmd) > 0) return;

    if (picking === "start" || !draftFrom) {
      setDraftFrom(ymd);
      setDraftTo("");
      setPicking("end");
      return;
    }

    commitRange(draftFrom, ymd);
  };

  const shiftMonth = (delta) => {
    setCursor(new Date(year, month + delta, 1));
  };

  if (!open) return null;

  return (
    <div className="m-sheet-host-flex">
      <button type="button" className="m-sheet-backdrop m-sheet-backdrop--light" aria-label={labels.close} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={labels.selectDateRange}
        className="m-sheet-panel m-sheet-panel--calendar"
      >
        <div className="m-filter-cal-header">
          <div className="min-w-0">
            <p className="m-filter-cal-title">{labels.selectDateRange}</p>
            <p className="m-filter-cal-hint">{labels.rangePickHint}</p>
          </div>
          <button type="button" onClick={onClose} className="m-sheet-close m-sheet-close--square tap-scale" aria-label={labels.close}>
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>

        <div className="m-filter-cal-body">
          <div className="m-filter-cal-draft-grid">
            <div className={`m-filter-cal-draft${picking === "start" ? " m-filter-cal-draft--active" : ""}`}>
              <p className="m-filter-cal-draft-label">{labels.from}</p>
              <p className="m-filter-cal-draft-value">{draftFrom ? formatDisplayDate(draftFrom) : "—"}</p>
            </div>
            <div className={`m-filter-cal-draft${picking === "end" ? " m-filter-cal-draft--active" : ""}`}>
              <p className="m-filter-cal-draft-label">{labels.toDate}</p>
              <p className="m-filter-cal-draft-value">{draftTo ? formatDisplayDate(draftTo) : "—"}</p>
            </div>
          </div>

          <div className="m-filter-cal-nav">
            <button type="button" onClick={() => shiftMonth(-1)} className="m-filter-cal-nav-btn tap-scale" aria-label="Previous month">
              <i className="fas fa-chevron-left" aria-hidden="true" />
            </button>
            <p className="m-filter-cal-month">{monthLabel}</p>
            <button type="button" onClick={() => shiftMonth(1)} className="m-filter-cal-nav-btn tap-scale" aria-label="Next month">
              <i className="fas fa-chevron-right" aria-hidden="true" />
            </button>
          </div>

          <div className="m-filter-cal-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w} className="m-filter-cal-weekday">
                {w}
              </span>
            ))}
          </div>
          <div className="m-filter-cal-grid">
            {cells.map((dayNum, idx) => {
              if (!dayNum) return <span key={`e-${idx}`} />;
              const ymd = formatYmd(new Date(year, month, dayNum));
              const disabled = Boolean(maxYmd && cmpYmd(ymd, maxYmd) > 0);
              const isStart = draftFrom && ymd === draftFrom;
              const isEnd = draftTo && ymd === draftTo;
              const inMid = draftFrom && draftTo && inRangeYmd(ymd, draftFrom, draftTo) && !isStart && !isEnd;
              let dayMod = "";
              if (disabled) dayMod = " m-filter-cal-day--disabled";
              else if (isStart || isEnd) dayMod = " m-filter-cal-day--edge";
              else if (inMid) dayMod = " m-filter-cal-day--mid";
              return (
                <button
                  key={ymd}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickDay(dayNum)}
                  className={`m-filter-cal-day tap-scale${dayMod}`}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>
        </div>

        <div className="m-filter-cal-footer">
          <button
            type="button"
            onClick={() => {
              setDraftFrom("");
              setDraftTo("");
              setPicking("start");
            }}
            className="m-filter-cal-footer-btn tap-scale"
          >
            {labels.clear}
          </button>
          <button
            type="button"
            onClick={() => {
              const t = maxYmd || todayYmd();
              commitRange(t, t);
            }}
            className="m-filter-cal-footer-btn tap-scale"
          >
            {labels.today}
          </button>
          <button
            type="button"
            disabled={!draftFrom || !draftTo}
            onClick={() => commitRange(draftFrom, draftTo)}
            className="m-filter-cal-footer-btn m-filter-cal-footer-btn--primary tap-scale"
          >
            {labels.done}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FilterSheet({ open, onClose, dash }) {
  const { i18n } = dash;
  const bodyRef = useRef(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [draft, setDraft] = useState(() => buildDraftFromDash(dash));
  useOverlayLock(open, onClose);

  useEffect(() => {
    if (!open) {
      setRangeOpen(false);
      return;
    }
    setDraft(buildDraftFromDash(dash));
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [open]);

  const canUseGroupOnly = dash.canUseGroupOnlyForGroup || (() => false);

  const companiesForPicker = useMemo(
    () =>
      resolveCompaniesForPicker(dash.companies, {
        selectedGroup: draft.selectedGroup,
        groupsAllMode: draft.groupsAllMode,
        preferredCompanyId: draft.companyId,
      }),
    [dash.companies, draft.selectedGroup, draft.groupsAllMode, draft.companyId],
  );

  const pickDraftGroup = useCallback(
    (gid) => {
      const group = String(gid || "").trim().toUpperCase();
      if (!group) return;
      const allowGroupOnly = canUseGroupOnly(group);
      const pick = allowGroupOnly ? null : resolveCompanyPickForGroup(dash.companies, group, draft.companyId);
      setDraft((prev) => ({
        ...prev,
        selectedGroup: group,
        groupsAllMode: false,
        groupAllMode: false,
        companyId: allowGroupOnly ? null : (pick?.id ?? prev.companyId),
      }));
    },
    [canUseGroupOnly, dash.companies, draft.companyId],
  );

  const handleReset = () => {
    setDraft(buildDefaultDraft(dash));
  };

  const handleApply = () => {
    if (typeof dash.applyFilters === "function") {
      void dash.applyFilters(draft);
    }
    onClose?.();
  };

  const maxDay = todayYmd();
  const span = daysInclusive(draft.dateFrom, draft.dateTo);
  const daysLabel = (i18n.daysCount || "{n} days").replace("{n}", String(span));
  const groupOnlyDraft = draftGroupOnlyMode(draft);
  const showGroupOnlyHint = dash.groupIds?.some((gid) => canUseGroupOnly(gid));

  return (
    <div
      className={`m-sheet-overlay${open ? " m-sheet-overlay--open" : " m-sheet-overlay--closed"}`}
      aria-hidden={!open}
      inert={open ? undefined : ""}
    >
      <button type="button" aria-label="Close filter" onClick={onClose} className="m-sheet-backdrop" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={i18n.filter}
        className={`m-sheet-panel${open ? " m-sheet-panel--open" : " m-sheet-panel--closed"}`}
      >
        <div className="m-sheet-handle-wrap" aria-hidden="true">
          <span className="m-sheet-handle" />
        </div>

        <div className="m-sheet-header">
          <h2 className="m-sheet-title">{i18n.filter}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="m-sheet-close tap-scale">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div ref={bodyRef} className="m-sheet-body m-sheet-body--spaced">
          <Section
            title={i18n.dateRange}
            trailing={
              span > 0 ? (
                <span
                  className={`m-filter-span-badge${
                    draft.activePreset ? " m-filter-span-badge--preset" : " m-filter-span-badge--custom"
                  }`}
                >
                  {draft.activePreset ? daysLabel : `${i18n.customRange} · ${daysLabel}`}
                </span>
              ) : null
            }
          >
            <DateRangeRow
              fromLabel={i18n.from}
              toLabel={i18n.toDate}
              dateFrom={draft.dateFrom}
              dateTo={draft.dateTo}
              active={rangeOpen}
              onOpen={() => setRangeOpen(true)}
            />
          </Section>

          <Section title={i18n.quickSelect}>
            <div className="m-filter-pill-wrap">
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
                  }}
                >
                  {dashboardLabel(i18n, key)}
                </Pill>
              ))}
            </div>
          </Section>

          {dash.groupIds.length > 0 && (
            <Section title={i18n.groupId}>
              <div className="m-filter-pill-wrap">
                <Pill
                  tone="violet"
                  active={draft.groupsAllMode}
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      groupsAllMode: true,
                      groupAllMode: false,
                      selectedGroup: null,
                      companyId: null,
                    }))
                  }
                >
                  {i18n.all}
                </Pill>
                {dash.groupIds.map((gid) => (
                  <Pill
                    key={gid}
                    tone="violet"
                    active={draft.selectedGroup === gid && !draft.groupsAllMode}
                    onClick={() => pickDraftGroup(gid)}
                  >
                    {gid}
                  </Pill>
                ))}
              </div>
              <p className="m-filter-hint">
                {showGroupOnlyHint
                  ? i18n.groupHint || "Tap a group for group-only · Company All aggregates companies"
                  : i18n.groupCompanyHint || "Pick a group, then choose a company"}
              </p>
            </Section>
          )}

          <Section title={i18n.company}>
            <div className="m-filter-pill-wrap">
              {(companiesForPicker.length > 1 || draft.selectedGroup) && (
                <Pill
                  active={draft.groupAllMode}
                  disabled={!draft.selectedGroup || draft.groupsAllMode}
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      groupAllMode: true,
                      groupsAllMode: false,
                      companyId:
                        Number.isFinite(Number(prev.companyId)) && Number(prev.companyId) > 0
                          ? prev.companyId
                          : (resolveCompanyPickForGroup(dash.companies, prev.selectedGroup, prev.companyId)?.id ??
                            null),
                    }))
                  }
                >
                  {i18n.all}
                </Pill>
              )}
              {companiesForPicker.map((c) => {
                const label = String(c.company_id || c.name || c.id).toUpperCase();
                const draftRow = dash.companies.find((row) => Number(row.id) === Number(draft.companyId));
                const draftCode = String(draftRow?.company_id || "").trim().toUpperCase();
                const active =
                  !draft.groupAllMode &&
                  !groupOnlyDraft &&
                  (Number(draft.companyId) === Number(c.id) || (draftCode && draftCode === label));
                return (
                  <Pill
                    key={label}
                    active={active}
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
                    {label}
                  </Pill>
                );
              })}
            </div>
          </Section>

          {dash.currencies.length > 0 && (
            <Section title={i18n.currency}>
              <div className="m-filter-pill-scroll">
                {dash.currencies.map((code) => (
                  <Pill
                    key={code}
                    active={draft.currency === code}
                    onClick={() => setDraft((prev) => ({ ...prev, currency: code }))}
                  >
                    {code}
                  </Pill>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="m-sheet-footer">
          <button type="button" onClick={handleReset} className="m-sheet-footer-btn m-sheet-footer-btn--muted tap-scale">
            {i18n.reset}
          </button>
          <button type="button" onClick={handleApply} className="m-sheet-footer-btn m-sheet-footer-btn--primary tap-scale">
            {i18n.applyFilter}
          </button>
        </div>
      </div>

      <DateRangeCalendarSheet
        open={rangeOpen}
        onClose={() => setRangeOpen(false)}
        dateFrom={draft.dateFrom}
        dateTo={draft.dateTo}
        maxYmd={maxDay}
        labels={{
          selectDateRange: i18n.selectDateRange,
          rangePickHint: i18n.rangePickHint,
          from: i18n.from,
          toDate: i18n.toDate,
          today: i18n.today,
          clear: i18n.clear,
          done: i18n.done,
          close: i18n.closeMenu || "Close",
        }}
        onApply={(from, to) =>
          setDraft((prev) => ({
            ...prev,
            dateFrom: from,
            dateTo: to,
            activePreset: "",
          }))
        }
      />
    </div>
  );
}
