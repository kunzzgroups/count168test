import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountPermissionPayload,
  buildProcessPermissionPayload,
  canSelfEditAccountAccess,
  compareAccessCode,
  parseAssignableIds,
  partitionAccessRows,
  sortAccessItems,
} from "./userListLogic.js";

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

test("partitionAccessRows keeps self_hidden unchecked and superior_closed flagged", () => {
  const accs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const { selected, superiorClosed } = partitionAccessRows(
    [
      { id: 1, account_id: "A" },
      { id: 2, account_id: "B", self_hidden: 1 },
      { id: 3, account_id: "C", superior_closed: 1 },
    ],
    accs,
  );
  assert.deepEqual([...selected], [1]);
  assert.deepEqual([...superiorClosed], [3]);
});

test("partitionAccessRows treats null as all selected", () => {
  const { selected, superiorClosed } = partitionAccessRows(null, [{ id: 8 }, { id: 9 }]);
  assert.deepEqual([...selected].sort(), [8, 9]);
  assert.equal(superiorClosed.size, 0);
});

test("buildAccountPermissionPayload self-hide is re-openable and preserves superior_closed", () => {
  const accounts = [
    { id: 1, account_id: "A" },
    { id: 2, account_id: "B" },
    { id: 3, account_id: "C" },
    { id: 4, account_id: "D" },
  ];
  const payload = buildAccountPermissionPayload(accounts, new Set([1]), new Set([3]), {
    isSelf: true,
    toggleableIds: new Set([1, 2]),
  });
  assert.deepEqual(payload, [
    { id: 1, account_id: "A" },
    { id: 2, account_id: "B", self_hidden: 1 },
    { id: 3, account_id: "C", superior_closed: 1 },
  ]);
});

test("buildAccountPermissionPayload superior uncheck writes superior_closed only for closed set", () => {
  const accounts = [
    { id: 1, account_id: "A" },
    { id: 2, account_id: "B" },
    { id: 3, account_id: "C" },
  ];
  const payload = buildAccountPermissionPayload(accounts, new Set([1]), new Set([2]), {
    isSelf: false,
    toggleableIds: new Set([1, 2, 3]),
  });
  assert.deepEqual(payload, [
    { id: 1, account_id: "A" },
    { id: 2, account_id: "B", superior_closed: 1 },
  ]);
});

test("buildProcessPermissionPayload self-hide is re-openable and preserves superior_closed", () => {
  const processes = [
    { id: 1, process_id: "P1", description: "A" },
    { id: 2, process_id: "P2", description: "B" },
    { id: 3, process_id: "P3", description: "C" },
  ];
  const payload = buildProcessPermissionPayload(processes, new Set([1]), new Set([3]), {
    isSelf: true,
    toggleableIds: new Set([1, 2]),
  });
  assert.deepEqual(payload, [
    { id: 1, process_id: "P1", description: "A" },
    { id: 2, process_id: "P2", description: "B", self_hidden: 1 },
    { id: 3, process_id: "P3", description: "C", superior_closed: 1 },
  ]);
});

test("canSelfEditAccountAccess is false for owner and owner-shadow", () => {
  assert.equal(canSelfEditAccountAccess({ id: 1, role: "owner" }, 1, "owner"), false);
  assert.equal(canSelfEditAccountAccess({ id: 1, is_owner_shadow: true }, 1, "admin"), false);
  assert.equal(canSelfEditAccountAccess({ id: 1, role: "admin" }, 1, "admin"), true);
  assert.equal(canSelfEditAccountAccess({ id: 2, role: "admin" }, 1, "admin"), false);
});
