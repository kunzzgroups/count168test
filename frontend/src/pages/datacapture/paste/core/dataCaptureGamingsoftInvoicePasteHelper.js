/**
 * Gamingsoft PDF invoice (PRODUCT BRAND / TYPE / TERMS / NET WIN / TOTAL)
 * clipboard helper — scoped only.
 *
 * Chrome often flattens a table row into one single-space line with no tabs:
 *   "Ag:Asiagaming - Gsc Lc - VTBM PT 7.50 (MYR) 171.50 12.86"
 *   "Ag Asiagaming - GscLc - VTBM PT 7.50 (MYR) 171.50 12.86"
 * 1.TEXT / 2.FORMAT would otherwise keep the line as N×1.
 *
 * Callers check {@link tryReshapeGamingsoftInvoicePlainMatrix} which returns
 * null when the clipboard is not this invoice shape.
 */

const CURRENCY_PAREN_RE = /^\([A-Za-z]{3}\)$/;
const TYPE_CODE_RE = /^[A-Za-z]{2,4}$/;
const MONEY_RE = /^-?\$?[\d,]+(?:\.\d+)?$/;
const HEADER_HINT_RE =
  /PRODUCT\s*BRAND|NET\s*WIN|TERMS\s*\(?%\)?|INVOICE\s*NO|CURRENCY\s*RATE|GAMINGSOFT/i;
const TOTAL_LABEL_RE = /^(?:GRAND\s*TOTAL|SUB\s*TOTAL|SUBTOTAL|TOTAL)$/i;

function normalizeLine(line) {
  return String(line ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMoneyToken(token) {
  const t = String(token ?? "").trim();
  if (!t || !MONEY_RE.test(t)) return false;
  // Bare integers longer than invoice row numbers are uncommon as amounts;
  // still allow "25" / "7.50" / "1,758.33".
  return /\d/.test(t);
}

function isCurrencyParen(token) {
  return CURRENCY_PAREN_RE.test(String(token ?? "").trim());
}

function isTypeCode(token) {
  const t = String(token ?? "").trim();
  if (!TYPE_CODE_RE.test(t)) return false;
  // Keep currency-like tokens out of TYPE.
  if (/^(MYR|USD|SGD|HKD|CNY|THB|IDR|VND|EUR|GBP|AUD|JPY|KHR|USDT)$/i.test(t)) {
    return false;
  }
  return true;
}

function isHeaderOrChromeLine(line) {
  const t = normalizeLine(line);
  if (!t) return true;
  if (HEADER_HINT_RE.test(t) && !isMoneyToken(t.split(/\s+/).pop())) return true;
  // Full header rows usually lack a TYPE + % + (CUR) + amount tail.
  if (/^#?\s*PRODUCT/i.test(t)) return true;
  return false;
}

/**
 * Split one flattened Gamingsoft invoice body/total line into columns.
 * Preferred shape:
 *   [rowNo?] brand | TYPE | terms% | (CUR) netWin | total
 * @returns {string[] | null}
 */
export function trySplitGamingsoftInvoiceLine(line) {
  const raw = normalizeLine(line);
  if (!raw || isHeaderOrChromeLine(raw)) return null;

  const words = raw.split(" ").filter(Boolean);

  // Footer: "Grand Total 12.86" / "Sub Total 12.86"
  if (words.length >= 2 && words.length <= 4) {
    const last = words[words.length - 1];
    const label = words.slice(0, -1).join(" ");
    if (isMoneyToken(last) && TOTAL_LABEL_RE.test(label.replace(/\s+/g, " "))) {
      return [label, last];
    }
  }

  if (words.length < 5) return null;

  let i = words.length - 1;
  const total = words[i];
  if (!isMoneyToken(total)) return null;
  i -= 1;

  // Body rows always carry NET WIN as "(CUR) amount" in Gamingsoft invoices.
  // Require the currency paren so unrelated TYPE + number dumps do not match.
  if (i < 1 || !isMoneyToken(words[i]) || !isCurrencyParen(words[i - 1])) {
    return null;
  }
  const netWin = `${words[i - 1]} ${words[i]}`;
  i -= 2;

  if (i < 1) return null;
  const terms = words[i];
  if (!isMoneyToken(terms)) return null;
  i -= 1;

  const type = words[i];
  if (!isTypeCode(type)) return null;
  i -= 1;
  if (i < 0) return null;

  let brandParts = words.slice(0, i + 1);
  let rowNo = null;
  if (brandParts.length >= 2 && /^\d{1,4}$/.test(brandParts[0])) {
    rowNo = brandParts[0];
    brandParts = brandParts.slice(1);
  }

  const brand = brandParts.join(" ").trim();
  if (!brand || !/[A-Za-z]/.test(brand)) return null;
  // Reject pure numeric "brand" leftovers.
  if (isMoneyToken(brand) && !/[A-Za-z:]/.test(brand)) return null;

  const cells = [];
  if (rowNo != null) cells.push(rowNo);
  cells.push(brand, type, terms, netWin, total);
  return cells;
}

/**
 * Strict gate: invoice body row with TYPE + terms + (CUR) amount + total.
 */
export function looksLikeGamingsoftInvoicePlain(pastedData) {
  const lines = String(pastedData ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);

  if (!lines.length) return false;

  for (const line of lines) {
    if (isHeaderOrChromeLine(line)) continue;
    const split = trySplitGamingsoftInvoiceLine(line);
    if (split && split.length >= 5) return true;
  }
  return false;
}

/**
 * Reshape Gamingsoft invoice plain clipboard into a horizontal matrix.
 * @returns {string[][] | null}
 */
export function tryReshapeGamingsoftInvoicePlainMatrix(pastedData) {
  const text = String(pastedData ?? "");
  if (!text.trim()) return null;

  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);

  // Dense TSV already preserves columns — leave that path alone.
  const tabHeavy =
    lines.length >= 2 &&
    lines.filter((line) => line.includes("\t")).length >= Math.ceil(lines.length * 0.6);
  if (tabHeavy) return null;

  if (!looksLikeGamingsoftInvoicePlain(pastedData)) return null;

  const rows = [];
  for (const line of lines) {
    if (line.includes("\t")) {
      // Sparse / mixed: try tab fields first; fall back to smart split of joined text.
      const tabCells = line.split("\t").map((c) => c.trim()).filter(Boolean);
      if (tabCells.length >= 5) {
        rows.push(tabCells);
        continue;
      }
      const joined = trySplitGamingsoftInvoiceLine(tabCells.join(" "));
      if (joined) {
        rows.push(joined);
        continue;
      }
    }

    const split = trySplitGamingsoftInvoiceLine(line);
    if (split) {
      rows.push(split);
      continue;
    }
  }

  if (!rows.length) return null;
  if (!rows.some((row) => row.length >= 5)) return null;

  const maxCols = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = [...row];
    while (next.length < maxCols) next.push("");
    return next;
  });
}
