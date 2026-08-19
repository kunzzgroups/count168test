/**
 * PS3838 / ps38ag partner-ui Win Loss Detail (fixed-data-table div grid).
 *
 * Source: https://www.ps38ag.com/partner-ui-v2/report-winloss-detail-v2
 *
 * Unique to this report:
 * - Rows/cells are divs (`fixedDataTableRowLayout_*`, `role=gridcell`), not <table>
 * - Frozen + scroll panes duplicate the same `rowindex` with `left` reset to 0
 * - Chrome HTML copy collapses a visual row into stacked text inside a few cells
 *
 * Callers must use {@link tryBuildPs38FixedDataTable} / {@link tryReshapePs38WinLossPlainMatrix}
 * which return null when the clipboard is not this grid.
 */

import {
  isVerticalDumpMoneyToken,
  normalizeVerticalDumpToken,
} from "./dataCaptureVerticalDumpDetect.js";

const LEVEL_RE = /^(AGENT|MEMBER|MASTER|PLAYER)$/i;
const CURRENCY_RE = /^(MYR|USD|SGD|HKD|CNY|THB|IDR|VND|EUR|GBP|AUD|JPY|KHR|USDT)$/i;
const USER_RE = /^[A-Z]{2,}\d+[A-Z]\d+$/i;
const HEADER_LABEL_RE =
  /^(NO\.?|USERNAME|NICKNAME|NAME|LEVEL|CURRENCY|TOTAL WAGER|TURNOVER|VOLUME|GROSS COMM|MEMBER|AGENT|MASTER AGENT|COMPANY|WIN\/LOSS|WIN LOSS|COMM|TOTAL)$/i;

function cellPlainText(el) {
  return normalizeVerticalDumpToken(el?.textContent ?? "");
}

function isFdtRoot(root) {
  if (!root?.querySelector) return false;
  return Boolean(
    root.querySelector(
      [
        ".fixedDataTableRowLayout_rowWrapper",
        ".fixedDataTableRowLayout_main",
        ".public_fixedDataTableRow_main",
        ".fixedDataTableCellLayout_main",
        ".public_fixedDataTableCell_main",
        "[rowindex]",
      ].join(", "),
    ),
  );
}

function looksLikePs38FdtMarkup(root) {
  if (!isFdtRoot(root)) return false;
  const html = String(root.innerHTML || "");
  if (/fixedDataTable/i.test(html) || /public_fixedDataTable/i.test(html)) return true;
  const gridcells = root.querySelectorAll('[role="gridcell"]');
  if (gridcells.length < 10) return false;
  const rowIndexed = root.querySelectorAll("[rowindex]");
  return rowIndexed.length >= 1;
}

function fdtRowWrappers(root) {
  const nodes = root.querySelectorAll(
    ".fixedDataTableRowLayout_rowWrapper, .fixedDataTableRowLayout_main.public_fixedDataTableRow_main, [rowindex]",
  );
  const seen = new Set();
  const out = [];
  nodes.forEach((node) => {
    const row =
      node.closest?.(".fixedDataTableRowLayout_rowWrapper") ||
      node.closest?.("[rowindex]") ||
      node;
    if (!row || seen.has(row)) return;
    seen.add(row);
    out.push(row);
  });
  return out;
}

