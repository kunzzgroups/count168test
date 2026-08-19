import test from "node:test";
import assert from "node:assert/strict";

import { parsePlainTextMatrix } from "./dataCaptureTextPaste.js";
import {
  looksLikePs38WinLossPlain,
  tryReshapePs38WinLossPlainMatrix,
} from "./dataCapturePs38WinLossPasteHelper.js";

const AGENT_FIELDS = [
  "1",
  "BCA10A1",
  "JH093",
  "Agent",
  "MYR",
  "153",
  "3,428.44",
  "3,094.86",
  "8.67",
  "-265.52",
  "0.00",
  "-265.52",
  "0.00",
  "8.66",
  "8.66",
  "208.43",
  "-6.80",
  "201.63",
  "55.22",
];

const TOTAL_FIELDS = [
  "Total",
  "153",
  "3,428.44",
  "3,094.86",
  "8.67",
  "-265.52",
  "0.00",
  "-265.52",
  "0.00",
  "8.66",
  "8.66",
  "208.43",
  "-6.80",
  "201.63",
  "55.22",
];

const HEADER = [
  "No.",
  "Username",
  "Name",
  "Level",
  "Currency",
  "Total Wager",
  "Turnover",
  "Volume",
  "Gross Comm",
  "Member",
  "Win/Loss",
  "Comm",
  "Total",
  "Agent",
  "Win/Loss",
  "Comm",
  "Total",
  "Master Agent",
  "Win/Loss",
  "Comm",
  "Total",
  "Company",
];

test("looksLikePs38WinLossPlain gates the div-grid one-field dump", () => {
  const pasted = [...HEADER, ...AGENT_FIELDS, ...TOTAL_FIELDS].join("\n");
  assert.equal(looksLikePs38WinLossPlain(pasted), true);
  assert.equal(looksLikePs38WinLossPlain("hello\nworld"), false);
});

test("tryReshapePs38WinLossPlainMatrix makes agent + Total rows 19 wide", () => {
  const pasted = [...HEADER, ...AGENT_FIELDS, ...TOTAL_FIELDS].join("\n");
  const matrix = tryReshapePs38WinLossPlainMatrix(pasted);
  assert.ok(matrix);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0].length, 19);
  assert.equal(matrix[0][1], "BCA10A1");
  assert.equal(matrix[0][2], "JH093");
  assert.equal(matrix[0][3], "Agent");
  assert.equal(matrix[0][4], "MYR");
  assert.equal(matrix[0][18], "55.22");
  assert.equal(matrix[1][0], "Total");
  assert.equal(matrix[1][18], "55.22");
  assert.equal(matrix[1][1], "");
  assert.equal(matrix[1][2], "");
  assert.equal(matrix[1][3], "");
});

test("parsePlainTextMatrix uses the PS38 helper for 1.TEXT", () => {
  const pasted = [...AGENT_FIELDS, ...TOTAL_FIELDS].join("\n");
  const matrix = parsePlainTextMatrix(pasted);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0][1], "BCA10A1");
  assert.equal(matrix[1][0], "Total");
});
