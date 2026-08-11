import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { notifyTransactionListInvalidated } from "../transactionPaymentLogic.js";
import {
  MOBILE_REALTIME_SCOPE_EVENT,
  getMobileRealtimeScope,
} from "./mobileRealtimeScope.js";
import { onRealtimeInvalidate, REALTIME_DOMAINS } from "./realtimeEvents.js";
import { subscribeAppRealtime } from "./subscribeAppRealtime.js";

/** Maintenance / capture writes that change balances — belt if ledger publish missed. */
const LEDGER_TOUCHING_SOURCES = new Set([
  "capture_delete",
  "capture_update",
  "payment_delete",
  "payment_update",
  "bankprocess_delete",
  "transaction_delete",
  "post_to_transaction",
  "restore",
  "domain_fee_create",
  "domain_fee_update",
  "summary_submit",
]);

function isAuthShellPath(pathname) {
  const p = String(pathname || "");
  if (!p || p === "/") return false;
  if (p.startsWith("/login")) return false;
  if (p.startsWith("/reset-password")) return false;
  return true;
}

/**
 * One SSE connection for authenticated mobile routes.
 * LEDGER (and ledger-touching domains) → notifyTransactionListInvalidated.
 */
export default function MobileRealtimeBridge() {
  const { pathname } = useLocation();
  const enabled = isAuthShellPath(pathname);

  useEffect(() => {
    if (!enabled) return undefined;

    const ctl = subscribeAppRealtime({
      getScopeParams: getMobileRealtimeScope,
    });

    let filterTimer = null;
    const onScope = () => {
      if (filterTimer) clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        filterTimer = null;
        ctl.reconnect();
      }, 300);
    };
    window.addEventListener(MOBILE_REALTIME_SCOPE_EVENT, onScope);

    return () => {
      window.removeEventListener(MOBILE_REALTIME_SCOPE_EVENT, onScope);
      if (filterTimer) clearTimeout(filterTimer);
      ctl.stop();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;

    return onRealtimeInvalidate("*", (detail) => {
      const domain = String(detail.domain || "");
      const source = String(detail.source || "");
      const type = String(detail.type || "");

      const invalidateLedger = (tag) => {
        notifyTransactionListInvalidated(tag);
      };

      if (domain === REALTIME_DOMAINS.LEDGER || type === "ledger_changed") {
        invalidateLedger("realtime_ledger");
        return;
      }

      if (domain === REALTIME_DOMAINS.DATACAPTURE && LEDGER_TOUCHING_SOURCES.has(source)) {
        invalidateLedger(`realtime_${source}`);
        return;
      }

      if (domain === REALTIME_DOMAINS.MAINTENANCE && LEDGER_TOUCHING_SOURCES.has(source)) {
        invalidateLedger(`realtime_${source}`);
        return;
      }

      if (
        domain === REALTIME_DOMAINS.DOMAIN &&
        (LEDGER_TOUCHING_SOURCES.has(source) || /fee/.test(source))
      ) {
        invalidateLedger(`realtime_${source || "domain"}`);
      }
    });
  }, [enabled]);

  return null;
}
