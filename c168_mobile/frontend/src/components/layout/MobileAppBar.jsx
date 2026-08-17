import { brandWhiteLogoUrl, onBrandLogoError } from "../../lib/brandAssets.js";
import "./mobile-app-bar.css";

export default function MobileAppBar({
  i18n,
  onOpenNotifications,
  onRefresh,
  refreshing = false,
  notificationCount = 0,
}) {
  const count = Number(notificationCount) || 0;

  return (
    <header className="m-appbar">
      <div className="m-appbar-grid">
        <span className="m-appbar-spacer" aria-hidden="true" />

        <div className="m-appbar-center">
          {typeof onRefresh === "function" ? (
            <button
              type="button"
              onClick={() => {
                if (refreshing) return;
                onRefresh();
              }}
              disabled={refreshing}
              className="m-appbar-logo-btn tap-scale"
              aria-label={i18n?.refresh || "Refresh"}
              title={i18n?.refresh || "Refresh"}
            >
              <img
                src={brandWhiteLogoUrl()}
                alt="EazyCount"
                className={`m-appbar-logo${refreshing ? " m-appbar-logo--refreshing" : ""}`}
                draggable={false}
                data-logo-idx="0"
                data-logo-kind="white"
                onError={onBrandLogoError}
              />
            </button>
          ) : (
            <img
              src={brandWhiteLogoUrl()}
              alt="EazyCount"
              className="m-appbar-logo"
              draggable={false}
              data-logo-idx="0"
              data-logo-kind="white"
              onError={onBrandLogoError}
            />
          )}
        </div>

        <button
          type="button"
          onClick={onOpenNotifications}
          className="m-appbar-btn m-appbar-btn--notify tap-scale"
          aria-label={i18n?.notifications || "Notifications"}
        >
          <i className="fas fa-bell text-[18px]" aria-hidden="true" />
          {count > 0 ? (
            <span className="m-appbar-badge">{count > 9 ? "9+" : count}</span>
          ) : null}
        </button>
      </div>

      <div className="m-appbar-progress-track" aria-hidden={!refreshing}>
        <div
          className={`m-appbar-progress-bar ${refreshing ? "m-appbar-progress-bar--active" : "m-appbar-progress-bar--idle"}`}
        />
      </div>
    </header>
  );
}
