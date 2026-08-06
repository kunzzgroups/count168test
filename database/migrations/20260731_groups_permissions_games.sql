-- Phase 5/6: Group category is always Games. Heal legacy NULL/empty permissions.
UPDATE `groups`
SET `permissions` = JSON_ARRAY('Games')
WHERE `permissions` IS NULL
   OR TRIM(CAST(`permissions` AS CHAR)) = ''
   OR TRIM(CAST(`permissions` AS CHAR)) = 'null'
   OR TRIM(CAST(`permissions` AS CHAR)) = '[]';
