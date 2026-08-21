import test from "node:test";
import assert from "node:assert/strict";

import {
  alignFooterOnlySubGrandMatrix,
  looksLikeFooterOnlySubGrandPlain,
  splitStackedFooterCells,
  tryBuildFooterOnlySubGrandMatrix,
} from "./dataCaptureWinLoseFooterOnlyPasteHelper.js";
import { parsePlainTextMatrix } from "./dataCaptureTextPaste.js";
import { ensureTotalRowCodeColumnGap } from "./dataCaptureTotalRowAlign.js";

const AMOUNTS = "9\t571.00\t571.00\t1.65\t-419.80\t0.00\t377.99\t0.00";

test("footer-only TSV with extra Sub Total colspan blanks aligns first amounts", () => {
  const text = [`SUB TOTAL\t\t\t\t${AMOUNTS}`, `GRAND TOTAL\t${AMOUNTS}`].join("\n");
  assert.equal(looksLikeFooterOnlySubGrandPlain(text), true);
  const matrix = tryBuildFooterOnlySubGrandMatrix(text, "");
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0][0], "SUB TOTAL");
  assert.equal(matrix[1][0], "GRAND TOTAL");
  const firstSub = matrix[0].findIndex((cell, i) => i > 0 && String(cell).trim());
  const firstGrand = matrix[1].findIndex((cell, i) => i > 0 && String(cell).trim());
  assert.equal(firstSub, firstGrand);
  assert.equal(matrix[0][firstSub], "9");
  assert.equal(matrix[1][firstGrand], "9");
  assert.equal(matrix[0][firstSub + 1], "571.00");
  assert.equal(matrix[1][firstGrand + 1], "571.00");
});

test("parsePlainTextMatrix reshapes footer-only TSV that is not aligned (width delta > 2)", () => {
  const text = [`SUB TOTAL\t\t\t\t${AMOUNTS}`, `GRAND TOTAL\t${AMOUNTS}`].join("\n");
  const matrix = parsePlainTextMatrix(text);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0].length, matrix[1].length);
  const firstSub = matrix[0].findIndex((cell, i) => i > 0 && String(cell).trim());
  const firstGrand = matrix[1].findIndex((cell, i) => i > 0 && String(cell).trim());
  assert.equal(firstSub, firstGrand);
  assert.notEqual(matrix[0][0], "SUB TOTAL\t\t\t\t9");
});

test("vertical dump of only Sub Total + Grand Total becomes two aligned rows", () => {
  const text = [
    "SUB TOTAL",
    ...AMOUNTS.split("\t"),
    "GRAND TOTAL",
    ...AMOUNTS.split("\t"),
  ].join("\n");
  const matrix = parsePlainTextMatrix(text);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0][0], "SUB TOTAL");
  assert.equal(matrix[1][0], "GRAND TOTAL");
  assert.equal(matrix[0][1], "9");
  assert.equal(matrix[1][1], "9");
  assert.equal(matrix[0][2], "571.00");
  assert.equal(matrix[1][2], "571.00");
});

test("already-aligned footer pair is left unchanged", () => {
  const matrix = [
    ["SUB TOTAL", "", "", "9", "571.00", "571.00", "1.65"],
    ["GRAND TOTAL", "", "", "9", "571.00", "571.00", "1.65"],
  ];
  const out = alignFooterOnlySubGrandMatrix(matrix);
  assert.equal(out[0][3], "9");
  assert.equal(out[1][3], "9");
  assert.equal(String(out[0][1]).trim(), "");
  assert.equal(String(out[1][1]).trim(), "");
});

const stackedCell = (top, bottom, span = 1) => ({ lines: [top, bottom], span });

test("one stacked footer row keeps the label colspan gap before the amounts", () => {
  const rows = splitStackedFooterCells([
    stackedCell("Sub Total", "Grand Total", 3),
    stackedCell("1462", "1462"),
    stackedCell("40,149.05", "40,149.05"),
    stackedCell("5,149.05", "5,149.05"),
    stackedCell("16.80", "16.80"),
  ]);
  assert.deepEqual(rows[0], ["Sub Total", "", "", "1462", "40,149.05", "5,149.05", "16.80"]);
  assert.deepEqual(rows[1], ["Grand Total", "", "", "1462", "40,149.05", "5,149.05", "16.80"]);
});

test("stacked footer split is skipped when the labels are not the Sub/Grand pair", () => {
  const rows = splitStackedFooterCells([
    stackedCell("SB06SY", "SB07SY", 3),
    stackedCell("1462", "1462"),
    stackedCell("40,149.05", "40,149.05"),
    stackedCell("5,149.05", "5,149.05"),
    stackedCell("16.80", "16.80"),
  ]);
  assert.equal(rows, null);
});

test("stacked footer split is skipped when cells hold a single value", () => {
  const rows = splitStackedFooterCells([
    { lines: ["Sub Total"], span: 3 },
    { lines: ["1462"], span: 1 },
    { lines: ["40,149.05"], span: 1 },
    { lines: ["5,149.05"], span: 1 },
    { lines: ["16.80"], span: 1 },
  ]);
  assert.equal(rows, null);
});