function translateY(el) {
  const style = String(el.getAttribute?.("style") || "");
  const match = style.match(/translate3d\(\s*[\d.-]+px\s*,\s*([\d.-]+)px/i);
  if (match) return match[1];
  return "";
}

function rowGroupKey(el) {
  const idx = el.getAttribute?.("rowindex");
  if (idx != null && String(idx).trim() !== "") return `i:${idx}`;
  const y = translateY(el);
  if (y !== "") return `y:${y}`;
  return `n:${outId(el)}`;
}

function outId(el) {
  return String(el.getAttribute?.("id") || el.className || "");
}

function collectFdtMainCells(rowEl) {
  const mains = Array.from(
    rowEl.querySelectorAll(
      ".fixedDataTableCellLayout_main, .public_fixedDataTableCell_main",
    ),
  );
  const withRole = mains.filter((el) => {
    const role = String(el.getAttribute("role") || "").toLowerCase();
    return role === "gridcell" || role === "columnheader";
  });
  if (withRole.length) return withRole;

  const leaf = Array.from(rowEl.querySelectorAll('[role="gridcell"], [role="columnheader"]')).filter(
    (el) => !el.querySelector('[role="gridcell"], [role="columnheader"]'),
  );
  return leaf;
}

function rowLooksLikeHeader(texts) {
  const labels = texts.filter((t) => HEADER_LABEL_RE.test(t));
  if (texts.some((t) => t.toUpperCase() === "USERNAME" || t.toUpperCase() === "TURNOVER")) {
    return true;
  }
  return labels.length >= 4 && !texts.some((t) => USER_RE.test(t));
}

function isUserToken(token) {
  const t = normalizeVerticalDumpToken(token);
  if (!t || LEVEL_RE.test(t) || CURRENCY_RE.test(t) || isVerticalDumpMoneyToken(t)) return false;
  if (HEADER_LABEL_RE.test(t) && t.toUpperCase() !== "TOTAL") return false;
  return USER_RE.test(t);
}

function isTotalLabel(token) {
  return normalizeVerticalDumpToken(token).toUpperCase() === "TOTAL";
}

function firstAmountIndex(row, { skipBareSerial = false } = {}) {
  return row.findIndex((cell) => {
    if (!isVerticalDumpMoneyToken(cell)) return false;
    if (!skipBareSerial) return true;
    return !/^\d{1,4}$/.test(normalizeVerticalDumpToken(cell));
  });
}

function alignTotalRowToAgent(agentRow, totalRow) {
  if (!agentRow?.length || !totalRow?.length) return totalRow;
  if (!isTotalLabel(totalRow[0])) return totalRow;

  const totalMoneyToken = totalRow.slice(1).find((cell) => isVerticalDumpMoneyToken(cell));
  const matchedAgentIdx =
    totalMoneyToken != null
      ? agentRow.findIndex((cell) => normalizeVerticalDumpToken(cell) === normalizeVerticalDumpToken(totalMoneyToken))
      : -1;
  const totalMoneyIdx = totalRow.findIndex(
    (cell, index) => index > 0 && isVerticalDumpMoneyToken(cell),
  );
  const agentMoneyIdx =
    matchedAgentIdx >= 0 ? matchedAgentIdx : firstAmountIndex(agentRow, { skipBareSerial: true });

  if (agentMoneyIdx < 0 || totalMoneyIdx < 0 || agentMoneyIdx <= totalMoneyIdx) {
    const next = [...totalRow];
    while (next.length < agentRow.length) next.push("");
    return next.slice(0, Math.max(agentRow.length, next.length));
  }
  const gap = agentMoneyIdx - totalMoneyIdx;
  const next = [totalRow[0], ...Array.from({ length: gap }, () => ""), ...totalRow.slice(1)];
  while (next.length < agentRow.length) next.push("");
  return next.slice(0, agentRow.length);
}

function padRows(rows) {
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push("");
    return next;
  });
}

/**
 * Build a real &lt;table&gt; from a PS38 fixed-data-table clipboard fragment.
 * @returns {HTMLTableElement | null}
 */
