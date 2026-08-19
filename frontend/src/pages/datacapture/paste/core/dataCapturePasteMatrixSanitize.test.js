import test from "node:test";
import assert from "node:assert/strict";

import { isVerticalDumpSummaryLabel } from "./dataCaptureVerticalDumpDetect.js";
import { sanitizePasteMatrix } from "./dataCapturePasteMatrixSanitize.js";

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
