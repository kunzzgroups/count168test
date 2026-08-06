-- Add RATE_PLATFORM_FEE to transaction_entry / transaction_entry_backup entry_type ENUM.
-- Required so RATE Platform Fee can persist as a separate Fee leg (alongside RATE_FEE).
-- Run once on existing DB (idempotent).

DROP PROCEDURE IF EXISTS sync_transaction_entry_rate_platform_fee_enum;

DELIMITER //
CREATE PROCEDURE sync_transaction_entry_rate_platform_fee_enum()
BEGIN
    DECLARE v_column_type TEXT;
    DECLARE v_is_nullable VARCHAR(3);
    DECLARE v_default_value TEXT;
    DECLARE v_sql TEXT;

    -- transaction_entry
    SET v_column_type = NULL;
    SET v_is_nullable = NULL;
    SET v_default_value = NULL;

    SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      INTO v_column_type, v_is_nullable, v_default_value
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'transaction_entry'
       AND COLUMN_NAME = 'entry_type'
     LIMIT 1;

    IF v_column_type IS NOT NULL
       AND LOWER(v_column_type) LIKE 'enum(%'
       AND v_column_type NOT LIKE '%''RATE_PLATFORM_FEE''%' THEN
        SET v_column_type = CONCAT(LEFT(v_column_type, CHAR_LENGTH(v_column_type) - 1), ',''RATE_PLATFORM_FEE'')');
        SET v_sql = CONCAT(
            'ALTER TABLE `transaction_entry` MODIFY COLUMN `entry_type` ',
            v_column_type,
            IF(v_is_nullable = 'NO', ' NOT NULL', ' NULL'),
            IF(v_default_value IS NULL, '', CONCAT(' DEFAULT ', QUOTE(v_default_value)))
        );
        SET @stmt = v_sql;
        PREPARE stmt FROM @stmt;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;

    -- transaction_entry_backup
    SET v_column_type = NULL;
    SET v_is_nullable = NULL;
    SET v_default_value = NULL;

    SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      INTO v_column_type, v_is_nullable, v_default_value
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'transaction_entry_backup'
       AND COLUMN_NAME = 'entry_type'
     LIMIT 1;

    IF v_column_type IS NOT NULL
       AND LOWER(v_column_type) LIKE 'enum(%'
       AND v_column_type NOT LIKE '%''RATE_PLATFORM_FEE''%' THEN
        SET v_column_type = CONCAT(LEFT(v_column_type, CHAR_LENGTH(v_column_type) - 1), ',''RATE_PLATFORM_FEE'')');
        SET v_sql = CONCAT(
            'ALTER TABLE `transaction_entry_backup` MODIFY COLUMN `entry_type` ',
            v_column_type,
            IF(v_is_nullable = 'NO', ' NOT NULL', ' NULL'),
            IF(v_default_value IS NULL, '', CONCAT(' DEFAULT ', QUOTE(v_default_value)))
        );
        SET @stmt = v_sql;
        PREPARE stmt FROM @stmt;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END//
DELIMITER ;

CALL sync_transaction_entry_rate_platform_fee_enum();

DROP PROCEDURE IF EXISTS sync_transaction_entry_rate_platform_fee_enum;
