import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { usePullToRefresh } from "../../hooks/usePullToRefresh.js";
import { useDirectScrollChrome } from "../../hooks/useDirectScrollChrome.js";
import { useScrollIdleVisible } from "../../hooks/useScrollIdleVisible.js";
import { isMobileMoreStackPath } from "../../utils/mobilePermissions.js";
import MobileAppBar from "./MobileAppBar.jsx";
import MobileNotifications, { fetchMobileAnnouncements } from "./MobileNotifications.jsx";
import PullRefreshIndicator from "./PullRefreshIndicator.jsx";
import "./mobile-shell.css";

export default function MobileShell({
  children,
  overlay = null,
  stickyBar = null,
  floatingAction = null,
  onMainScrollStart,
  i18n,
  me,
  onRefresh,
  refreshing = false,
  showBottomNav = true,
  onChromeOpen,
  overlayOpen = false,
}) {
  const { pathname } = useLocation();
  const navVisible = showBottomNav && !isMobileMoreStackPath(pathname);
  const labels = {
    navHome: "Home",
    navReport: "Report",
    navTransaction: "Transaction",
    navAccount: "Account",
    navMore: "More",
    ...(i18n || {}),
  };
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const mainRef = useRef(null);
  const topChromeRef = useRef(null);
  const [topChromeH, setTopChromeH] = useState(118);

  const refreshPage = useCallback(async () => {
    if (typeof onRefresh === "function") {
      await onRefresh();
      return;
    }
    try {
      const rows = await fetchMobileAnnouncements();
      setAnnouncements(rows);
    } catch {
      /* ignore */
    }
  }, [onRefresh]);

  const { pullPx, progress, phase, active, isAnimating } = usePullToRefresh(mainRef, {
    onRefresh: refreshPage,
    enabled: typeof onRefresh === "function",
    refreshing,
  });
  /** Only gesture-driven pull refresh should show chrome loading UI. */
  const gestureRefreshing = phase === "refreshing";

  const floatingIdleVisible = useScrollIdleVisible(mainRef, {
    idleMs: 320,
    onScrollStart: onMainScrollStart,
  });
  const showFloating = Boolean(floatingAction) && floatingIdleVisible && !overlayOpen;

  useLayoutEffect(() => {
    const el = topChromeRef.current;
    if (!el) return undefined;
    const measure = () => {
      const h = el.offsetHeight;
      if (h > 0) setTopChromeH(h);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [stickyBar, gestureRefreshing]);

  const forceChrome =
    active || isAnimating || overlayOpen || notifyOpen || gestureRefreshing;

  useDirectScrollChrome({
    scrollRef: mainRef,
    topChromeRef,
    maxOffset: Math.max(topChromeH, 1),
    topReveal: 12,
    paused: forceChrome,
  });

  const openNotifications = () => {
    onChromeOpen?.();
    setNotifyOpen(true);
  };

  useEffect(() => {
    if (!overlayOpen) return;
    setNotifyOpen(false);
  }, [overlayOpen]);

  useEffect(() => {
    if (!me) return undefined;
    const ac = new AbortController();
    (async () => {
      try {
        const rows = await fetchMobileAnnouncements(ac.signal);
        if (!ac.signal.aborted) setAnnouncements(rows);
      } catch {
        if (!ac.signal.aborted) setAnnouncements([]);
      }
    })();
    return () => ac.abort();
  }, [me]);

  useEffect(() => {
    if (!notifyOpen) return undefined;
    setNotifyLoading(true);
    const ac = new AbortController();
    (async () => {
      try {
        const rows = await fetchMobileAnnouncements(ac.signal);
        if (!ac.signal.aborted) setAnnouncements(rows);
      } catch {
        /* keep previous */
      } finally {
        if (!ac.signal.aborted) setNotifyLoading(false);
      }
    })();
    return () => ac.abort();
  }, [notifyOpen]);

  const contentShift = pullPx > 0.5 ? pullPx : 0;
  const contentTransition = isAnimating && phase !== "pulling" && phase !== "armed";
  const mainPadTop = topChromeH;

  const mainPadBottom = navVisible
    ? "var(--m-shell-main-pad-bottom-nav)"
    : floatingAction
      ? "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)"
      : "var(--m-shell-main-pad-bottom)";

  return (
    <div className={`m-shell${navVisible ? "" : " m-shell--no-nav"}`}>
      <div ref={topChromeRef} className="m-shell-chrome">
        <MobileAppBar
          i18n={labels}
          notificationCount={announcements.length}
          onOpenNotifications={openNotifications}
          onRefresh={typeof onRefresh === "function" ? refreshPage : undefined}
          refreshing={gestureRefreshing}
        />

        {stickyBar ? (
          <div className="m-shell-sticky-wrap">
            <div className="m-shell-sticky-inner">{stickyBar}</div>
          </div>
        ) : null}
      </div>

      <main
        ref={mainRef}
        className="m-shell-main"
        style={{
          paddingTop: mainPadTop,
          paddingBottom: mainPadBottom,
        }}
      >
        <div
          style={{
            transform: contentShift ? `translate3d(0, ${contentShift}px, 0)` : undefined,
            transition: contentTransition ? "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
          }}
        >
          <PullRefreshIndicator pullPx={pullPx} progress={progress} phase={phase} labels={labels} />
          <div className={gestureRefreshing ? "m-shell-main--refreshing" : ""}>{children}</div>
        </div>
      </main>

      {floatingAction ? (
        <div
          className={`m-shell-fab-slot ${showFloating ? "m-shell-fab-slot--visible" : "m-shell-fab-slot--hidden"}`}
          aria-hidden={!showFloating}
        >
          {floatingAction}
        </div>
      ) : null}

      {overlay}
      <MobileNotifications
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        i18n={labels}
        items={announcements}
        loading={notifyLoading}
      />
    </div>
  );
}
