-- Repair: COMMISSION / PROFIT formula templates for KK (empty group) were silently
-- saved under the SALARY process (process.id = 4565) because the Group Summary
-- save_template API defaulted to SALARY whenever process_id/process_code was missing
-- (see api/datacapture_summary/summary_templates_handler.php).
--
-- process.id reference (KK group, company_id=298):
--   4564 = PROFIT
--   4565 = SALARY
--   4566 = COMMISSION
--   4567 = BONUS
--
-- Step 1: review before touching anything.
SELECT dct.id, dct.process_id, dct.scope_type, dct.scope_id,
       dct.id_product, dct.account_display, dct.source_percent, dct.formula_display
FROM data_capture_templates dct
WHERE dct.process_id = 4565
ORDER BY dct.id;

-- Step 2: move the misfiled rows to their real process.
-- Confirmed by matching id_product/account/percent against the actual submitted
-- Transaction Maintenance data for COMMISSION (percent 0.25, BBBB/AAAA) and
-- PROFIT (percent 1, AA):

-- PROFIT (process_id 4565 -> 4564): id_product = AA
UPDATE data_capture_templates
SET process_id = 4564
WHERE process_id = 4565
  AND id IN (33980, 33981);

-- COMMISSION (process_id 4565 -> 4566): id_product = AAAA/BBBB, source_percent = 0.25
UPDATE data_capture_templates
SET process_id = 4566
WHERE process_id = 4565
  AND id IN (33987, 33988, 33989);

-- Step 3: verify SALARY is left with only the genuine SALARY rows (33968, 33969, 33990).
SELECT dct.id, dct.process_id, dct.id_product, dct.account_display, dct.source_percent, dct.formula_display
FROM data_capture_templates dct
WHERE dct.process_id IN (4564, 4565, 4566)
ORDER BY dct.process_id, dct.id;
