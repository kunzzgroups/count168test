import test from "node:test";
import assert from "node:assert/strict";

import { isVerticalDumpSummaryLabel } from "./dataCaptureVerticalDumpDetect.js";
import {
  sanitizePasteMatrix,
  plainTextLooksLikeAlignedTsv,
} from "./dataCapturePasteMatrixSanitize.js";
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

test("sanitizePasteMatrix keeps 3win8 Page Total and Overall Total footers", () => {
  const agent = [
    "WIN95KZ",
    "KENZO",
    "VAAM3863",
    "60.00",
    "0.00",
    "60.00",
    "-176.00",
    "114.27",
    "-61.73",
    "0.00",
    "0.00",
    "-61.73",
  ];
  const pageTotal = ["Page Total", "60.00", "0.00", "60.00", "-176.00", "114.27", "-61.73", "0.00", "0.00", "-61.73"];
  const overallTotal = [
    "Overall Total",
    "60.00",
    "0.00",
    "60.00",
    "-176.00",
    "114.27",
    "-61.73",
    "0.00",
    "0.00",
    "-61.73",
  ];
  const out = sanitizePasteMatrix([agent, pageTotal, overallTotal]);
  assert.equal(out.length, 3);
  assert.equal(String(out[1][0]).trim(), "Page Total");
  assert.equal(String(out[2][0]).trim(), "Overall Total");
});

test("isVerticalDumpSummaryLabel recognizes SPORT TOTAL =", () => {
  assert.equal(isVerticalDumpSummaryLabel("SPORT TOTAL ="), true);
  assert.equal(isVerticalDumpSummaryLabel("Sport Total"), true);
});

test("GamingSoft invoice EXTRA FEE width jump is not treated as aligned TSV", () => {
  const rows = [];
  for (let i = 1; i <= 20; i += 1) {
    if (i === 10) {
      rows.push(
        `${i}\tEg:Evolution - JDCLUB9SGD\t\t\t\tR\t9.00\t(SGD) 18,474.21\t5,299.62\tEXTRA FEE\t2,187.90\t\t3.1874`,
      );
      continue;
    }
    rows.push(`${i}\tEg:Evolution - ACC${i}\t\t\t\tR\t7.00\t(MYR) 10.00\t1.25`);
  }
  assert.equal(plainTextLooksLikeAlignedTsv(rows.join("\n")), false);
});
