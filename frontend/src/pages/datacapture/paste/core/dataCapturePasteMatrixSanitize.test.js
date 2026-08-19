import test from "node:test";
import assert from "node:assert/strict";

import { isVerticalDumpSummaryLabel } from "./dataCaptureVerticalDumpDetect.js";
import {
  sanitizePasteMatrix,
  plainTextLooksLikeAlignedTsv,
} from "./dataCapturePasteMatrixSanitize.js";
import { parsePlainTextMatrix } from "./dataCaptureTextPaste.js";

/** Monkey King Win Loss: agent row + All Total with empty name/currency/type cells. */
const MKING_AGENT = [
  "MKAPI735T",
  "TR8",
  "MYR",
  "Secondary Agent(API)",
  "88.72",
  "55.91",
  "0.00",
  "0.00",
  "-32.81",
  "32.81",
];
const MKING_ALL_TOTAL = [
  "All Total",
  "",
  "",
  "",
  "88.72",
  "55.91",
  "0.00",
  "0.00",
  "-32.81",
  "32.81",
];

test("sanitizePasteMatrix keeps Monkey King All Total footer next to agent row", () => {
  const out = sanitizePasteMatrix([MKING_AGENT, MKING_ALL_TOTAL]);
  assert.equal(out.length, 2);
  assert.equal(String(out[1][0]).trim(), "All Total");
});

test("isVerticalDumpSummaryLabel recognizes ALL TOTAL", () => {
  assert.equal(isVerticalDumpSummaryLabel("All Total"), true);
  assert.equal(isVerticalDumpSummaryLabel("ALL TOTAL"), true);
  assert.equal(isVerticalDumpSummaryLabel("ALLTOTAL"), true);
});

test("sanitizePasteMatrix keeps OBET SPORT TOTAL = footer with empty name cell", () => {
  const agent = [
    "E1911",
    "XQ",
    "125,603.00",
    "86,075.50",
    "0.00",
    "-13,723.29",
    "739.32",
    "0.97",
    "41.96",
    "42.93",
  ];
  const sportTotal = ["SPORT TOTAL =", "", "", "", "504,784.00", "390,557.00", "2,960.89"];
  const out = sanitizePasteMatrix([agent, sportTotal]);
  assert.equal(out.length, 2);
  assert.equal(String(out[1][0]).trim(), "SPORT TOTAL =");
});

test("isVerticalDumpSummaryLabel recognizes SPORT TOTAL =", () => {
  assert.equal(isVerticalDumpSummaryLabel("SPORT TOTAL ="), true);
  assert.equal(isVerticalDumpSummaryLabel("Sport Total"), true);
});

function gamingSoftInvoiceTsv(rowCount) {
  const rows = [];
  for (let i = 1; i <= rowCount; i += 1) {
    if (i === 92) {
      rows.push(
        `${i}\tEg:Evolution - JDCLUB9SGD\t\t\t\tR\t9.00\t(SGD) 18,474.21\t5,299.62\tEXTRA FEE\t2,187.90\t\t3.1874`,
      );
      continue;
    }
    rows.push(`${i}\tBrand - ACC${i}\t\t\t\tR\t7.00\t(MyR) 10.00\t1.25`);
  }
  return rows.join("\n");
}

test("GamingSoft invoice TSV with EXTRA FEE extra columns is still aligned TSV", () => {
  const text = gamingSoftInvoiceTsv(110);
  assert.equal(plainTextLooksLikeAlignedTsv(text), true);
  const matrix = parsePlainTextMatrix(text);
  assert.equal(matrix.length, 110);
  assert.match(String(matrix[91][1]), /JDCLUB9SGD/);
  assert.equal(matrix[109][0], "110");
});
