import { buildApiUrl } from "../../utils/apiUrl.js";
import { dispatchRealtimeInvalidate } from "./realtimeEvents.js";

/**
 * Single EventSource for the authenticated mobile shell.
 * Returns { stop, reconnect }.
 *
 * @param {object} opts
 * @param {() => Record<string, string|number|undefined|null>} opts.getScopeParams
 * @param {(err: Error) => void} [opts.onError]
 */
function scopeKeyFromParams(scope = {}) {
  return [
    scope.companyId ?? "",
    scope.viewGroup ?? "",
    scope.groupId ?? "",
    scope.groupAggregate ? "1" : "",
    scope.subsidiaryAccountsOnly ? "1" : "",
  ].join("|");
}

export function subscribeAppRealtime({ getScopeParams, onError } = {}) {
  let closed = false;
  let es = null;
  let reconnectTimer = null;
  let attempt = 0;
  let warnedDisabled = false;
  let lastScopeKey = "";
  let connectGen = 0;

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const closeEs = () => {
    if (es) {
      try {
        es.onerror = null;
        es.onopen = null;
        es.close();
      } catch {
        /* ignore */
      }
      es = null;
    }
  };

  const scheduleReconnect = (delayMs) => {
    clearTimers();
    if (closed) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delayMs);
  };

  const fetchTicket = async () => {
    const scope = typeof getScopeParams === "function" ? getScopeParams() || {} : {};
    lastScopeKey = scopeKeyFromParams(scope);
    const params = new URLSearchParams();
    if (scope.companyId != null && scope.companyId !== "") {
      params.set("company_id", String(scope.companyId));
    }
    if (scope.viewGroup) params.set("view_group", String(scope.viewGroup));
    if (scope.groupId) params.set("group_id", String(scope.groupId));
    if (scope.groupAggregate) params.set("group_aggregate", "1");
    if (scope.subsidiaryAccountsOnly) params.set("subsidiary_accounts_only", "1");

    const res = await fetch(buildApiUrl(`api/realtime/ticket_api.php?${params}`), {
      credentials: "include",
      cache: "no-cache",
      headers: { "Cache-Control": "no-cache" },
    });
    return res.json();
  };

  const onPayload = (type, data) => {
    attempt = 0;
    let payload = data;
    if (typeof data === "string") {
      try {
        payload = JSON.parse(data);
      } catch {
        payload = { raw: data };
      }
    }
    dispatchRealtimeInvalidate({
      type: type || payload?.type || "domain_changed",
      domain: payload?.domain,
      source: payload?.source,
      rev: payload?.rev,
      ts: payload?.ts,
      ...payload,
    });
  };

  const connect = async () => {
    if (closed) return;
    const gen = ++connectGen;
    closeEs();
    try {
      const ticketRes = await fetchTicket();
      if (closed || gen !== connectGen) return;
      const data = ticketRes?.data;
      if (!ticketRes?.success || !data?.enabled || !data?.ticket) {
        const denyMsg = String(ticketRes?.message || ticketRes?.error || "enabled=false");
        if (!warnedDisabled) {
          warnedDisabled = true;
          console.warn("[mobile-realtime] ticket disabled or failed:", denyMsg);
        }
        const accessDenied = /无权|无权限|缺少公司|缺少 group|无效的 group|Group Ledger/i.test(
          denyMsg,
        );
        attempt += 1;
        scheduleReconnect(
          accessDenied ? Math.min(120_000, 30_000 * attempt) : Math.min(60_000, 5_000 * attempt),
        );
        return;
      }
      warnedDisabled = false;

      const ssePath = String(data.sse_path || "/realtime/sse");
      const path = ssePath.startsWith("/") ? ssePath : `/${ssePath}`;
      const url = `${window.location.origin}${path}?ticket=${encodeURIComponent(data.ticket)}`;
      es = new EventSource(url);

      es.addEventListener("ledger_changed", (ev) => onPayload("ledger_changed", ev.data));
      es.addEventListener("domain_changed", (ev) => onPayload("domain_changed", ev.data));

      es.onerror = () => {
        if (closed || gen !== connectGen) return;
        closeEs();
        attempt += 1;
        scheduleReconnect(Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 4)));
      };

      es.onopen = () => {
        if (gen !== connectGen) return;
        attempt = 0;
      };
    } catch (e) {
      if (closed || gen !== connectGen) return;
      onError?.(e instanceof Error ? e : new Error(String(e)));
      attempt += 1;
      scheduleReconnect(Math.min(30_000, 2_000 * attempt));
    }
  };

  void connect();

  return {
    stop: () => {
      closed = true;
      connectGen += 1;
      clearTimers();
      closeEs();
    },
    reconnect: ({ force = false } = {}) => {
      if (closed) return;
      const scope = typeof getScopeParams === "function" ? getScopeParams() || {} : {};
      const nextKey = scopeKeyFromParams(scope);
      if (!force && nextKey === lastScopeKey && es && es.readyState === EventSource.OPEN) {
        return;
      }
      lastScopeKey = nextKey;
      clearTimers();
      attempt = 0;
      void connect();
    },
  };
}
