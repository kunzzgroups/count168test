import { buildApiUrl } from "../utils/apiUrl.js";

/** System FX API (DB-cached). Upstream Frankfurter is server-side + client fallback. */
const SYSTEM_FX_API = "api/fx/fx_rates_api.php";
const FRANKFURTER_API = "https://api.frankfurter.dev/v2/rates";

function normalizeQuotes(baseCode, quoteCodes) {
  const base = String(baseCode || "").trim().toUpperCase();
  return [
    ...new Set(
      (quoteCodes || [])
        .map((c) => String(c || "").trim().toUpperCase())
        .filter((c) => c && c !== base),
    ),
  ];
}

function extractFxRateRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.rates) && payload.rates[0]?.quote != null) return payload.rates;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") {
    if (Array.isArray(payload.data.rows)) return payload.data.rows;
    if (Array.isArray(payload.data.rates) && payload.data.rates[0]?.quote != null) {
      return payload.data.rates;
    }
  }
  return null;
}

export async function fetchFrankfurterRates(baseCode, quoteCodes, { signal, date = null } = {}) {
  const base = String(baseCode || "").trim().toUpperCase();
  const quotes = normalizeQuotes(base, quoteCodes);
  if (!base) return { rates: {}, date: null };
  if (!quotes.length) return { rates: { [base]: 1 }, date: null };

  const params = new URLSearchParams({ base, quotes: quotes.join(",") });
  if (date) params.set("date", String(date));

  const timeoutMs = 8000;
  const fetchWithTimeout = (url, init = {}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new DOMException("Exchange rate request timed out", "TimeoutError"));
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      fetch(url, { signal, cache: "no-store", ...init })
        .then((response) => {
          clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve(response);
        })
        .catch((err) => {
          clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        });
    });

  let res;
  try {
    res = await fetchWithTimeout(`${buildApiUrl(SYSTEM_FX_API)}?${params}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") throw err;
    res = await fetchWithTimeout(`${FRANKFURTER_API}?${params}`);
    if (!res.ok) throw new Error("Failed to load exchange rates");
  }

  const json = await res.json();
  const rows = extractFxRateRows(json) || [];
  const rates = { [base]: 1 };
  for (const row of rows) {
    const quote = String(row.quote || "").toUpperCase();
    const rate = parseFloat(row.rate);
    if (quote && Number.isFinite(rate) && rate > 0) rates[quote] = rate;
  }
  return {
    rates,
    date: rows[0]?.date || date || null,
  };
}

/** Pick rate date: use range end if not in the future, else latest. */
export function resolveFrankfurterDate(endYmd) {
  if (!endYmd) return null;
  const end = new Date(`${endYmd}T12:00:00`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (Number.isNaN(end.getTime()) || end > today) return null;
  return endYmd;
}

export function convertToBaseAmount(amount, fromCode, baseCode, rates) {
  const from = String(fromCode || "").trim().toUpperCase();
  const base = String(baseCode || "").trim().toUpperCase();
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return null;
  if (from === base) return n;
  const rate = rates?.[from];
  if (!rate || rate <= 0) return null;
  return n / rate;
}

/** True when base rate exists and at least one foreign quote can convert (partial OK). */
export function frankfurterRatesPartiallyUsable(base, quoteCodes, rates) {
  const baseCode = String(base || "").trim().toUpperCase();
  if (!baseCode || !rates?.[baseCode] || rates[baseCode] <= 0) return false;
  const quotes = [
    ...new Set(
      (quoteCodes || [])
        .map((c) => String(c || "").trim().toUpperCase())
        .filter((c) => c && c !== baseCode),
    ),
  ];
  if (!quotes.length) return true;
  return quotes.some((quote) => {
    const rate = rates[quote];
    return rate && rate > 0;
  });
}

/** Sum row.earnings converted into base (desktop parity for multi-currency panel total). */
export function sumConvertedEarnings(rows, baseCode, rates) {
  let total = 0;
  let hasMissing = false;
  for (const row of rows || []) {
    const converted = convertToBaseAmount(row.earnings, row.code, baseCode, rates);
    if (converted == null && String(row.code).toUpperCase() !== String(baseCode).toUpperCase()) {
      hasMissing = true;
      continue;
    }
    total += converted ?? 0;
  }
  return { total, hasMissing };
}

function frankfurterUnitRate(fromCode, baseCode, rates) {
  const from = String(fromCode || "").trim().toUpperCase();
  const base = String(baseCode || "").trim().toUpperCase();
  if (from === base) return 1;
  const rate = rates?.[from];
  if (!rate || rate <= 0) return null;
  return 1 / rate;
}

export function formatFrankfurterUnitRate(fromCode, baseCode, rates) {
  const unitRate = frankfurterUnitRate(fromCode, baseCode, rates);
  if (unitRate == null) return "—";
  if (unitRate === 1) return "1";
  const abs = Math.abs(unitRate);
  if (abs >= 1000) return unitRate.toFixed(2);
  if (abs >= 100) return unitRate.toFixed(4);
  return unitRate.toFixed(6);
}

export function computeDisplayConvertedAmount(amount, fromCode, baseCode, rates) {
  const formatted = formatFrankfurterUnitRate(fromCode, baseCode, rates);
  if (formatted === "—") return null;
  const unitRate = parseFloat(formatted);
  const n = parseFloat(amount);
  if (!Number.isFinite(unitRate) || !Number.isFinite(n)) return null;
  return n * unitRate;
}
