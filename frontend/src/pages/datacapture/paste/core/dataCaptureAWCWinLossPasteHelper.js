/**
 * AWC / Usplaynet WinLoss Summary Report clipboard helper — scoped only.
 *
 * Source: gciag.usplaynet.com/report/winLossSummaryReport (and sibling AWC sites).
 *
 * Fixes unique to this source:
 * - single-row table copy (1 data row) fails shared TSV detection because
 *   `plainTextLooksLikeAlignedTsv` requires >= 2 lines; this helper reshapes
 *   a lone TSV row into a proper 1×N matrix so it pastes column-by-column
 *   instead of landing as one cell.
 * - multi-row copies (including Sub Total / Total footer rows) already pass
 *   shared detection; this helper still reshapes them to keep alignment.
 *
 * Detection: wide tab-separated rows (10–25 cols) with money amounts,
 * percentages, and Sub Total / Total summary markers.
 */

const MONEY_RE = /^\(?\$?-?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?$/;
const PCT_RE = /^-?\d+(?:\.\d+)?\s*%$/;
const SUB_TOTAL_RE = /^Sub\s+Total\s*\[/i;
const TOTAL_RE = /^Total$/i;

function isMoneyToken(t) {
  return MONEY_RE.test(String(t ?? "").trim());
}

function isPctToken(t) {
  return PCT_RE.test(String(t ?? "").trim());
}

function isSubTotalLabel(t) {
  return SUB_TOTAL_RE.test(String(t ?? "").trim());
}

function isTotalLabel(t) {
  return TOTAL_RE.test(String(t ?? "").trim());
}

/**
 * Strict gate: AWC WinLoss Summary has wide rows (10–25 cols).
 * Single-row copies still carry 10+ tab-separated cells with money amounts.
 */
export function looksLikeAWCWinLossPlain(pastedData) {
  const text = String(pastedData ?? "");
  if (!text.includes("\t")) return false;

  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => String(line).trim() !== "");

  if (!lines.length) return false;

  // Every line must be tab-separated (not a vertical field dump with sparse tabs).
  const tabLines = lines.filter((line) => line.includes("\t"));
  if (tabLines.length < lines.length * 0.5) return false;

  // Column count: WinLoss Summary is wide (10–25 columns).
  const widths = tabLines.map((line) => line.split("\t").length);
  const maxCols = Math.max(...widths);
  if (maxCols < 10 || maxCols > 25) return false;

  // All tab-lines should have roughly the same column count (±2).
  const minCols = Math.min(...widths);
  if (maxCols - minCols > 2) return false;

  // At least some cells must look like money or percentages.
  const allCells = tabLines.flatMap((line) => line.split("\t"));
  const moneyCells = allCells.filter(isMoneyToken);
  const pctCells = allCells.filter(isPctToken);

  if (moneyCells.length < 2 && pctCells.length < 1) return false;

  // For single-row: require enough money cells.
  if (lines.length === 1) {
    return moneyCells.length >= 3 || (moneyCells.length >= 1 && pctCells.length >= 1);
  }

  // Strong signal: Sub Total / Total marker.
  const hasSummaryRow = tabLines.some((line) => {
    const cells = line.split("\t").map((c) => c.trim());
    return cells.some((c) => isSubTotalLabel(c) || isTotalLabel(c));
  });
  if (hasSummaryRow) return true;

  return moneyCells.length >= Math.ceil(maxCols * 0.3);
}

/**
 * Reshape AWC WinLoss Summary plain clipboard into a horizontal matrix.
 * Handles both single-row and multi-row TSV.
 *
 * @param {string} pastedData
 * @returns {string[][] | null}
 */
export function tryReshapeAWCWinLossPlainMatrix(pastedData) {
  const text = String(pastedData ?? "");

  if (!looksLikeAWCWinLossPlain(text)) return null;

  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => String(line).trim() !== "");

  if (!lines.length) return null;

  const rows = lines.map((line) => {
    if (line.includes("\t")) return line.split("\t");
    return [line];
  });

  const maxCols = Math.max(...rows.map((row) => row.length), 0);
  if (maxCols < 2) return null;

  rows.forEach((row) => {
    while (row.length < maxCols) row.push("");
  });

  if (rows.length < 1) return null;
  return rows;
}