export function tryBuildPs38FixedDataTable(root) {
  if (!looksLikePs38FdtMarkup(root)) return null;

  const wrappers = fdtRowWrappers(root);
  if (!wrappers.length) return null;

  const groups = new Map();
  wrappers.forEach((wrapper) => {
    const key = rowGroupKey(wrapper);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(wrapper);
  });

  const orderedKeys = [];
  wrappers.forEach((wrapper) => {
    const key = rowGroupKey(wrapper);
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  });

  const dataRows = [];
  orderedKeys.forEach((key) => {
    const seen = new Set();
    const cells = [];
    groups.get(key).forEach((wrapper) => {
      collectFdtMainCells(wrapper).forEach((cell) => {
        if (seen.has(cell)) return;
        seen.add(cell);
        cells.push(cell);
      });
    });
    const texts = cells.map((cell) => cellPlainText(cell));
    if (texts.every((t) => t === "")) return;
    if (rowLooksLikeHeader(texts)) return;
    dataRows.push(texts);
  });

  if (!dataRows.length) return null;
  const hasUser = dataRows.some((row) => row.some((cell) => isUserToken(cell)));
  const hasLevel = dataRows.some((row) => row.some((cell) => LEVEL_RE.test(cell)));
  if (!hasUser && !hasLevel) return null;

  const agentRow = dataRows.find((row) => row.some((cell) => isUserToken(cell))) || dataRows[0];
  const aligned = dataRows.map((row) =>
    isTotalLabel(row[0]) ? alignTotalRowToAgent(agentRow, row) : row,
  );
  const matrix = padRows(aligned);
  const width = matrix[0]?.length || 0;
  if (width < 8 || matrix.length < 1) return null;

  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  matrix.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

export function expandPs38ClipboardTokens(pastedData) {
  const lines = String(pastedData ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => normalizeVerticalDumpToken(line))
    .filter(Boolean);
  return lines;
}

export function looksLikePs38WinLossPlain(pastedData) {
  const tokens = expandPs38ClipboardTokens(pastedData);
  if (tokens.length < 16) return false;
  if (!tokens.some((t) => LEVEL_RE.test(t))) return false;
  if (!tokens.some((t) => CURRENCY_RE.test(t))) return false;
  if (!tokens.some((t) => isUserToken(t))) return false;
  const moneyCount = tokens.filter((t) => isVerticalDumpMoneyToken(t)).length;
  if (moneyCount < 8) return false;
  return tokens.some((t) => isTotalLabel(t)) || tokens.filter((t) => isUserToken(t)).length >= 1;
}

/**
 * One-field-per-line clipboard from the div grid → horizontal matrix.
 * @returns {string[][] | null}
 */
export function tryReshapePs38WinLossPlainMatrix(pastedData) {
  const text = String(pastedData ?? "");
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const tabHeavy =
    lines.length >= 2 &&
    lines.filter((line) => line.includes("\t")).length >= Math.ceil(lines.length * 0.6);
  if (tabHeavy) return null;
  if (!looksLikePs38WinLossPlain(pastedData)) return null;

  const tokens = expandPs38ClipboardTokens(pastedData);
  const userIdx = [];
  tokens.forEach((token, index) => {
    if (isUserToken(token)) userIdx.push(index);
  });
  if (!userIdx.length) return null;

  let start = userIdx[0];
  if (start > 0 && /^\d{1,4}$/.test(tokens[start - 1])) start -= 1;

  const dataTokens = tokens.slice(start);
  const relativeUsers = userIdx.map((idx) => idx - start).filter((idx) => idx >= 0);
  const totalRel = dataTokens.findIndex((token, index) => index > 0 && isTotalLabel(token));

  let width = null;
  if (relativeUsers.length >= 2) {
    width = relativeUsers[1] - relativeUsers[0];
  } else if (totalRel > 0) {
    width = totalRel;
  }
  if (!width || width < 8 || width > 24) return null;

  const rows = [];
  for (let i = 0; i < dataTokens.length; ) {
    if (isTotalLabel(dataTokens[i]) && i > 0) {
      const chunk = dataTokens.slice(i);
      rows.push(alignTotalRowToAgent(rows[0], chunk));
      break;
    }
    const chunk = dataTokens.slice(i, i + width);
    if (chunk.length < 3) break;
    if (chunk.length < width && isTotalLabel(chunk[0])) {
      rows.push(alignTotalRowToAgent(rows[0] || chunk, chunk));
      break;
    }
    rows.push(chunk);
    i += width;
  }

  if (!rows.length) return null;
  return padRows(rows);
}
