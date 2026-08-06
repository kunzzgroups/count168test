import { useLayoutEffect, useRef } from "react";
import { getBridgeCaptureType } from "../lib/dataCaptureBridge.js";
import {
  clearGroupOnlyTableDraft,
  normalizeGroupOnlyDraftCurrencyId,
  saveGroupOnlyTableDraft,
} from "../lib/dataCaptureGroupOnlyTableDraft.js";
import { resolvePayrollDraftProcessKey } from "../lib/dataCaptureGamesPayrollProcesses.js";
import { captureTableSnapshot, tableSnapshotHasData } from "../lib/dataCaptureTableSnapshot.js";
import { registerDataCaptureRuntime, unregisterDataCaptureRuntime } from "../lib/dataCaptureRuntime.js";

/**
 * Registers immediate group-only / Games-payroll draft sync after row-data
 * delete or process switch (server + localStorage).
 */
export function useGroupOnlyTableDraftFlush({
  enabled,
  groupPayrollUi = true,
  captureScope,
  draftBucket,
  payrollDraftServerSync = true,
  selectedProcess,
  currencyId,
  captureType,
}) {
  const stateRef = useRef({
    enabled,
    groupPayrollUi,
    captureScope,
    draftBucket,
    payrollDraftServerSync,
    selectedProcess,
    currencyId,
    captureType,
  });
  stateRef.current = {
    enabled,
    groupPayrollUi,
    captureScope,
    draftBucket,
    payrollDraftServerSync,
    selectedProcess,
    currencyId,
    captureType,
  };

  useLayoutEffect(() => {
    const flushGroupOnlyTableDraftNow = async (gridOverride = null) => {
      const {
        enabled: on,
        groupPayrollUi: groupUi,
        captureScope: scope,
        draftBucket: bucket,
        payrollDraftServerSync: serverSync,
        selectedProcess: process,
        currencyId: cid,
        captureType: type,
      } = stateRef.current;
      if (!on || !bucket) return false;
      const processKey = resolvePayrollDraftProcessKey(process, groupUi);
      if (!processKey) return false;
      const currencyKey = normalizeGroupOnlyDraftCurrencyId(cid);
      if (!currencyKey) return false;

      const activeCaptureType = getBridgeCaptureType(type || "1.Text");
      const tableData = captureTableSnapshot(activeCaptureType, gridOverride ?? undefined);
      const payload = { tableData, captureType: activeCaptureType };
      const draftOptions = { captureScope: scope, flush: true, serverSync };

      if (tableSnapshotHasData(tableData)) {
        await saveGroupOnlyTableDraft(bucket, processKey, currencyKey, payload, draftOptions);
      } else {
        await clearGroupOnlyTableDraft(bucket, processKey, currencyKey, { captureScope: scope });
      }
      return true;
    };

    registerDataCaptureRuntime({ flushGroupOnlyTableDraftNow });
    return () => unregisterDataCaptureRuntime(["flushGroupOnlyTableDraftNow"]);
  }, []);
}
