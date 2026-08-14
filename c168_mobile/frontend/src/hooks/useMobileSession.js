import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { assertApiOk, fetchJson } from "../lib/fetchJson.js";
import { buildApiUrl } from "../utils/apiUrl.js";

const AUTH_PATHS = [
  "/login",
  "/owner-secondary-password",
  "/user-secondary-password",
  "/reset-password",
];

export function isMobileAuthPath(pathname) {
  return AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Cached session user for app chrome (bottom nav). */
export function useMobileSession() {
  const { pathname } = useLocation();
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (isMobileAuthPath(pathname)) {
      setMe(null);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const { res, json } = await fetchJson(buildApiUrl("api/session/current_user_api.php"), {
          credentials: "include",
        });
        assertApiOk(res, json);
        if (!cancelled) setMe(json.data || null);
      } catch {
        if (!cancelled) setMe(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return me;
}
