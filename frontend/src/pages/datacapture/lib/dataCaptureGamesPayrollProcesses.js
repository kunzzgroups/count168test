/**
 * Games Data Capture: real per-company processes (created on the Process List
 * page — not hard-coded) named SALARY / BONUS / COMMISSION get the same
 * save-draft behavior as Bank's payroll processes.
 *
 * Deliberately excludes the "Bank" category pill's hard-coded rows (literal
 * string ids like "salary" from BANK_PROCESSES in useDataCaptureFormEngine.js)
 * by requiring a numeric process id — so a real Games process and the Bank
 * pill's synthetic row of the same name never share a draft slot.
 */
import {
  GROUP_PAYROLL_DRAFT_PROCESS_CODES,
  isGroupPayrollDraftProcessId,
} from "./dataCaptureGroupOnlyProcesses.js";

const GAMES_PAYROLL_DRAFT_NAME_SET = new Set(GROUP_PAYROLL_DRAFT_PROCESS_CODES);

function normalizeProcessName(selectedProcess) {
  return String(selectedProcess?.process_id || selectedProcess?.displayText || "")
    .trim()
    .toUpperCase();
}

function isRealProcessId(id) {
  return /^\d+$/.test(String(id ?? "").trim());
}

/** True only for a real (numeric-id) process row named SALARY/BONUS/COMMISSION. */
export function isGamesPayrollDraftProcess(selectedProcess) {
  if (!selectedProcess?.id || !isRealProcessId(selectedProcess.id)) return false;
  return GAMES_PAYROLL_DRAFT_NAME_SET.has(normalizeProcessName(selectedProcess));
}

/** Draft API process_key (lowercase code) for a matched Games payroll process, else "". */
export function gamesPayrollDraftProcessKey(selectedProcess) {
  if (!isGamesPayrollDraftProcess(selectedProcess)) return "";
  return normalizeProcessName(selectedProcess).toLowerCase();
}

/** Company-scoped draft bucket, matching the "company:<id>" convention used for Bank/C168. */
export function gamesPayrollDraftBucket(companyId) {
  const id = Number(companyId);
  return Number.isFinite(id) && id > 0 ? `company:${id}` : "";
}

/**
 * Resolve the draft process_key for the current mode.
 * groupPayrollUi=true → Bank/AP-IG group payroll UI (fixed synthetic ids).
 * groupPayrollUi=false → Games company UI (real process rows, matched by name).
 */
export function resolvePayrollDraftProcessKey(selectedProcess, groupPayrollUi) {
  if (!selectedProcess?.id) return null;
  if (groupPayrollUi) {
    return isGroupPayrollDraftProcessId(selectedProcess.id) ? String(selectedProcess.id) : null;
  }
  const key = gamesPayrollDraftProcessKey(selectedProcess);
  return key || null;
}
