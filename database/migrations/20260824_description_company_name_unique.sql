-- Add Process's "Copy From" flow looks up description rows by (company_id, name).
-- With no uniqueness guard, two concurrent inserts (double-click on the "+" add
-- description button, or dcEnsureDescriptionIdForCompany() racing across companies
-- in the same group during payroll auto-create) can each pass a check-then-insert
-- and create two identical description rows. Every process that later matches that
-- name by name-lookup then gets inserted once per duplicate id, producing silent
-- duplicate process rows.
--
-- This migration merges any existing duplicate description rows before adding the
-- constraint, since ADD UNIQUE fails outright if duplicates are still present.
--
-- process.description_id has ON DELETE CASCADE / ON UPDATE CASCADE to description.id
-- (fk_process_description) — process rows are repointed to the surviving id BEFORE
-- the duplicate description row is deleted, so no process row is lost.

-- 1. Map every duplicate-name description row to the earliest (lowest id) survivor
--    for its (company_id, name) group.
CREATE TEMPORARY TABLE description_dedupe_map AS
SELECT d.id AS old_id, m.keep_id
FROM description d
JOIN (
    SELECT company_id, name, MIN(id) AS keep_id
    FROM description
    GROUP BY company_id, name
    HAVING COUNT(*) > 1
) m ON m.company_id = d.company_id AND m.name = d.name
WHERE d.id <> m.keep_id;

-- 2. Repoint process rows off the duplicate ids and onto the survivor.
UPDATE process p
JOIN description_dedupe_map map ON map.old_id = p.description_id
SET p.description_id = map.keep_id;

-- 3. Repointing can turn two previously-distinct process rows (same process_id +
--    company_id, formerly different description_id) into an exact duplicate pair.
--    Keep the earliest row, drop the rest.
DELETE p1 FROM process p1
JOIN process p2
  ON p1.process_id = p2.process_id
 AND p1.description_id = p2.description_id
 AND p1.company_id = p2.company_id
 AND p1.id > p2.id;

-- 4. Now-unreferenced duplicate description rows are safe to remove.
DELETE d FROM description d
JOIN description_dedupe_map map ON map.old_id = d.id;

DROP TEMPORARY TABLE description_dedupe_map;

-- 5. Enforce uniqueness going forward. Matches the comparison already used by
--    descriptionExistsForCompany() in api/processes/addprocess_lib.php.
ALTER TABLE `description`
  ADD UNIQUE KEY `uk_description_company_name` (`company_id`, `name`);
