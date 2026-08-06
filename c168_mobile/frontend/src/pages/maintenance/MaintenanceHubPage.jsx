import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import MobileShell from "../../components/layout/MobileShell.jsx";
import { fetchJson } from "../../lib/fetchJson.js";
import { maintenanceText } from "../../translateFile/maintenanceTranslate.js";
import { buildApiUrl } from "../../utils/apiUrl.js";
import {
  canAccessBankProcess,
  canAccessBankprocessMaintenance,
  canAccessMaintenance,
  canAccessPaymentMaintenance,
  canAccessTransactionMaintenance,
  resolveMobileLandingPath,
} from "../../utils/mobilePermissions.js";
import "./maintenance.css";

export default function MaintenanceHubPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState(() => localStorage.getItem("login_lang") || "en");
  const i18n = useMemo(() => maintenanceText(lang), [lang]);

  const setLang = useCallback((next) => {
    const normalized = next === "zh" ? "zh" : "en";
    localStorage.setItem("login_lang", normalized);
    setLangState(normalized);
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
        const user = json.data;
        if (!canAccessMaintenance(user)) {
          navigate(resolveMobileLandingPath(user), { replace: true });
          return;
        }
        setMe(user);
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

  const records = [];
  if (canAccessTransactionMaintenance(me)) {
    records.push({
      to: "/maintenance/transaction",
      icon: "fa-file-invoice",
      title: i18n.txMaintenanceTitle,
      desc: i18n.txMaintenanceDesc,
      features: i18n.txFeatures,
    });
  }
  if (canAccessPaymentMaintenance(me)) {
    records.push({
      to: "/maintenance/payment",
      icon: "fa-wallet",
      title: i18n.payMaintenanceTitle,
      desc: i18n.payMaintenanceDesc,
      features: i18n.payFeatures,
      badge: i18n.deleteAccess,
      violet: true,
    });
  }
  if (canAccessBankprocessMaintenance(me)) {
    records.push({
      to: "/maintenance/bankprocess",
      icon: "fa-building-columns",
      title: i18n.bpMaintenanceTitle,
      desc: i18n.bpMaintenanceDesc,
      features: i18n.bpFeatures,
      badge: i18n.deleteAccess,
      violet: true,
    });
  }

  // Data Capture / Formula are desktop-only — omit from mobile hub.
  const setup = [];
  if (canAccessBankProcess(me)) {
    setup.push({
      to: "/maintenance/bank-process",
      icon: "fa-building-columns",
      label: i18n.setupBank,
      desc: i18n.setupBankDesc,
      features: i18n.setupBankFeatures,
    });
  }

  return (
    <MobileShell
      i18n={i18n}
      me={me}
      onLogout={logout}
      lang={lang}
      onLangChange={setLang}
    >
      <main className="m-mt-page">
        <section className="m-mt-hero">
          <span className="m-mt-hero-icon">
            <i className="fas fa-screwdriver-wrench" aria-hidden="true" />
          </span>
          <div>
            <h1>{i18n.hubTitle}</h1>
            <p>{i18n.hubSubtitle}</p>
          </div>
        </section>

        {loading ? (
          <div className="m-mt-state">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
          </div>
        ) : (
          <>
            <p className="m-mt-section-label">{i18n.sectionRecords}</p>
            <div className="m-mt-record-list">
              {records.map((r) => (
                <Link key={r.to} to={r.to} className="m-mt-record-card tap-scale">
                  <span className={`m-mt-record-icon${r.violet ? " is-violet" : ""}`}>
                    <i className={`fas ${r.icon}`} aria-hidden="true" />
                  </span>
                  <span className="m-mt-record-copy">
                    <strong>{r.title}</strong>
                    <small>{r.desc}</small>
                    <em className="m-mt-record-features">{r.features}</em>
                    {r.badge ? <span className="m-mt-record-badge">{r.badge}</span> : null}
                  </span>
                  <i className="fas fa-chevron-right m-mt-record-chevron" aria-hidden="true" />
                </Link>
              ))}
            </div>

            {setup.length > 0 ? (
              <>
                <p className="m-mt-section-label">{i18n.sectionSetup}</p>
                <div className="m-mt-setup-list">
                  {setup.map((item) => (
                    <Link key={item.label} to={item.to} className="m-mt-record-card tap-scale">
                      <span className="m-mt-record-icon is-violet">
                        <i className={`fas ${item.icon}`} aria-hidden="true" />
                      </span>
                      <span className="m-mt-record-copy">
                        <strong>{item.label}</strong>
                        {item.desc ? <small>{item.desc}</small> : null}
                        {item.features ? <em className="m-mt-record-features">{item.features}</em> : null}
                      </span>
                      <i className="fas fa-chevron-right m-mt-record-chevron" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </main>
    </MobileShell>
  );
}
