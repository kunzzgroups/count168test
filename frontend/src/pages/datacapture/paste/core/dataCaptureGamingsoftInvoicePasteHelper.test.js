import test from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeGamingsoftInvoicePlain,
  tryReshapeGamingsoftInvoicePlainMatrix,
  trySplitGamingsoftInvoiceLine,
} from "./dataCaptureGamingsoftInvoicePasteHelper.js";

test("splits classic Gamingsoft invoice row with colon brand", () => {
  const line = "Ag:Asiagaming - Gsc Lc - VTBM PT 7.50 (MYR) 171.50 12.86";
  assert.deepEqual(trySplitGamingsoftInvoiceLine(line), [
    "Ag:Asiagaming - Gsc Lc - VTBM",
    "PT",
    "7.50",
    "(MYR) 171.50",
    "12.86",
  ]);
});

test("splits PDF copies that drop the colon or glue hyphens", () => {
  assert.deepEqual(
    trySplitGamingsoftInvoiceLine("Ag Asiagaming - GscLc - VTBM PT 7.50 (MYR) 171.50 12.86"),
    ["Ag Asiagaming - GscLc - VTBM", "PT", "7.50", "(MYR) 171.50", "12.86"],
  );
  assert.deepEqual(
    trySplitGamingsoftInvoiceLine("AG ASIAGAMING- GSCLC- VTBM PT 7.50 (MYR) 171.50 12.86"),
    ["AG ASIAGAMING- GSCLC- VTBM", "PT", "7.50", "(MYR) 171.50", "12.86"],
  );
});

test("keeps optional row number as first column", () => {
  assert.deepEqual(
    trySplitGamingsoftInvoiceLine(
      "1 AG:ASIAGAMING - GSC LC - K69M PT 7.50 (MYR) 25.00 1.88",
    ),
    ["1", "AG:ASIAGAMING - GSC LC - K69M", "PT", "7.50", "(MYR) 25.00", "1.88"],
  );
});

test("parses grand total footer rows", () => {
  assert.deepEqual(trySplitGamingsoftInvoiceLine("Grand Total 12.86"), [
    "Grand Total",
    "12.86",
  ]);
});

test("reshape matrix wires body + total for 1.TEXT / 2.FORMAT plain path", () => {
  const pasted = [
    "Ag:Asiagaming - Gsc Lc - VTBM PT 7.50 (MYR) 171.50 12.86",
    "Grand Total 12.86",
  ].join("\n");

  assert.equal(looksLikeGamingsoftInvoicePlain(pasted), true);
  const matrix = tryReshapeGamingsoftInvoicePlainMatrix(pasted);
  assert.ok(matrix);
  assert.equal(matrix.length, 2);
  assert.deepEqual(matrix[0], [
    "Ag:Asiagaming - Gsc Lc - VTBM",
    "PT",
    "7.50",
    "(MYR) 171.50",
    "12.86",
  ]);
  assert.equal(matrix[1][0], "Grand Total");
  assert.equal(matrix[1][1], "12.86");
});

test("does not claim unrelated single-line pastes", () => {
  assert.equal(looksLikeGamingsoftInvoicePlain("hello world 1 2 3"), false);
  assert.equal(
    tryReshapeGamingsoftInvoicePlainMatrix("agent001\tPT\t1.00"),
    null,
  );
});
