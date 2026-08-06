import test from "node:test";
import assert from "node:assert/strict";

import { dataCaptureQueryKeys } from "./dataCaptureApi.js";

test("submitted-process cache is isolated by permission category", () => {
  const bankKey = dataCaptureQueryKeys.submissions("company:2", "2026-07-30", "Bank");
  const gamesKey = dataCaptureQueryKeys.submissions("company:2", "2026-07-30", "Games");

  assert.notDeepEqual(bankKey, gamesKey);
  assert.equal(bankKey.at(-1), "BANK");
  assert.equal(gamesKey.at(-1), "GAMES");
});
