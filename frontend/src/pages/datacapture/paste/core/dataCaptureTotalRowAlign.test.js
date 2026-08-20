import test from "node:test";
import assert from "node:assert/strict";

import { ensureTotalRowCodeColumnGap } from "./dataCaptureTotalRowAlign.js";

test("Superbo WinLossSimple TOTAL pads two blanks under SENIOR and MYR", () => {
  const matrix = [
    ["KBK18", "SENIOR", "MYR", "20,611.52", "0.00", "-1,184.29", "-1,184.29", "1,070.00", "0.00", "114.29", "114.29"],
    ["KBK20", "AGENT", "MYR", "3,354.65", "0.00", "471.43", "471.43", "-424.28", "0.00", "-47.14", "-47.14"],
    ["TOTAL", "23,966.17", "0.00", "-712.86", "-712.86", "645.71", "0.00", "67.15", "67.15"],
  ];
  const out = ensureTotalRowCodeColumnGap(matrix);
  assert.equal(out[2][0], "TOTAL");
  assert.equal(String(out[2][1]).trim(), "");
  assert.equal(String(out[2][2]).trim(), "");
  assert.equal(out[2][3], "23,966.17");
  assert.equal(out[2][10], "67.15");
});

test("already-aligned Superbo TOTAL is left unchanged", () => {
  const matrix = [
    ["KBK18", "SENIOR", "MYR", "20,611.52", "0.00"],
    ["TOTAL", "", "", "23,966.17", "0.00"],
  ];
  const out = ensureTotalRowCodeColumnGap(matrix);
  assert.equal(out[1][3], "23,966.17");
  assert.equal(String(out[1][1]).trim(), "");
  assert.equal(String(out[1][2]).trim(), "");
});

test("code-column TOTAL BALANCE still gets a single blank under the code", () => {
  const matrix = [
    ["E1911", "XQ", "101.00", "50.00"],
    ["E1912", "XQ", "202.00", "60.00"],
    ["TOTAL BALANCE", "303.00", "110.00"],
  ];
  const out = ensureTotalRowCodeColumnGap(matrix);
  assert.equal(out[2][0], "TOTAL BALANCE");
  assert.equal(String(out[2][1]).trim(), "");
  assert.equal(out[2][2], "303.00");
});

test("3win8 Page Total and Overall Total pad two blanks for colspan=3", () => {
  const agent = ["WIN95DK", "dk", "VAAM3863", "0.00", "0.00", "0.00", "12.50"];
  const page = ["Page Total", "0.00", "0.00", "0.00", "12.50"];
  const overall = ["Overall Total", "0.00", "0.00", "0.00", "12.50"];
  const out = ensureTotalRowCodeColumnGap([agent, page, overall]);
  assert.equal(out[1][0], "Page Total");
  assert.equal(String(out[1][1]).trim(), "");
  assert.equal(String(out[1][2]).trim(), "");
  assert.equal(out[1][3], "0.00");
  assert.equal(out[1][6], "12.50");
  assert.equal(out[2][0], "Overall Total");
  assert.equal(String(out[2][1]).trim(), "");
  assert.equal(out[2][3], "0.00");
});

test("SUB TOTAL is not shifted", () => {
  const matrix = [
    ["KBK18", "SENIOR", "MYR", "20,611.52"],
    ["SUB TOTAL", "20,611.52"],
  ];
  const out = ensureTotalRowCodeColumnGap(matrix);
  assert.equal(out[1][0], "SUB TOTAL");
  assert.equal(out[1][1], "20,611.52");
});
