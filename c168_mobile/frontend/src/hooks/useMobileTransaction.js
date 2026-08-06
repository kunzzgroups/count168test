import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMobileCurrencyCodes } from "../lib/dashboardCurrencies.js";
import {
  defaultDashboardDateRange,
  formatRangeLabel,
  periodPresetRange,
} from "../lib/dashboardDateUtils.js";
import {
  companiesForPicker as resolveCompaniesForPicker,
  pickCompany,
  pickGroupAnchorCompany,
  resolveCompanyPickForGroup,
  resolveInitialMobileGcScope,
  resolveMobileGroupIds,
} from "../lib/dashboardScope.js";
import { canUseGroupOnlyMode, filterCompaniesForUserScope } from "../lib/loginScope.js";
import { assertApiOk, fetchJson } from "../lib/fetchJson.js";
import {
  resolveMobileTransactionScope,
  transactionScopeApiParams,
  transactionScopeIsReady,
  resolveTransactionCurrencyOrderCompanyId,
} from "../lib/mobileTransactionScope.js";
import {
  applyOptimisticSubmitBalancePatch,
  applySummaryWinLossDisplayTolerance,
  applyTransactionDisplayFilters,
  buildTransactionSearchQueryFilters,
  calculateTotals,
  mergeSearchApiDataList,
  orderCurrencyRows,
  sanitizeSearchApiData,
  sortByRole,
} from "../lib/transactionPaymentLogic.js";
import {
  approveContra,
  getAccounts,
  getCategories,
  getCompanyCurrencies,
  getUserCurrencyOrder,
  loadContraInbox,
  rejectContra,
  searchTransactions,
  submitTransaction,
  fetchTypeAccountSearch,
} from "../lib/transactionApi.js";
import {
  buildOptimisticSubmitDeltas,
} from "../lib/transactionSubmitHelpers.js";
import { isPartnershipAuditReadOnlyLocked } from "../lib/partnershipAuditReadOnly.js";
import { clearMobileTxListSnapshot, readMobileTxListSnapshot } from "../lib/mobileTxListSnapshot.js";
import { TRANSACTION_I18N, getTransactionText } from "../translateFile/transactionTranslate.js";
import { DASHBOARD_I18N } from "../translateFile/dashboardTranslate.js";
import { canAccessTransaction, resolveMobileLandingPath } from "../utils/mobilePermissions.js";
import { buildApiUrl } from "../utils/apiUrl.js";

const COMPANIES_API = "api/transactions/get_owner_companies_api.php";

function isManagerOrAbove(me) {
  const role = String(me?.role || "").trim().toLowerCase();
  return role === "manager" || role === "admin" || role === "owner";
}

function mergeDisplayRows(rawSearchData) {
  if (!rawSearchData) return [];
  const left = Array.isArray(rawSearchData.left_table) ? rawSearchData.left_table : [];
  const right = Array.isArray(rawSearchData.right_table) ? rawSearchData.right_table : [];
  return sortByRole([...left, ...right]);
}

