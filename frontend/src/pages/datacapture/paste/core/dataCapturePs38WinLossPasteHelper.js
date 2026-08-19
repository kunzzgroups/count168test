/**
 * PS3838 / ps38ag partner-ui Win Loss Detail (fixed-data-table div grid).
 *
 * Source: https://www.ps38ag.com/partner-ui-v2/report-winloss-detail-v2
 *
 * Unique to this report:
 * - Rows/cells are divs (`fixedDataTableRowLayout_*`, `role=gridcell`), not <table>
 * - Frozen + scroll panes duplicate the same `rowindex` with `left` reset to 0
 * - Chrome HTML copy collapses a visual row into stacked text inside a few cells
 * - Copy start drifts (No. vs Username); Total omits empty Name/Level/Currency cells
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

function isRowSerialToken(token) {
  return /^\d{1,4}$/.test(normalizeVerticalDumpToken(token));
}

/**
 * Copies start at No. / Username / an empty frozen cell. Drop that prefix so
 * every body row is anchored on Username (or the Total label).
 */
function trimLeadingRowNoise(row) {
  const next = Array.isArray(row) ? [...row] : [];
  while (next.length) {
    const first = normalizeVerticalDumpToken(next[0]);
    if (first === "") {
      next.shift();
      continue;
    }
    if (isRowSerialToken(first) && next.length > 1) {
      const second = normalizeVerticalDumpToken(next[1]);
      if (isUserToken(second) || isTotalLabel(second) || second === "") {
        next.shift();
        continue;
      }
    }
    break;
  }
  return next;
}

function padRow(row, width) {
  const next = Array.isArray(row) ? [...row] : [];
  while (next.length < width) next.push("");
  return next.slice(0, width);
}

function collectMoneyTokens(cells) {
  return (cells || []).filter((cell) => isVerticalDumpMoneyToken(cell));
}

function nextRecordIndex(tokens, fromIdx) {
  for (let j = fromIdx + 1; j < tokens.length; j += 1) {
    if (isUserToken(tokens[j]) || isTotalLabel(tokens[j])) return j;
  }
  return tokens.length;
}

function tryCanonicalAgentRow(row) {
  const trimmed = trimLeadingRowNoise(row);
  const userIdx = trimmed.findIndex((cell) => isUserToken(cell));
  const cells =
    userIdx >= 0 ? trimmed.slice(userIdx, nextRecordIndex(trimmed, userIdx)) : trimmed;
  let levelIdx = -1;
  let currIdx = -1;

  if (userIdx >= 0) {
    levelIdx = cells.findIndex((cell) => LEVEL_RE.test(cell));
    currIdx = cells.findIndex((cell) => CURRENCY_RE.test(cell));
    if (levelIdx >= 0 && currIdx === levelIdx + 1 && levelIdx <= 3) {
      const username = cells[0];
      const name = cells.slice(1, levelIdx).join(" ").trim();
      const money = collectMoneyTokens(cells.slice(currIdx + 1));
      return [username, name, cells[levelIdx], cells[currIdx], ...money];
    }
  }

  for (let i = 0; i < cells.length - 1; i += 1) {
    if (!LEVEL_RE.test(cells[i]) || !CURRENCY_RE.test(cells[i + 1])) continue;
    levelIdx = i;
    currIdx = i + 1;
    const before = cells.slice(0, levelIdx);
    const username = before.find((cell) => isUserToken(cell)) || before[0] || "";
    const name = before.filter((cell) => cell !== username).join(" ").trim();
    const money = collectMoneyTokens(cells.slice(currIdx + 1));
    if (money.length < 8) return null;
    return [username, name, cells[levelIdx], cells[currIdx], ...money];
  }
  return null;
}

function tryCanonicalTotalRow(row, width) {
  const cells = trimLeadingRowNoise(row);
  const totalIdx = cells.findIndex((cell) => isTotalLabel(cell));
  if (totalIdx < 0) return null;
  const money = collectMoneyTokens(cells.slice(totalIdx + 1));
  const identityWidth = 4;
  const moneyWidth = Math.max(0, width - identityWidth);
  const clipped = moneyWidth ? money.slice(0, moneyWidth) : money;
  return padRow(["Total", "", "", "", ...clipped], width);
}

/**
 * Force agent + Total onto Username / Name / Level / Currency / amounts,
 * regardless of whether the copy included No. or dropped empty identity cells.
 */
export function canonicalizePs38WinLossMatrix(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const agents = [];
  const totals = [];
  rows.forEach((row) => {
    const agent = tryCanonicalAgentRow(row);
    if (agent) {
      agents.push(agent);
      return;
    }
    if (trimLeadingRowNoise(row).some((cell) => isTotalLabel(cell))) {
      totals.push(row);
    }
  });
  if (!agents.length) return null;
  const width = Math.max(...agents.map((row) => row.length));
  if (width < 8) return null;
  const matrix = agents.map((row) => padRow(row, width));
  totals.forEach((row) => {
    matrix.push(tryCanonicalTotalRow(row, width) || padRow(["Total"], width));
  });
  return matrix;
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

  const matrix = canonicalizePs38WinLossMatrix(dataRows);
  const width = matrix?.[0]?.length || 0;
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

function looksLikePs38WinLossRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1) return false;
  const flat = rows.flat();
  if (!flat.some((cell) => LEVEL_RE.test(cell))) return false;
  if (!flat.some((cell) => CURRENCY_RE.test(cell))) return false;
  if (!flat.some((cell) => isUserToken(cell))) return false;
  if (flat.filter((cell) => isVerticalDumpMoneyToken(cell)).length < 8) return false;
  return true;
}

/**
 * One-field-per-line clipboard from the div grid → horizontal matrix.
 * Also accepts TSV whose start column drifted (No. vs Username).
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
  if (tabHeavy) {
    const rows = lines.map((line) =>
      line.split("\t").map((part) => normalizeVerticalDumpToken(part)),
    );
    if (!looksLikePs38WinLossRows(rows)) return null;
    return canonicalizePs38WinLossMatrix(rows);
  }
  if (!looksLikePs38WinLossPlain(pastedData)) return null;

  const tokens = expandPs38ClipboardTokens(pastedData);
  const rows = [];
  let i = 0;
  while (i < tokens.length) {
    if (isRowSerialToken(tokens[i]) && isUserToken(tokens[i + 1] || "")) {
      i += 1;
      continue;
    }
    if (isUserToken(tokens[i])) {
      const end = nextRecordIndex(tokens, i);
      const parsed = tryCanonicalAgentRow(tokens.slice(i, end));
      if (parsed) rows.push(parsed);
      i = end;
      continue;
    }
    if (isTotalLabel(tokens[i]) && rows.length) {
      rows.push(tokens.slice(i));
      break;
    }
    i += 1;
  }

  return canonicalizePs38WinLossMatrix(rows);
}

/** Format body cells → canonical PS38 matrix, or null when not this report. */
export function tryCanonicalizePs38FormatBody(bodyMatrix) {
  if (!Array.isArray(bodyMatrix) || !bodyMatrix.length) return null;
  const rows = bodyMatrix.map((row) =>
    (row || []).map((cell) => normalizeVerticalDumpToken(cell?.value ?? cell ?? "")),
  );
  if (!looksLikePs38WinLossRows(rows)) return null;
  const next = canonicalizePs38WinLossMatrix(rows);
  if (!next) return null;
  return next.map((row) => row.map((value) => ({ value, html: "" })));
}