test("agent rows plus Sub/Grand Total are not claimed by the footer-only helper", () => {
  const text = [
    `SB06\tname\t${AMOUNTS}`,
    `SUB TOTAL\t${AMOUNTS}`,
    `GRAND TOTAL\t${AMOUNTS}`,
  ].join("\n");
  assert.equal(looksLikeFooterOnlySubGrandPlain(text), false);
  assert.equal(tryBuildFooterOnlySubGrandMatrix(text, ""), null);
  const matrix = parsePlainTextMatrix(text);
  assert.equal(matrix.length, 3);
  assert.equal(matrix[0][0], "SB06");
  assert.equal(matrix[1][0], "SUB TOTAL");
  assert.equal(matrix[2][0], "GRAND TOTAL");
});

test("column-major Sub/Grand labels then paired amounts become two aligned rows", () => {
  const amounts = AMOUNTS.split("\t");
  const interleaved = [];
  amounts.forEach((amount) => {
    interleaved.push(amount, amount);
  });
  const text = ["SUB TOTAL", "GRAND TOTAL", ...interleaved].join("\n");
  const matrix = parsePlainTextMatrix(text);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0][0], "SUB TOTAL");
  assert.equal(matrix[1][0], "GRAND TOTAL");
  assert.equal(matrix[0][1], "9");
  assert.equal(matrix[1][1], "9");
  assert.equal(matrix[0][2], "571.00");
  assert.equal(matrix[1][2], "571.00");
  assert.equal(matrix[0].length, matrix[1].length);
});

test("transposed TSV with Sub/Grand on the first row becomes two data rows", () => {
  const amounts = AMOUNTS.split("\t");
  const lines = ["SUB TOTAL\tGRAND TOTAL", ...amounts.map((amount) => `${amount}\t${amount}`)];
  const matrix = parsePlainTextMatrix(lines.join("\n"));
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0][0], "SUB TOTAL");
  assert.equal(matrix[1][0], "GRAND TOTAL");
  assert.equal(matrix[0][1], "9");
  assert.equal(matrix[1][1], "9");
});

test("split Sub / Total lines still reshape as footer-only", () => {
  const amounts = AMOUNTS.split("\t");
  const interleaved = [];
  amounts.forEach((amount) => interleaved.push(amount, amount));
  const text = ["Sub", "Total", "Grand", "Total", ...interleaved].join("\n");
  const matrix = tryBuildFooterOnlySubGrandMatrix(text, "");
  assert.equal(matrix[0][0], "SUB TOTAL");
  assert.equal(matrix[1][0], "GRAND TOTAL");
  assert.equal(matrix[0][1], "9");
  assert.equal(matrix[1][1], "9");
});

test("Citibet Downline Payment sheets are not claimed by the fruit16 footer helper", () => {
  const text = [
    "Downline Payment\t",
    "No.\tLvl\tUsername\tType\tTurnover\tWin",
    "1\tMA\tagent1\tMajor\t100.00\t50.00",
    "2\tAG\tagent2\tMajor\t200.00\t-10.00",
    "SUB TOTAL\t\t\t\t300.00\t40.00",
    "GRAND TOTAL\t\t\t\t300.00\t40.00",
  ].join("\n");
  assert.equal(looksLikeFooterOnlySubGrandPlain(text), false);
  assert.equal(tryBuildFooterOnlySubGrandMatrix(text, ""), null);
  const matrix = parsePlainTextMatrix(text);
  assert.ok(matrix.length >= 4);
  const joined = matrix.flat().join("\t");
  assert.match(joined, /agent1/);
  assert.match(joined, /agent2/);
});

test("ordinary space-aligned report keeps equals under the amount column without stripping spaces", () => {
  const text = ["ab    100", "      ="].join("\n");
  const matrix = parsePlainTextMatrix(text);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0][0], "ab");
  assert.equal(matrix[0][1], "100");
  assert.equal(String(matrix[1][1]).trim(), "=");
  assert.equal(String(matrix[1][0]).trim(), "");
});

test("ordinary report does not invent an empty column between ab and 100", () => {
  const text = ["ab\t\t100", "\t\t="].join("\n");
  const matrix = parsePlainTextMatrix(text);
  assert.equal(matrix[0].length, 2);
  assert.equal(matrix[0][0], "ab");
  assert.equal(matrix[0][1], "100");
  assert.equal(String(matrix[1][1]).trim(), "=");
});

test("3win8 Page Total TSV keeps amounts under the third identifier column", () => {
  const text = [
    "WIN95DK\tdk\tVAAM3863\t0.00\t0.00\t12.50",
    "Page Total\t0.00\t0.00\t12.50",
    "Overall Total\t0.00\t0.00\t12.50",
  ].join("\n");
  const matrix = parsePlainTextMatrix(text);
  assert.equal(matrix[0][0], "WIN95DK");
  assert.equal(matrix[1][0], "Page Total");
  assert.equal(String(matrix[1][1]).trim(), "");
  assert.equal(String(matrix[1][2]).trim(), "");
  assert.equal(matrix[1][3], "0.00");
  assert.equal(matrix[1][5], "12.50");
  assert.equal(matrix[2][0], "Overall Total");
  assert.equal(matrix[2][3], "0.00");
});

test("Superbo TOTAL pad is unchanged for mixed agent + TOTAL sheets", () => {
  const matrix = [
    ["KBK18", "SENIOR", "MYR", "20,611.52"],
    ["SUB TOTAL", "20,611.52"],
  ];
  const out = ensureTotalRowCodeColumnGap(matrix);
  assert.equal(out[1][0], "SUB TOTAL");
  assert.equal(out[1][1], "20,611.52");
  assert.equal(tryBuildFooterOnlySubGrandMatrix(["KBK18\tSENIOR\tMYR\t20,611.52", "TOTAL\t20,611.52"].join("\n"), ""), null);
});
