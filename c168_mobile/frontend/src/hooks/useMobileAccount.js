import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  companiesForPicker,
  pickCompany,
  resolveCompanyPickForGroup,
  resolveInitialMobileGcScope,
  resolveMobileGroupIds,
} from "../lib/dashboardScope.js";
import { fetchJson, assertApiOk } from "../lib/fetchJson.js";
import { canUseGroupOnlyMode, filterCompaniesForUserScope } from "../lib/loginScope.js";
import {
  accountScopeIsGroupOnly,
  accountScopePayload,
  accountScopeQuery,
  resolveAccountScopeDraft,
} from "../lib/mobileAccountScope.js";
import { isPartnershipAuditReadOnlyLocked } from "../lib/partnershipAuditReadOnly.js";
import { accountText } from "../translateFile/accountTranslate.js";
import { buildApiUrl } from "../utils/apiUrl.js";
import { canAccessAccount, resolveMobileLandingPath } from "../utils/mobilePermissions.js";

const COMPANIES_API = "api/transactions/get_owner_companies_api.php";
const EMPTY_FORM = {
  id: "",
  account_id: "",
  name: "",
  role: "",
  password: "",
  remark: "",
  payment_alert: "0",
  alert_type: "",
  alert_start_date: "",
  alert_amount: "",
};

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function mergeRows(lists) {
  const byId = new Map();
  lists.flat().forEach((row) => {
    const id = Number(row?.id);
    if (id > 0) byId.set(id, row);
  });
  return [...byId.values()];
}

function normalizeAlertAmount(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("-") ? raw : `-${raw}`;
}

async function readJson(url, options = {}) {
  const { res, json } = await fetchJson(url, options);
  assertApiOk(res, json);
  return json;
}

