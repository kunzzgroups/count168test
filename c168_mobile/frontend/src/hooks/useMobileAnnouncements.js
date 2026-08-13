import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  canAccessC168DomainPages,
  ensureC168DomainApiSession,
  fetchOwnerCompaniesForDomain,
} from "../lib/c168DomainAccess.js";
import { fetchJson } from "../lib/fetchJson.js";
import { readLoginLang, writeLoginLang } from "../lib/loginLang.js";
import { REALTIME_DOMAINS } from "../lib/realtime/realtimeEvents.js";
import { useRealtimeDomain } from "../lib/realtime/useRealtimeDomain.js";
import { announcementText, getAnnouncementText } from "../translateFile/announcementTranslate.js";
import { buildApiUrl } from "../utils/apiUrl.js";
import {
  composeAnnouncementSection,
  splitAnnouncementSection,
} from "../components/announcements/announcementSectionLabel.js";
import {
  isRichTextEffectivelyEmpty,
  normalizeRichTextInput,
} from "../utils/content/richTextSanitizer.js";

async function postForm(url, fields) {
  const fd = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value != null) fd.append(key, String(value));
  });
  const { res, json } = await fetchJson(buildApiUrl(url), {
    method: "POST",
    body: fd,
  });
  return { res, json };
}

export function useMobileAnnouncements() {
  const navigate = useNavigate();
  const [lang, setLangState] = useState(() => readLoginLang());
  const i18n = useMemo(() => announcementText(lang), [lang]);
  const t = useCallback((key, params) => getAnnouncementText(lang, key, params), [lang]);

  const [me, setMe] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const meRef = useRef(null);
  const companiesRef = useRef([]);
  meRef.current = me;
  companiesRef.current = companies;

  const setLang = useCallback((next) => {
    setLangState(writeLoginLang(next));
  }, []);

  const notify = useCallback((message, tone = "success") => {
    setToast({ message, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tone === "error" ? 4000 : 2200);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetchJson(buildApiUrl("api/session/logout_api.php"), { method: "POST" });
    } finally {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const loadAnnouncements = useCallback(
    async ({ silent = false } = {}) => {
      try {
        const synced = await ensureC168DomainApiSession(meRef.current, companiesRef.current);
        if (!synced) {
          if (!silent) setError(t("accessDenied"));
          return false;
        }
        const { res, json } = await fetchJson(buildApiUrl("api/announcements/announcement_list_api.php"));
        if (!res.ok || !json?.success) {
          if (!silent) {
            setError(json?.message || t("loadAnnouncementsFailed", { message: "Unknown error" }));
            setAnnouncements([]);
          }
          return false;
        }
        if (!silent) setError("");
        setAnnouncements(Array.isArray(json.data) ? json.data : []);
        return true;
      } catch (err) {
        if (!silent) {
          setError(t("loadAnnouncementsFailed", { message: err?.message || "Unknown error" }));
          setAnnouncements([]);
        }
        return false;
      }
    },
    [t],
  );

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const { res, json } = await fetchJson(buildApiUrl("api/session/current_user_api.php"), {
          signal: ac.signal,
        });
        if (!res.ok || !json?.success || !json?.data) {
          navigate("/login", { replace: true });
          return;
        }
        const user = json.data;
        setMe(user);
        const ownerCompanies = await fetchOwnerCompaniesForDomain(ac.signal);
        if (ac.signal.aborted) return;
        setCompanies(ownerCompanies);

        if (!canAccessC168DomainPages(user)) {
          setBlocked(true);
          navigate("/more", { replace: true });
          return;
        }
        const synced = await ensureC168DomainApiSession(user, ownerCompanies);
        if (!synced) {
          setError(t("accessDenied"));
          setLoading(false);
          return;
        }
        await loadAnnouncements();
      } catch (e) {
        if (e?.name !== "AbortError") navigate("/login", { replace: true });
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      ac.abort();
      clearTimeout(toastTimer.current);
    };
  }, [navigate, loadAnnouncements, t]);

  useRealtimeDomain(
    REALTIME_DOMAINS.ANNOUNCEMENTS,
    () => {
      void loadAnnouncements({ silent: true });
    },
    { enabled: Boolean(me) && !blocked },
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAnnouncements({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadAnnouncements]);

  const publish = useCallback(
    async ({ title, sectionLabel, content }) => {
      const trimmedTitle = String(title || "").trim();
      const composed = composeAnnouncementSection(sectionLabel, content);
      if (!trimmedTitle) {
        notify(t("titleCannotBeEmpty"), "error");
        return false;
      }
      if (isRichTextEffectivelyEmpty(composed)) {
        notify(t("contentCannotBeEmpty"), "error");
        return false;
      }
      try {
        await ensureC168DomainApiSession(meRef.current, companiesRef.current);
        const { json } = await postForm("api/announcements/announcement_create_api.php", {
          title: trimmedTitle,
          content: composed,
        });
        if (json?.success) {
          notify(t("announcementPublishedSuccess"));
          await loadAnnouncements({ silent: true });
          return true;
        }
        notify(t("publishFailed", { message: json?.message || "Unknown error" }), "error");
        return false;
      } catch (err) {
        notify(t("publishFailed", { message: err?.message || "Unknown error" }), "error");
        return false;
      }
    },
    [loadAnnouncements, notify, t],
  );

  const update = useCallback(
    async ({ id, title, sectionLabel, content }) => {
      const trimmedTitle = String(title || "").trim();
      const composed = composeAnnouncementSection(sectionLabel, content);
      if (!trimmedTitle) {
        notify(t("titleCannotBeEmpty"), "error");
        return false;
      }
      if (isRichTextEffectivelyEmpty(composed)) {
        notify(t("contentCannotBeEmpty"), "error");
        return false;
      }
      try {
        await ensureC168DomainApiSession(meRef.current, companiesRef.current);
        const { json } = await postForm("api/announcements/announcement_update_api.php", {
          id,
          title: trimmedTitle,
          content: composed,
        });
        if (json?.success) {
          notify(t("announcementUpdatedSuccess"));
          await loadAnnouncements({ silent: true });
          return true;
        }
        notify(t("updateFailed", { message: json?.message || "Unknown error" }), "error");
        return false;
      } catch (err) {
        notify(t("updateFailed", { message: err?.message || "Unknown error" }), "error");
        return false;
      }
    },
    [loadAnnouncements, notify, t],
  );

  const remove = useCallback(
    async (item) => {
      if (!item?.id) return false;
      try {
        await ensureC168DomainApiSession(meRef.current, companiesRef.current);
        const { json } = await postForm("api/announcements/announcement_delete_api.php", {
          id: item.id,
        });
        if (json?.success) {
          notify(t("announcementDeletedSuccess"));
          await loadAnnouncements({ silent: true });
          return true;
        }
        notify(t("deleteFailed", { message: json?.message || "Unknown error" }), "error");
        return false;
      } catch (err) {
        notify(t("failedToDelete", { message: err?.message || "Unknown error" }), "error");
        return false;
      }
    },
    [loadAnnouncements, notify, t],
  );

  const toEditForm = useCallback((item) => {
    const split = splitAnnouncementSection(item?.content || "");
    return {
      id: item?.id || "",
      title: item?.title || "",
      sectionLabel: split.sectionLabel,
      content: normalizeRichTextInput(split.bodyHtml || ""),
    };
  }, []);

  const companyCode = String(me?.company_code || me?.company_id || "").toUpperCase();
  const groupId = String(me?.login_group_id || me?.login_identifier || "").toUpperCase();

  return {
    i18n,
    t,
    lang,
    setLang,
    me,
    companyCode,
    groupId,
    announcements,
    loading,
    refreshing,
    blocked,
    error,
    toast,
    notify,
    logout,
    refresh,
    publish,
    update,
    remove,
    toEditForm,
  };
}
