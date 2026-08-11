import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import MobileShell from "../../components/layout/MobileShell.jsx";
import { fetchJson } from "../../lib/fetchJson.js";
import { readLoginLang, writeLoginLang } from "../../lib/loginLang.js";
import { MORE_I18N } from "../../translateFile/moreTranslate.js";
import { buildApiUrl } from "../../utils/apiUrl.js";
import { canAccessC168DomainPages } from "../../lib/c168DomainAccess.js";
import { canAccessAdmin, canAccessMaintenance, canShowReportEntry } from "../../utils/mobilePermissions.js";
import { maintenanceText } from "../../translateFile/maintenanceTranslate.js";
import "./more.css";

export default function MorePage() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState(() => readLoginLang());
  const i18n = useMemo(() => MORE_I18N[lang] || MORE_I18N.en, [lang]);

  const setLang = useCallback((next) => {
    setLangState(writeLoginLang(next));
  }, []);

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
        setMe(json.data);
      } catch (error) {
        if (error?.name !== "AbortError") navigate("/login", { replace: true });
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [navigate]);

  const logout = useCallback(async () => {
    try {
      await fetchJson(buildApiUrl("api/session/logout_api.php"), { method: "POST" });
    } finally {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const companyCode = String(me?.company_code || me?.company_id || "").toUpperCase();
  const groupId = String(me?.login_group_id || me?.login_identifier || "").toUpperCase();
  const mt = maintenanceText(lang);
  const tools = [];
  if (canAccessAdmin(me)) {
    tools.push({
      to: "/more/users",
      icon: "fa-user-gear",
      title: i18n.userManagement,
      description: i18n.userManagementDescription,
    });
  }
  if (canAccessMaintenance(me)) {
    tools.push({
      to: "/maintenance",
      icon: "fa-screwdriver-wrench",
      title: mt.maintenance,
      description: mt.maintenanceDescription,
    });
  }
  if (canShowReportEntry(me)) {
    tools.push({
      to: "/report",
      icon: "fa-chart-column",
      title: i18n.report,
      description: i18n.reportDescription,
    });
  }
  if (canAccessC168DomainPages(me)) {
    tools.push({
      to: "/more/domain",
      icon: "fa-globe",
      title: i18n.domain,
      description: i18n.domainDescription,
    });
  }

  return (
    <MobileShell
      i18n={i18n}
      me={me}
      companyCode={companyCode}
      groupId={groupId}
      onLogout={logout}
      onRefresh={undefined}
      lang={lang}
      onLangChange={setLang}
    >
      <main className="m-more-page">
        <header className="m-more-heading">
          <p>{i18n.moreSubtitle}</p>
          <h1>{i18n.more}</h1>
        </header>

        {loading ? (
          <div className="m-more-state">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
          </div>
        ) : tools.length ? (
          <div className="m-more-grid">
            {tools.map((tool) => (
              <Link key={tool.to} to={tool.to} className="m-more-card tap-scale">
                <span className="m-more-icon">
                  <i className={`fas ${tool.icon}`} aria-hidden="true" />
                </span>
                <span className="m-more-copy">
                  <strong>{tool.title}</strong>
                  <small>{tool.description}</small>
                </span>
                <span className="m-more-open">
                  {i18n.open}
                  <i className="fas fa-chevron-right" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="m-more-state">
            <i className="fas fa-box-open" aria-hidden="true" />
            <p>{i18n.noTools}</p>
          </div>
        )}
      </main>
    </MobileShell>
  );
}
