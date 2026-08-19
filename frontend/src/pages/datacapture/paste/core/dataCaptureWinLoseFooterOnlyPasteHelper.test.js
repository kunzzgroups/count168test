import test from "node:test";
import assert from "node:assert/strict";

import {
  alignFooterOnlySubGrandMatrix,
  looksLikeFooterOnlySubGrandPlain,
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