export function useMobileAccount() {
  const navigate = useNavigate();
  const [lang, setLangState] = useState(() => localStorage.getItem("login_lang") || "en");
  const i18n = useMemo(() => accountText(lang), [lang]);
  const [me, setMe] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupsAllMode, setGroupsAllMode] = useState(false);
  const [groupAllMode, setGroupAllMode] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [sortKey, setSortKey] = useState("account");
  const [sortDirection, setSortDirection] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [toast, setToast] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [roles, setRoles] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formCurrencies, setFormCurrencies] = useState([]);
  const [initialFormCurrencies, setInitialFormCurrencies] = useState([]);
  const [linkPool, setLinkPool] = useState([]);
  const [linkedIds, setLinkedIds] = useState(new Set());
  const [linkTypeMap, setLinkTypeMap] = useState({});
  const [linkCompanyId, setLinkCompanyId] = useState(null);
  const [linkType, setLinkType] = useState("bidirectional");
  const [currencyLinked, setCurrencyLinked] = useState(new Set());
  const [currencyInitial, setCurrencyInitial] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const toastTimer = useRef(null);
  const listSeq = useRef(0);

  const scope = useMemo(
    () => ({ companyId, selectedGroup, groupsAllMode, groupAllMode }),
    [companyId, selectedGroup, groupsAllMode, groupAllMode],
  );
  const groupIds = useMemo(() => resolveMobileGroupIds(companies, me), [companies, me]);
  const selectedCompany = useMemo(
    () => companies.find((row) => Number(row.id) === Number(companyId)) || null,
    [companies, companyId],
  );
  const groupOnlyMode = accountScopeIsGroupOnly(scope);
  const mutationsBlocked = isPartnershipAuditReadOnlyLocked(me);
  const canMutate =
    !mutationsBlocked &&
    !groupsAllMode &&
    !groupAllMode &&
    (Number(companyId) > 0 || groupOnlyMode);

  const notify = useCallback((message, tone = "success") => {
    setToast({ message, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tone === "error" ? 4000 : 2200);
  }, []);

  const setLang = useCallback((next) => {
    const normalized = next === "zh" ? "zh" : "en";
    localStorage.setItem("login_lang", normalized);
    setLangState(normalized);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const { res: meRes, json: meJson } = await fetchJson(
          buildApiUrl("api/session/current_user_api.php"),
          {
            signal: ac.signal,
          },
        );
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
        if (!canAccessAccount(user)) {
          setBlocked(true);
          navigate(resolveMobileLandingPath(user), { replace: true });
          return;
        }
        setMe(user);
        const companiesJson = await readJson(buildApiUrl(`${COMPANIES_API}?all=1`), {
          signal: ac.signal,
        });
        const list = Array.isArray(companiesJson.data) ? companiesJson.data : [];
        const scoped = filterCompaniesForUserScope(list, user);
        const picked = pickCompany(scoped, user.company_id);
        const initial = resolveInitialMobileGcScope(user, scoped, picked);
        setCompanies(scoped);
        setCompanyId(initial.companyId);
        setSelectedGroup(initial.selectedGroup);
      } catch (e) {
        if (e?.name !== "AbortError") setError(e?.message || i18n.loadError);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [navigate, i18n.loadError]);

  const fetchRows = useCallback(
    async (signal) => {
      const filters = { search: debouncedSearch, showInactive };
      let targets = [scope];
      if (groupsAllMode || groupAllMode) {
        const rows = companies.filter((row) => {
          if (!(Number(row?.id) > 0)) return false;
          if (groupsAllMode) return true;
          return upper(row?.group_id) === upper(selectedGroup);
        });
        targets = rows.map((row) => ({
          companyId: Number(row.id),
          selectedGroup: groupAllMode ? selectedGroup : null,
          groupsAllMode: false,
          groupAllMode: false,
        }));
      }
      if (!targets.length) return [];
      const lists = await Promise.all(
        targets.map(async (target) => {
          const url = new URL(buildApiUrl("api/accounts/accountlistapi.php"));
          accountScopeQuery(target, filters).forEach((value, key) => url.searchParams.set(key, value));
          const json = await readJson(url.toString(), { signal });
          return Array.isArray(json?.data?.accounts) ? json.data.accounts : [];
        }),
      );
      return mergeRows(lists);
    },
    [
      companies,
      debouncedSearch,
      groupAllMode,
      groupsAllMode,
      scope,
      selectedGroup,
      showInactive,
    ],
  );

  useEffect(() => {
    if (!me || (!Number(companyId) && !groupOnlyMode && !groupsAllMode && !groupAllMode)) return;
    const seq = ++listSeq.current;
    const ac = new AbortController();
    setLoading(true);
    setError("");
    fetchRows(ac.signal)
      .then((rows) => {
        if (seq === listSeq.current) setAccounts(rows);
      })
      .catch((e) => {
        if (e?.name !== "AbortError" && seq === listSeq.current) setError(e?.message || i18n.loadError);
      })
      .finally(() => {
        if (seq === listSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => ac.abort();
  }, [companyId, fetchRows, groupAllMode, groupOnlyMode, groupsAllMode, i18n.loadError, me, reloadNonce]);

  const displayAccounts = useMemo(() => {
    const rows = [...accounts];
    const direction = sortDirection === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let left = a?.account_id;
      let right = b?.account_id;
      if (sortKey === "name") {
        left = a?.name;
        right = b?.name;
      } else if (sortKey === "role") {
        left = a?.role;
        right = b?.role;
      } else if (sortKey === "lastLogin") {
        left = a?.last_login;
        right = b?.last_login;
      }
      return String(left || "").localeCompare(String(right || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * direction;
    });
    return rows;
  }, [accounts, sortDirection, sortKey]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadNonce((value) => value + 1);
  }, []);

  const applyScope = useCallback(
    async (draft) => {
      const next = resolveAccountScopeDraft(draft, companies);
      if (next.companyId && Number(next.companyId) !== Number(companyId)) {
        try {
          await readJson(
            buildApiUrl(`api/session/update_company_session_api.php?company_id=${next.companyId}`),
          );
        } catch (e) {
          notify(e?.message || i18n.loadError, "error");
          return false;
        }
      }
      setCompanyId(next.companyId);
      setSelectedGroup(next.selectedGroup);
      setGroupsAllMode(next.groupsAllMode);
      setGroupAllMode(next.groupAllMode);
      return true;
    },
    [companies, companyId, i18n.loadError, notify],
  );

  const scopeFormData = useCallback(
    (fd) => {
      const payload = accountScopePayload(scope);
      Object.entries(payload).forEach(([key, value]) => fd.set(key, value));
      return fd;
    },
    [scope],
  );

  const guarded = useCallback(
    (fn) => {
      if (!canMutate) {
        notify(i18n.readOnly, "error");
        return false;
      }
      fn();
      return true;
    },
    [canMutate, i18n.readOnly, notify],
  );

  const toggleField = useCallback(
    async (account, endpoint, responseField, localField) => {
      if (!guarded(() => {})) return;
      try {
        const fd = scopeFormData(new FormData());
        fd.set("id", String(account.id));
        const json = await readJson(buildApiUrl(endpoint), { method: "POST", body: fd });
        const next = json?.data?.[responseField] ?? json?.[responseField];
        setAccounts((rows) =>
          rows.map((row) => (Number(row.id) === Number(account.id) ? { ...row, [localField]: next } : row)),
        );
        setDetail((row) =>
          Number(row?.id) === Number(account.id) ? { ...row, [localField]: next } : row,
        );
        if (localField === "status") setReloadNonce((value) => value + 1);
      } catch (e) {
        notify(e?.message || i18n.toggleError, "error");
      }
    },
    [guarded, i18n.toggleError, notify, scopeFormData],
  );

  const toggleStatus = useCallback(
    (account) =>
      toggleField(account, "api/accounts/toggle_account_status_api.php", "newStatus", "status"),
    [toggleField],
  );
  const toggleAlert = useCallback(
    async (accountRow) => {
      if (!guarded(() => {})) return "blocked";
      const currentlyOn = Number(accountRow?.payment_alert) === 1;
      if (!currentlyOn) {
        const type = accountRow?.alert_type || accountRow?.alert_day || "";
        const start = accountRow?.alert_start_date || accountRow?.alert_specific_date || "";
        if (!String(type).trim() || !String(start).trim()) {
          notify(i18n.alertRequired, "error");
          return "needsEdit";
        }
      }
      await toggleField(
        accountRow,
        "api/accounts/toggle_payment_alert_api.php",
        "newPaymentAlert",
        "payment_alert",
      );
      return "ok";
    },
    [guarded, i18n.alertRequired, notify, toggleField],
  );

  const loadRolesAndCurrencies = useCallback(
    async (accountId = null) => {
      const roleUrl = new URL(buildApiUrl("api/editdata/editdata_api.php"));
      const currencyUrl = new URL(buildApiUrl("api/accounts/account_currency_api.php"));
      currencyUrl.searchParams.set("action", "get_available_currencies");
      if (accountId) currencyUrl.searchParams.set("account_id", String(accountId));
      for (const url of [roleUrl, currencyUrl]) {
        const params = new URLSearchParams(url.search);
        const payload = accountScopePayload(scope);
        Object.entries(payload).forEach(([key, value]) => params.set(key, value));
        url.search = params.toString();
      }
      const [roleJson, currencyJson] = await Promise.all([
        readJson(roleUrl.toString()),
        readJson(currencyUrl.toString()),
      ]);
      setRoles(Array.isArray(roleJson?.data?.roles) ? roleJson.data.roles : []);
      const currencyRows = Array.isArray(currencyJson?.data) ? currencyJson.data : [];
      setCurrencies(currencyRows);
      const selected = currencyRows.filter((row) => row.is_linked).map((row) => Number(row.id));
      setFormCurrencies(selected.length ? selected : currencyRows.slice(0, 1).map((row) => Number(row.id)));
      setInitialFormCurrencies(selected);
    },
    [scope],
  );

  const openCreate = useCallback(async () => {
    if (!guarded(() => {})) return false;
    setDetail(null);
    setForm({ ...EMPTY_FORM });
    try {
      await loadRolesAndCurrencies();
      return true;
    } catch (e) {
      notify(e?.message || i18n.loadError, "error");
      return false;
    }
  }, [guarded, i18n.loadError, loadRolesAndCurrencies, notify]);

  const loadDetail = useCallback(
    async (account) => {
      try {
        const url = new URL(buildApiUrl("api/accounts/getaccount_api.php"));
        url.searchParams.set("id", String(account.id));
        Object.entries(accountScopePayload(scope)).forEach(([key, value]) =>
          url.searchParams.set(key, value),
        );
      const json = await readJson(url.toString());
      // Never keep or surface the stored password hash from getaccount_api.
      const row = { ...(json.data || {}) };
      delete row.password;
      setDetail(row);
      return row;
      } catch (e) {
        notify(e?.message || i18n.detailError, "error");
        return null;
      }
    },
    [i18n.detailError, notify, scope],
  );

  const openEdit = useCallback(async () => {
    if (!detail || !guarded(() => {})) return false;
    const row = await loadDetail(detail);
    if (!row) return false;
    setForm({
      id: row.id,
      account_id: upper(row.account_id),
      name: upper(row.name),
      role: row.role || "",
      password: "",
      remark: upper(row.remark),
      payment_alert: String(Number(row.payment_alert) ? "1" : "0"),
      alert_type: row.alert_type || row.alert_day || "",
      alert_start_date: row.alert_start_date || row.alert_specific_date || "",
      alert_amount: row.alert_amount || "",
    });
    try {
      await loadRolesAndCurrencies(row.id);
      return true;
    } catch (e) {
      notify(e?.message || i18n.loadError, "error");
      return false;
    }
  }, [detail, guarded, i18n.loadError, loadDetail, loadRolesAndCurrencies, notify]);

  const syncAccountCurrencies = useCallback(
    async (accountId, before, after) => {
      const oldSet = new Set(before.map(Number));
      const nextSet = new Set(after.map(Number));
      const actions = [
        ...[...nextSet].filter((id) => !oldSet.has(id)).map((id) => ["add_currency", id]),
        ...[...oldSet].filter((id) => !nextSet.has(id)).map((id) => ["remove_currency", id]),
      ];
      for (const [action, currencyId] of actions) {
        const url = new URL(buildApiUrl("api/accounts/account_currency_api.php"));
        url.searchParams.set("action", action);
        Object.entries(accountScopePayload(scope)).forEach(([key, value]) =>
          url.searchParams.set(key, value),
        );
        await readJson(url.toString(), {
          method: "POST",
          body: JSON.stringify({ account_id: Number(accountId), currency_id: Number(currencyId) }),
        });
      }
    },
    [scope],
  );

  const saveAccount = useCallback(async () => {
    const editing = Number(form.id) > 0;
    if (!form.name.trim() || !form.role.trim() || (!editing && (!form.account_id.trim() || !form.password.trim()))) {
      notify(editing ? i18n.editRequiredFields : i18n.requiredFields, "error");
      return false;
    }
    if (form.payment_alert === "1" && (!form.alert_type || !form.alert_start_date)) {
      notify(i18n.alertRequired, "error");
      return false;
    }
    setSaving(true);
    try {
      const fd = scopeFormData(new FormData());
      Object.entries(form).forEach(([key, value]) => {
        let out = String(value ?? "");
        if (key === "alert_amount") out = normalizeAlertAmount(value);
        else if (key === "account_id" || key === "name" || key === "remark") out = upper(out);
        fd.set(key, out);
      });
      if (Number(companyId) > 0) {
        fd.set("company_id", String(companyId));
        fd.set("company_ids", JSON.stringify([Number(companyId)]));
      }
      const json = await readJson(
        buildApiUrl(editing ? "api/accounts/update_api.php" : "api/accounts/addaccountapi.php"),
        { method: "POST", body: fd },
      );
      const accountId = editing ? Number(form.id) : Number(json?.data?.id);
      if (accountId > 0) {
        await syncAccountCurrencies(
          accountId,
          editing ? initialFormCurrencies : [],
          formCurrencies,
        );
      }
      notify(i18n.saveSuccess);
      setReloadNonce((value) => value + 1);
      if (editing) await loadDetail({ id: accountId });
      return true;
    } catch (e) {
      notify(e?.message || i18n.saveError, "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    companyId,
    form,
    formCurrencies,
    i18n,
    initialFormCurrencies,
    loadDetail,
    notify,
    scopeFormData,
    syncAccountCurrencies,
  ]);

  const loadLinks = useCallback(async () => {
    if (!detail || !guarded(() => {})) return false;
    try {
      const listUrl = new URL(buildApiUrl("api/accounts/accountlistapi.php"));
      accountScopeQuery(scope, { showAll: true }).forEach((value, key) =>
        listUrl.searchParams.set(key, value),
      );
      const linkedUrl = new URL(buildApiUrl("api/accounts/account_link_api.php"));
      linkedUrl.searchParams.set("action", "get_linked_accounts");
      linkedUrl.searchParams.set("account_id", String(detail.id));
      Object.entries(accountScopePayload(scope)).forEach(([key, value]) =>
        linkedUrl.searchParams.set(key, value),
      );
      const [listJson, linkedJson] = await Promise.all([
        readJson(listUrl.toString()),
        readJson(linkedUrl.toString()),
      ]);
      setLinkPool(
        (listJson?.data?.accounts || []).filter((row) => Number(row.id) !== Number(detail.id)),
      );
      const types = linkedJson?.data?.link_types_map || {};
      setLinkTypeMap(types);
      setLinkCompanyId(Number(linkedJson?.data?.company_id) || Number(companyId) || null);
      setLinkedIds(
        new Set(
          (linkedJson?.data?.accounts || [])
            .filter((row) => types[row.id] === "bidirectional")
            .map((row) => Number(row.id)),
        ),
      );
      setLinkType("bidirectional");
      return true;
    } catch (e) {
      notify(e?.message || i18n.linkError, "error");
      return false;
    }
  }, [companyId, detail, guarded, i18n.linkError, notify, scope]);

  useEffect(() => {
    setLinkedIds(
      new Set(
        Object.entries(linkTypeMap)
          .filter(([, type]) => type === linkType)
          .map(([id]) => Number(id)),
      ),
    );
  }, [linkType, linkTypeMap]);

  const saveLinks = useCallback(async () => {
    if (!detail) return false;
    setSaving(true);
    try {
      const scopeData = accountScopePayload(scope);
      const current = new Set(
        Object.entries(linkTypeMap)
          .filter(([, type]) => type === linkType)
          .map(([id]) => Number(id)),
      );
      const add = [...linkedIds].filter((id) => !current.has(id));
      const remove = [...current].filter((id) => !linkedIds.has(id));
      const company = Number(linkCompanyId) || Number(companyId) || Number(selectedCompany?.id) || 0;
      for (const id of remove) {
        await readJson(buildApiUrl("api/accounts/account_link_api.php?action=unlink_accounts"), {
          method: "POST",
          body: JSON.stringify({
            account_id_1: Number(detail.id),
            account_id_2: id,
            company_id: company,
            ...scopeData,
          }),
        });
      }
      for (const id of add) {
        await readJson(buildApiUrl("api/accounts/account_link_api.php?action=link_accounts"), {
          method: "POST",
          body: JSON.stringify({
            account_id_1: Number(detail.id),
            account_id_2: id,
            company_id: company,
            ...scopeData,
            link_type: linkType,
            source_account_id: linkType === "unidirectional" ? Number(detail.id) : null,
          }),
        });
      }
      notify(i18n.linkSuccess);
      return true;
    } catch (e) {
      notify(e?.message || i18n.linkError, "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    companyId,
    detail,
    i18n.linkError,
    i18n.linkSuccess,
    linkType,
    linkTypeMap,
    linkCompanyId,
    linkedIds,
    notify,
    scope,
    selectedCompany?.id,
  ]);

  const deleteAccount = useCallback(async () => {
    if (!detail || !canMutate) return false;
    if (String(detail.status || "").toLowerCase() !== "inactive") return false;
    setSaving(true);
    try {
      const fd = scopeFormData(new FormData());
      fd.append("ids[]", String(detail.id));
      await readJson(buildApiUrl("api/accounts/delete_accounts_api.php"), {
        method: "POST",
        body: fd,
      });
      setDetail(null);
      setReloadNonce((value) => value + 1);
      notify(i18n.deleteSuccess);
      return true;
    } catch (e) {
      notify(e?.message || i18n.deleteError, "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [canMutate, detail, i18n.deleteError, i18n.deleteSuccess, notify, scopeFormData]);

  const loadCurrencyLinks = useCallback(
    async (currencyId) => {
      const url = new URL(buildApiUrl("api/accounts/bulk_account_currency_api.php"));
      url.searchParams.set("action", "get_linked_accounts_by_currency");
      url.searchParams.set("currency_id", String(currencyId));
      Object.entries(accountScopePayload(scope)).forEach(([key, value]) =>
        url.searchParams.set(key, value),
      );
      const json = await readJson(url.toString(), { method: "POST" });
      const ids = new Set((json?.data?.linked_account_ids || []).map(Number));
      setCurrencyLinked(ids);
      setCurrencyInitial(new Set(ids));
    },
    [scope],
  );

  const openCurrency = useCallback(async () => {
    if (!guarded(() => {})) return false;
    try {
      await loadRolesAndCurrencies();
      return true;
    } catch (e) {
      notify(e?.message || i18n.currencyError, "error");
      return false;
    }
  }, [guarded, i18n.currencyError, loadRolesAndCurrencies, notify]);

  const createCurrency = useCallback(
    async (code) => {
      const normalized = upper(code);
      if (!normalized || !canMutate) return false;
      try {
        const json = await readJson(buildApiUrl("api/accounts/create_currency_api.php"), {
          method: "POST",
          body: JSON.stringify({ code: normalized, ...accountScopePayload(scope) }),
        });
        const newId = Number(json?.data?.id);
        if (!Number.isFinite(newId) || newId <= 0) {
          await loadRolesAndCurrencies();
          return true;
        }
        setCurrencies((rows) => [
          ...rows.filter((row) => Number(row.id) !== newId),
          { ...json.data, id: newId, is_linked: false },
        ]);
        return true;
      } catch (e) {
        notify(e?.message || i18n.currencyError, "error");
        return false;
      }
    },
    [canMutate, i18n.currencyError, loadRolesAndCurrencies, notify, scope],
  );

  const deleteCurrency = useCallback(
    async (currency) => {
      if (!currency?.id || !canMutate) return false;
      try {
        const url = new URL(buildApiUrl("api/accounts/delete_currency_api.php"));
        Object.entries(accountScopePayload(scope)).forEach(([key, value]) =>
          url.searchParams.set(key, value),
        );
        await readJson(url.toString(), {
          method: "POST",
          body: JSON.stringify({ id: Number(currency.id), ...accountScopePayload(scope) }),
        });
        setCurrencies((rows) => rows.filter((row) => Number(row.id) !== Number(currency.id)));
        return true;
      } catch (e) {
        notify(e?.message || i18n.currencyError, "error");
        return false;
      }
    },
    [canMutate, i18n.currencyError, notify, scope],
  );

  const saveCurrencyLinks = useCallback(
    async (currencyId) => {
      setSaving(true);
      try {
        const url = new URL(buildApiUrl("api/accounts/bulk_account_currency_api.php"));
        url.searchParams.set("action", "bulk_update");
        Object.entries(accountScopePayload(scope)).forEach(([key, value]) =>
          url.searchParams.set(key, value),
        );
        const linked = [...currencyLinked].filter((id) => !currencyInitial.has(id));
        const unlinked = [...currencyInitial].filter((id) => !currencyLinked.has(id));
        await readJson(url.toString(), {
          method: "POST",
          body: JSON.stringify({
            currency_id: Number(currencyId),
            linked_account_ids: linked,
            unlinked_account_ids: unlinked,
          }),
        });
        setCurrencyInitial(new Set(currencyLinked));
        notify(i18n.currencySuccess);
        return true;
      } catch (e) {
        notify(e?.message || i18n.currencyError, "error");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [currencyInitial, currencyLinked, i18n.currencyError, i18n.currencySuccess, notify, scope],
  );

  const logout = useCallback(async () => {
    try {
      await fetchJson(buildApiUrl("api/session/logout_api.php"), { method: "POST" });
    } finally {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  return {
    i18n,
    lang,
    setLang,
    me,
    companies,
    companyId,
    selectedGroup,
    groupsAllMode,
    groupAllMode,
    selectedCompany,
    groupIds,
    companiesForPicker: companiesForPicker(companies, {
      selectedGroup,
      groupsAllMode,
      preferredCompanyId: companyId,
    }),
    canUseGroupOnlyForGroup: (group) => canUseGroupOnlyMode(me, group, companies),
    resolveCompanyForGroup: (group, current) =>
      resolveCompanyPickForGroup(companies, group, current),
    applyScope,
    accounts: displayAccounts,
    search,
    setSearch,
    showInactive,
    setShowInactive,
    sortKey,
    setSortKey,
    sortDirection,
    setSortDirection,
    loading,
    refreshing,
    error,
    blocked,
    toast,
    refresh,
    reload: refresh,
    mutationsBlocked,
    canMutate,
    detail,
    setDetail,
    loadDetail,
    toggleStatus,
    toggleAlert,
    form,
    setForm,
    roles,
    currencies,
    formCurrencies,
    setFormCurrencies,
    openCreate,
    openEdit,
    saveAccount,
    linkPool,
    linkedIds,
    setLinkedIds,
    linkType,
    setLinkType,
    loadLinks,
    saveLinks,
    deleteAccount,
    currencyLinked,
    setCurrencyLinked,
    loadCurrencyLinks,
    openCurrency,
    createCurrency,
    deleteCurrency,
    saveCurrencyLinks,
    saving,
    logout,
    notify,
  };
}