export function useMobileTransaction({ listPaused = false } = {}) {
  const navigate = useNavigate();
  const defaults = defaultDashboardDateRange();
  const [lang, setLangState] = useState(() => localStorage.getItem("login_lang") || "en");
  const t = useMemo(() => getTransactionText.bind(null, lang), [lang]);
  const m = useMemo(() => TRANSACTION_I18N[lang] || TRANSACTION_I18N.en, [lang]);
  const i18n = useMemo(
    () => ({
      ...(DASHBOARD_I18N[lang] || DASHBOARD_I18N.en),
      ...m,
    }),
    [lang, m],
  );

  const setLang = useCallback((next) => {
    const normalized = next === "zh" ? "zh" : "en";
    localStorage.setItem("login_lang", normalized);
    setLangState(normalized);
  }, []);

  const [me, setMe] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupsAllMode, setGroupsAllMode] = useState(false);
  const [groupAllMode, setGroupAllMode] = useState(false);
  const [currency, setCurrency] = useState("MYR");
  const [currencies, setCurrencies] = useState(["MYR"]);
  const [currenciesReady, setCurrenciesReady] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [activePreset, setActivePreset] = useState("thisYear");

  const [showName, setShowName] = useState(false);
  const [showCaptureOnly, setShowCaptureOnly] = useState(false);
  const [showPaymentOnly, setShowPaymentOnly] = useState(false);
  const [showZeroBalance, setShowZeroBalance] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [typeSearchActive, setTypeSearchActive] = useState(false);
  const [typeSearchFormType, setTypeSearchFormType] = useState("");
  const [contraInbox, setContraInbox] = useState({ open: false, items: [], loading: false });

  const [rawSearchData, setRawSearchData] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [accountOptions, setAccountOptions] = useState([]);
  const [formCurrencies, setFormCurrencies] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [toast, setToast] = useState(null);
  const [sessionNonce, setSessionNonce] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
  const searchSeq = useRef(0);
  /** After restoring a list snapshot (Back from history), skip the next auto search once. */
  const skipNextSearchRef = useRef(false);
  /** Track Payment History pause so Back does not auto re-search. */
  const listPausedRef = useRef(listPaused);
  const rawSearchDataRef = useRef(rawSearchData);
  rawSearchDataRef.current = rawSearchData;

  const groupIds = useMemo(() => resolveMobileGroupIds(companies, me), [companies, me]);
  const companiesForPicker = useMemo(
    () =>
      resolveCompaniesForPicker(companies, {
        selectedGroup,
        groupsAllMode,
        preferredCompanyId: companyId,
      }),
    [companies, selectedGroup, groupsAllMode, companyId],
  );
  const selectedCompany = useMemo(
    () => companies.find((c) => Number(c.id) === Number(companyId)) || null,
    [companies, companyId],
  );

  const transactionScope = useMemo(
    () =>
      resolveMobileTransactionScope({
        companies,
        companyId,
        selectedGroup,
        groupsAllMode,
        groupAllMode,
      }),
    [companies, companyId, selectedGroup, groupsAllMode, groupAllMode],
  );

  const scopeApi = useMemo(() => transactionScopeApiParams(transactionScope), [transactionScope]);
  const scopeReady = useMemo(() => transactionScopeIsReady(transactionScope), [transactionScope]);

  const groupOnlyMode = Boolean(
    selectedGroup && !groupAllMode && !groupsAllMode && !(Number.isFinite(Number(companyId)) && Number(companyId) > 0),
  );

  const mutationsBlocked = Boolean(
    isPartnershipAuditReadOnlyLocked(me) ||
      (transactionScope?.groupsAllMode && !transactionScope?.groupAllMode),
  );

  const pushToast = useCallback((message, tone = "info") => {
    setToast({ message, tone, id: Date.now() });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const displayRows = useMemo(() => {
    const merged = mergeDisplayRows(rawSearchData);
    return applyTransactionDisplayFilters(merged, {
      showZero: showZeroBalance,
      showPaymentOnly,
      showWinLossOnly: showCaptureOnly,
    });
  }, [rawSearchData, showZeroBalance, showPaymentOnly, showCaptureOnly]);

  const totals = useMemo(() => {
    if (!displayRows.length) return rawSearchData?.totals?.summary || null;
    return applySummaryWinLossDisplayTolerance(calculateTotals(displayRows));
  }, [displayRows, rawSearchData]);

  const dateRangeText = useMemo(() => formatRangeLabel(dateFrom, dateTo), [dateFrom, dateTo]);

  const currencyCodesForSearch = useMemo(() => {
    if (!currency || currency === "ALL") return currencies.filter((c) => c !== "ALL");
    return [currency];
  }, [currency, currencies]);

  const runSearch = useCallback(
    async (signal) => {
      if (!scopeReady) return;
      const seq = ++searchSeq.current;
      setSearchLoading(true);
      setSearchError("");
      try {
        const queryFilters = buildTransactionSearchQueryFilters({
          showZeroBalance,
          showPaymentOnly,
          showCaptureOnly,
        });

        const paramsBase = {
          ...scopeApi,
          dateFrom,
          dateTo,
          showInactive: queryFilters.showInactiveForQuery,
          showCaptureOnly: queryFilters.showCaptureOnlyForQuery,
          hideZeroBalance: queryFilters.hideZeroBalanceForQuery,
          currencyCodes: currencyCodesForSearch,
          categories: selectedCategories,
          typeSearch: typeSearchActive,
          typeSearchFormType: typeSearchActive ? typeSearchFormType : undefined,
        };

        if (typeSearchActive && typeSearchFormType) {
          try {
            const ids = await fetchTypeAccountSearch({
              ...scopeApi,
              // Same as desktop: Capture Date × all pure manual types (ignore form Type).
              transactionType: "ALL",
              signal,
            });
            if (signal?.aborted) return;
            paramsBase.typeAccountIds = ids;
            paramsBase.typeSearchFormType = "ALL";
          } catch {
            /* still run search without ids */
          }
        }

        let currentData = null;
        if (transactionScope?.mode === "aggregate" && transactionScope.mergeCompanyIds?.length) {
          const results = await Promise.all(
            transactionScope.mergeCompanyIds.map((cid) =>
              searchTransactions({
                ...paramsBase,
                companyId: cid,
                viewGroup: scopeApi.viewGroup || undefined,
                groupId: undefined,
                signal,
              }),
            ),
          );
          if (seq !== searchSeq.current || signal?.aborted) return;
          const payloads = results.filter((r) => r?.success && r?.data).map((r) => r.data);
          if (!payloads.length) {
            setRawSearchData({ left_table: [], right_table: [], totals: null });
            return;
          }
          currentData = mergeSearchApiDataList(payloads);
        } else {
          const result = await searchTransactions({ ...paramsBase, signal });
          if (seq !== searchSeq.current || signal?.aborted) return;
          if (!result?.success || !result?.data) {
            setSearchError(result?.message || result?.error || m.searchFailed);
            return;
          }
          currentData = result.data;
        }

        setRawSearchData(sanitizeSearchApiData(currentData));
      } catch (e) {
        if (signal?.aborted || e?.name === "AbortError") return;
        setSearchError(e?.message || m.searchFailed);
      } finally {
        if (seq === searchSeq.current && !signal?.aborted) setSearchLoading(false);
      }
    },
    [
      scopeReady,
      scopeApi,
      transactionScope,
      dateFrom,
      dateTo,
      showZeroBalance,
      showPaymentOnly,
      showCaptureOnly,
      currencyCodesForSearch,
      selectedCategories,
      typeSearchActive,
      typeSearchFormType,
      m.searchFailed,
    ],
  );

  const loadAccountsAndCurrencies = useCallback(
    async (signal) => {
      if (!scopeReady) return;
      const orderCid = resolveTransactionCurrencyOrderCompanyId(transactionScope, companies);
      try {
        const [accRes, curRes, ordRes] = await Promise.all([
          getAccounts({ ...scopeApi, status: "active", signal }),
          getCompanyCurrencies({ ...scopeApi, signal }),
          orderCid
            ? getUserCurrencyOrder({ companyId: orderCid, signal }).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (signal?.aborted) return;

        const accList = Array.isArray(accRes?.data) ? accRes.data : [];
        setAccountOptions(
          accList.map((a) => ({
            id: a.id,
            account_id: a.account_id,
            display_text: a.display_text || `${a.account_id}${a.name ? ` - ${a.name}` : ""}`,
            currency: a.currency,
            role: a.role,
          })),
        );

        const curRows = Array.isArray(curRes?.data) ? curRes.data : [];
        const ordered = orderCurrencyRows(curRows, ordRes, orderCid);
        const codes = ordered
          .map((r) => String(r.code || r.currency || "").trim().toUpperCase())
          .filter(Boolean);
        setFormCurrencies(codes.length ? [...new Set(codes)] : currencies);
      } catch {
        if (!signal?.aborted) setFormCurrencies(currencies);
      }
    },
    [scopeReady, scopeApi, currencies, transactionScope, companies],
  );

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        const { res: meRes, json: meJson } = await fetchJson(
          buildApiUrl("api/session/current_user_api.php"),
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        if (!meRes.ok || !meJson?.success || !meJson?.data) {
          navigate("/login", { replace: true });
          return;
        }
        const user = meJson.data;
        if (user.needs_owner_secondary || user.needs_user_secondary) {
          navigate(user.needs_owner_secondary ? "/owner-secondary-password" : "/user-secondary-password", {
            replace: true,
          });
          return;
        }
        if (String(user.user_type || "").toLowerCase() === "member") {
          navigate("/member", { replace: true });
          return;
        }
        if (!canAccessTransaction(user)) {
          setBlocked(true);
          navigate(resolveMobileLandingPath(user), { replace: true });
          return;
        }
        setMe(user);

        const { res: coRes, json: coJson } = await fetchJson(
          buildApiUrl(`${COMPANIES_API}?all=1`),
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        assertApiOk(coRes, coJson, i18n.loadError);
        const list = Array.isArray(coJson?.data) ? coJson.data : [];
        const snap = readMobileTxListSnapshot();
        if (snap) {
          setCompanies(filterCompaniesForUserScope(list, user));
          const snapCid = snap.companyId != null ? Number(snap.companyId) : null;
          setCompanyId(Number.isFinite(snapCid) && snapCid > 0 ? snapCid : null);
          setSelectedGroup(snap.selectedGroup ? String(snap.selectedGroup) : null);
          setGroupsAllMode(Boolean(snap.groupsAllMode));
          setGroupAllMode(Boolean(snap.groupAllMode));
          if (snap.currency) setCurrency(String(snap.currency));
          if (snap.dateFrom) setDateFrom(String(snap.dateFrom));
          if (snap.dateTo) setDateTo(String(snap.dateTo));
          if (snap.activePreset != null) setActivePreset(String(snap.activePreset));
          setShowName(Boolean(snap.showName));
          setShowCaptureOnly(Boolean(snap.showCaptureOnly));
          setShowPaymentOnly(Boolean(snap.showPaymentOnly));
          setShowZeroBalance(Boolean(snap.showZeroBalance));
          setSelectedCategories(Array.isArray(snap.selectedCategories) ? snap.selectedCategories : []);
          setTypeSearchActive(Boolean(snap.typeSearchActive));
          setTypeSearchFormType(snap.typeSearchFormType ? String(snap.typeSearchFormType) : "");
          if (snap.rawSearchData && typeof snap.rawSearchData === "object") {
            setRawSearchData(sanitizeSearchApiData(snap.rawSearchData));
            skipNextSearchRef.current = true;
          }
        } else {
          const scoped = filterCompaniesForUserScope(list, user);
          const picked = pickCompany(scoped, user.company_id);
          if (!picked) throw new Error(i18n.loadError);

          const initial = resolveInitialMobileGcScope(user, scoped, picked);
          setCompanies(scoped);
          setCompanyId(initial.companyId);
          setSelectedGroup(initial.selectedGroup);
          setGroupsAllMode(initial.groupsAllMode);
          setGroupAllMode(initial.groupAllMode);
        }

        const catRes = await getCategories();
        if (!ac.signal.aborted && catRes?.success && Array.isArray(catRes.data)) {
          setCategories(catRes.data);
        }
      } catch (e) {
        if (ac.signal.aborted || e?.name === "AbortError") return;
        setError(e?.message || i18n.loadError);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [navigate, i18n.loadError, sessionNonce]);

  useEffect(() => {
    const hasCompany = Number.isFinite(Number(companyId)) && Number(companyId) > 0;
    if (!companies.length || (!hasCompany && !groupOnlyMode && !groupsAllMode && !groupAllMode)) {
      return undefined;
    }
    const ac = new AbortController();
    setCurrenciesReady(false);
    (async () => {
      try {
        const codes = await fetchMobileCurrencyCodes({
          companyId,
          selectedGroup,
          groupAllMode,
          groupsAllMode,
          companies,
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        const next = codes.length ? codes : ["MYR"];
        setCurrencies(next);
        setCurrency((prev) => (next.includes(prev) ? prev : next[0] || "MYR"));
      } catch {
        if (!ac.signal.aborted) setCurrencies(["MYR"]);
      } finally {
        if (!ac.signal.aborted) setCurrenciesReady(true);
      }
    })();
    return () => ac.abort();
  }, [companies, companyId, selectedGroup, groupAllMode, groupsAllMode, groupOnlyMode]);

  useEffect(() => {
    if (!scopeReady || !currenciesReady) return undefined;

    const wasPaused = listPausedRef.current;
    listPausedRef.current = listPaused;

    // On Payment History: do not run list search (and abort any in-flight via cleanup).
    if (listPaused) {
      return undefined;
    }

    // Back from History: keep existing rows — no auto pull/re-search.
    if (wasPaused && rawSearchDataRef.current) {
      return undefined;
    }

    const ac = new AbortController();
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      void loadAccountsAndCurrencies(ac.signal);
      return () => ac.abort();
    }
    void runSearch(ac.signal);
    void loadAccountsAndCurrencies(ac.signal);
    return () => ac.abort();
  }, [
    scopeReady,
    currenciesReady,
    reloadNonce,
    listPaused,
    runSearch,
    loadAccountsAndCurrencies,
  ]);

  const captureListSnapshot = useCallback(
    () => ({
      companyId,
      selectedGroup,
      groupsAllMode,
      groupAllMode,
      currency,
      dateFrom,
      dateTo,
      activePreset,
      showName,
      showCaptureOnly,
      showPaymentOnly,
      showZeroBalance,
      selectedCategories,
      typeSearchActive,
      typeSearchFormType,
      rawSearchData,
    }),
    [
      companyId,
      selectedGroup,
      groupsAllMode,
      groupAllMode,
      currency,
      dateFrom,
      dateTo,
      activePreset,
      showName,
      showCaptureOnly,
      showPaymentOnly,
      showZeroBalance,
      selectedCategories,
      typeSearchActive,
      typeSearchFormType,
      rawSearchData,
    ],
  );

  const switchCompany = useCallback(async (id) => {
    const cid = Number(id);
    if (!Number.isFinite(cid) || cid <= 0) return;
    setCompanyId(cid);
    setGroupAllMode(false);
  }, []);

  const pickGroup = useCallback(
    (groupId) => {
      const g = groupId ? String(groupId).trim().toUpperCase() : null;
      if (!g) return;
      setGroupsAllMode(false);
      setGroupAllMode(false);
      setSelectedGroup(g);
      if (canUseGroupOnlyMode(me, g, companies)) {
        setCompanyId(null);
        return;
      }
      const pick = resolveCompanyPickForGroup(companies, g, companyId);
      if (pick?.id != null) setCompanyId(Number(pick.id));
    },
    [me, companies, companyId],
  );

  const pickAllGroups = useCallback(() => {
    setSelectedGroup(null);
    setCompanyId(null);
    setGroupsAllMode(true);
    setGroupAllMode(false);
  }, []);

  const pickAllInGroup = useCallback(() => {
    if (!selectedGroup) return;
    setGroupsAllMode(false);
    setGroupAllMode(true);
    if (!(Number.isFinite(Number(companyId)) && Number(companyId) > 0)) {
      const first = resolveCompaniesForPicker(companies, {
        selectedGroup,
        groupsAllMode: false,
      })[0];
      if (first?.id != null) setCompanyId(Number(first.id));
    }
  }, [selectedGroup, companyId, companies]);

  const applyFilters = useCallback(
    (draft) => {
      if (!draft) return;

      if (draft.activePreset) {
        const range = periodPresetRange(draft.activePreset);
        if (range) {
          setActivePreset(draft.activePreset);
          setDateFrom(range.dateFrom);
          setDateTo(range.dateTo);
        }
      } else if (draft.dateFrom && draft.dateTo) {
        setDateFrom(draft.dateFrom);
        setDateTo(draft.dateTo);
        setActivePreset("");
      }

      if (draft.currency) setCurrency(draft.currency);
      if (Array.isArray(draft.selectedCategories)) setSelectedCategories(draft.selectedCategories);

      if (draft.groupsAllMode) {
        setGroupsAllMode(true);
        setGroupAllMode(false);
        setSelectedGroup(null);
        setCompanyId(null);
        setReloadNonce((n) => n + 1);
        return;
      }

      const group = draft.selectedGroup ? String(draft.selectedGroup).trim().toUpperCase() : null;

      if (group && draft.groupAllMode) {
        setGroupsAllMode(false);
        setGroupAllMode(true);
        setSelectedGroup(group);
        let cid = Number(draft.companyId);
        if (!Number.isFinite(cid) || cid <= 0) {
          const anchor = pickGroupAnchorCompany(companies, group);
          cid = anchor?.id != null ? Number(anchor.id) : null;
        }
        if (cid) setCompanyId(cid);
        setReloadNonce((n) => n + 1);
        return;
      }

      if (group) {
        const allowGroupOnly = canUseGroupOnlyMode(me, group, companies);
        const draftCid = Number(draft.companyId);
        const hasCompany = Number.isFinite(draftCid) && draftCid > 0;

        if (!hasCompany && allowGroupOnly) {
          setGroupsAllMode(false);
          setGroupAllMode(false);
          setSelectedGroup(group);
          setCompanyId(null);
          setReloadNonce((n) => n + 1);
          return;
        }

        const pick = hasCompany
          ? companies.find((c) => Number(c.id) === draftCid)
          : resolveCompanyPickForGroup(companies, group, companyId);
        if (!pick?.id) return;

        setGroupsAllMode(false);
        setGroupAllMode(false);
        setSelectedGroup(group);
        setCompanyId(Number(pick.id));
        setReloadNonce((n) => n + 1);
        return;
      }

      const cid = Number(draft.companyId);
      if (Number.isFinite(cid) && cid > 0) {
        setGroupsAllMode(false);
        setGroupAllMode(false);
        setSelectedGroup(null);
        setCompanyId(cid);
        setReloadNonce((n) => n + 1);
      }
    },
    [companies, companyId, me],
  );

  const canUseGroupOnlyForGroup = useCallback(
    (gid) => canUseGroupOnlyMode(me, gid, companies),
    [me, companies],
  );

  const applyPreset = useCallback((key) => {
    const range = periodPresetRange(key);
    if (!range) return;
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
    setActivePreset(key);
    setReloadNonce((n) => n + 1);
  }, []);

  const setCustomDateRange = useCallback((from, to) => {
    if (from) setDateFrom(from);
    if (to) setDateTo(to);
    setActivePreset("");
    setReloadNonce((n) => n + 1);
  }, []);

  const resetFilters = useCallback(() => {
    const d = defaultDashboardDateRange();
    setDateFrom(d.dateFrom);
    setDateTo(d.dateTo);
    setActivePreset("thisYear");
    setShowName(false);
    setShowCaptureOnly(false);
    setShowPaymentOnly(false);
    setShowZeroBalance(false);
    setSelectedCategories([]);
    setTypeSearchActive(false);
    setTypeSearchFormType("");
    setReloadNonce((n) => n + 1);
  }, []);

  const refreshContraInboxBadge = useCallback(
    async (api = scopeApi) => {
      if (!scopeReady || !api || !isManagerOrAbove(me)) {
        setContraInbox((s) => ({ ...s, items: [], loading: false }));
        return;
      }
      setContraInbox((s) => ({ ...s, loading: true }));
      try {
        const res = await loadContraInbox({ ...api });
        const items = Array.isArray(res?.data) ? res.data : [];
        setContraInbox((s) => ({ ...s, items, loading: false }));
      } catch {
        setContraInbox((s) => ({ ...s, loading: false }));
      }
    },
    [scopeReady, scopeApi, me],
  );

  useEffect(() => {
    if (!scopeReady || !currenciesReady) return undefined;
    void refreshContraInboxBadge();
    return undefined;
  }, [scopeReady, currenciesReady, reloadNonce, refreshContraInboxBadge]);

  const runTypeSearch = useCallback(
    (txType) => {
      const tType = String(txType || "").toUpperCase().trim();
      if (!tType) return;
      setTypeSearchActive(true);
      // List ignores form Type — always ALL (Capture Date × any pure manual type).
      setTypeSearchFormType("ALL");
      setReloadNonce((n) => n + 1);
    },
    [],
  );

  const exitTypeSearch = useCallback(() => {
    clearMobileTxListSnapshot();
    setTypeSearchActive(false);
    setTypeSearchFormType("");
    setReloadNonce((n) => n + 1);
  }, []);

  const onApproveContra = useCallback(
    async (transactionId) => {
      if (mutationsBlocked) {
        pushToast(m.readOnlyModeCannotSubmit, "error");
        return;
      }
      const res = await approveContra({ transactionId, ...scopeApi });
      if (res?.success) {
        pushToast(res.message || m.approve, "success");
        void refreshContraInboxBadge();
        setReloadNonce((n) => n + 1);
      } else {
        pushToast(res?.message || m.submitFailed, "error");
      }
    },
    [mutationsBlocked, scopeApi, pushToast, m, refreshContraInboxBadge],
  );

  const onRejectContra = useCallback(
    async (transactionId) => {
      if (mutationsBlocked) {
        pushToast(m.readOnlyModeCannotSubmit, "error");
        return;
      }
      const res = await rejectContra({ transactionId, ...scopeApi });
      if (res?.success) {
        pushToast(res.message || m.reject, "success");
        void refreshContraInboxBadge();
        setReloadNonce((n) => n + 1);
      } else {
        pushToast(res?.message || m.submitFailed, "error");
      }
    },
    [mutationsBlocked, scopeApi, pushToast, m, refreshContraInboxBadge],
  );

  const retry = useCallback(() => {
    // Pull-to-refresh while in type search → exit to default list (same as Exit Search chip).
    if (typeSearchActive) {
      exitTypeSearch();
      return;
    }
    setReloadNonce((n) => n + 1);
  }, [typeSearchActive, exitTypeSearch]);

  const logout = useCallback(async () => {
    try {
      await fetch(buildApiUrl("api/session/logout_api.php"), { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }
    navigate("/login", { replace: true });
  }, [navigate]);

  const submitTx = useCallback(
    async (payload, clientRequestId) => {
      if (!scopeReady) {
        pushToast(m.submitFailed, "error");
        return { success: false };
      }
      if (mutationsBlocked) {
        pushToast(m.readOnlyModeCannotSubmit, "error");
        return { success: false };
      }
      try {
        const res = await submitTransaction({
          ...scopeApi,
          groupAggregate: scopeApi.groupAggregate || transactionScope?.mode === "group",
          payload,
          clientRequestId,
        });
        if (res?.success) {
          const approvalStatus = res?.data?.approval_status
            ? String(res.data.approval_status).toUpperCase()
            : "";
          if (approvalStatus === "PENDING") {
            pushToast(m.submittedWaitingApproval, "info");
            void refreshContraInboxBadge();
            return res;
          }

          pushToast(
            res?.message ||
              (payload.transaction_type === "RATE" ? m.rateTransactionSubmitted : m.transactionSubmitted),
            "success",
          );

          const txType = String(payload.transaction_type || "").toUpperCase();
          const toAccountId = payload.account_id;
          const fromAccountId = payload.from_account_id;
          const submitCurrency = String(payload.currency || "").toUpperCase().trim();

          if (txType && txType !== "RATE" && submitCurrency) {
            const deltas = buildOptimisticSubmitDeltas({
              txType,
              amount: payload.amount,
              toAccountId,
              fromAccountId,
            });
            if (deltas.length) {
              setRawSearchData((prev) =>
                applyOptimisticSubmitBalancePatch(prev, {
                  currency: submitCurrency,
                  deltas,
                }),
              );
            }
          }

          setReloadNonce((n) => n + 1);
          void refreshContraInboxBadge();
          return res;
        }
        pushToast(res?.message || m.submitFailed, "error");
        return res;
      } catch {
        pushToast(m.networkError, "error");
        return { success: false };
      }
    },
    [scopeReady, scopeApi, transactionScope, mutationsBlocked, pushToast, m, refreshContraInboxBadge],
  );

  const orderCompanyId = useMemo(
    () => resolveTransactionCurrencyOrderCompanyId(transactionScope, companies),
    [transactionScope, companies],
  );

  return {
    i18n,
    m,
    t,
    lang,
    setLang,
    me,
    companies,
    groupIds,
    selectedGroup,
    groupsAllMode,
    groupAllMode,
    groupOnlyMode,
    companiesForPicker,
    companyId,
    selectedCompany,
    switchCompany,
    pickGroup,
    pickAllGroups,
    pickAllInGroup,
    applyFilters,
    canUseGroupOnlyForGroup,
    currency,
    setCurrency,
    currencies,
    formCurrencies,
    dateFrom,
    dateTo,
    dateRangeText,
    activePreset,
    applyPreset,
    setCustomDateRange,
    resetFilters,
    showName,
    setShowName,
    showCaptureOnly,
    setShowCaptureOnly,
    showPaymentOnly,
    setShowPaymentOnly,
    showZeroBalance,
    setShowZeroBalance,
    categories,
    selectedCategories,
    setSelectedCategories,
    toggleCategory: (cat) => {
      setSelectedCategories((prev) => {
        const c = String(cat || "");
        if (!c) return prev;
        return prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c];
      });
    },
    typeSearchActive,
    typeSearchFormType,
    runTypeSearch,
    exitTypeSearch,
    contraInbox,
    setContraInbox,
    canUseContraInbox: isManagerOrAbove(me),
    refreshContraInboxBadge,
    onApproveContra,
    onRejectContra,
    displayRows,
    totals,
    rawSearchData,
    searchLoading,
    searchError,
    accountOptions,
    transactionScope,
    scopeApi,
    scopeReady,
    mutationsBlocked,
    orderCompanyId,
    loading,
    error,
    blocked,
    toast,
    pushToast,
    submitTx,
    captureListSnapshot,
    retry,
    logout,
  };
}
