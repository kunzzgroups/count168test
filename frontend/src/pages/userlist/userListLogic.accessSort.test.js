import test from "node:test";
import assert from "node:assert/strict";
import { compareAccessCode, parseAssignableIds, sortAccessItems } from "./userListLogic.js";

test("compareAccessCode sorts numbers before letters and uses numeric order", () => {
  const codes = ["B", "10", "2", "A", "a1"];
  codes.sort(compareAccessCode);
  assert.deepEqual(codes, ["2", "10", "A", "a1", "B"]);
});

test("sortAccessItems puts closed items last and sorts open items 数字→A→Z", () => {
  const items = [
    { id: 1, account_id: "Z9" },
    { id: 2, account_id: "10" },
    { id: 3, account_id: "2" },
    { id: 4, account_id: "A1" },
  ];
  const selected = new Set([3, 4]);
  const sorted = sortAccessItems(items, selected, "account_id");
  assert.deepEqual(sorted.map((x) => x.account_id), ["2", "A1", "10", "Z9"]);
});

test("parseAssignableIds treats null as unrestricted", () => {
  assert.equal(parseAssignableIds(null), null);
});

test("parseAssignableIds builds a set of positive ids", () => {
  assert.deepEqual([...parseAssignableIds(["1", 2, 0, -3])], [1, 2]);
});
