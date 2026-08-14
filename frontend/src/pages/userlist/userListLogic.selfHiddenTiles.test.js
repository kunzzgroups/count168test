import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeModalAccountsWithGranted,
  mergeModalProcessesWithGranted,
  buildSelfAccHeldIds,
  isAccountPermModalChecked,
} from "./userListLogic.js";

test("self-hidden compact grants without labels become empty tiles (catalog hidden)", () => {
  const merged = mergeModalAccountsWithGranted([], [{ id: 10, self_hidden: true }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 10);
  assert.equal(merged[0].account_id, "");
  assert.equal(merged[0].name, "");
});

test("self-hidden grants keep codes/names when Acc list API returns empty", () => {
  const merged = mergeModalAccountsWithGranted([], [
    { id: 10, account_id: "JK-ACC", name: "JK Bank", self_hidden: true },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].account_id, "JK-ACC");
  assert.equal(merged[0].name, "JK Bank");
});

test("labeled grants fill missing catalog fields without duplicating tiles", () => {
  const merged = mergeModalAccountsWithGranted(
    [{ id: 10, account_id: "", name: "" }],
    [{ id: 10, account_id: "JK-ACC", name: "JK Bank", self_hidden: true }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].account_id, "JK-ACC");
  assert.equal(merged[0].name, "JK Bank");
});

test("self-hidden process grants keep codes when process list API returns empty", () => {
  const merged = mergeModalProcessesWithGranted([], [
    { id: 7, process_id: "P1", description: "Deposit", self_hidden: true },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].process_id, "P1");
  assert.equal(merged[0].description, "Deposit");
});

test("superior_closed grants still merge into empty catalog with labels", () => {
  const merged = mergeModalAccountsWithGranted([], [
    { id: 11, account_id: "SV-1", name: "Closed Acc", superior_closed: true },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].account_id, "SV-1");
  assert.equal(merged[0].name, "Closed Acc");
});

test("held ids exclude superior_closed so self cannot re-open", () => {
  const held = buildSelfAccHeldIds(
    [
      { id: 1, self_hidden: true },
      { id: 2, superior_closed: true },
      { id: 3 },
    ],
    false,
    [1, 2, 3],
  );
  assert.deepEqual([...held].sort((a, b) => a - b), [1, 3]);
});

test("modal checked: self hides self_hidden and superior_closed", () => {
  assert.equal(isAccountPermModalChecked({ id: 1, superior_closed: true }, true), false);
  assert.equal(isAccountPermModalChecked({ id: 2, self_hidden: true }, true), false);
  assert.equal(isAccountPermModalChecked({ id: 3 }, true), true);
  assert.equal(isAccountPermModalChecked({ id: 4, self_hidden: true }, false), true);
  assert.equal(isAccountPermModalChecked({ id: 5, superior_closed: true }, false), false);
});
