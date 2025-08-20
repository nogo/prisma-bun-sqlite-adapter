import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PrismaBunSQLiteAdapter } from "../src/adapter";
import { ColumnTypeEnum } from "@prisma/driver-adapter-utils";

describe("Comprehensive Type Support", () => {
  let db: Database;
  let adapter: PrismaBunSQLiteAdapter;

  beforeEach(() => {
    db = new Database(":memory:");
    adapter = new PrismaBunSQLiteAdapter(db);
  });

  afterEach(async () => {
    await adapter.dispose();
  });

  it("should correctly handle all supported SQLite types with length specifiers", async () => {
    await adapter.executeScript(`
      CREATE TABLE type_support_test (
        id INTEGER PRIMARY KEY,
        
        -- Text types with length specifiers (should all map to Text)
        varchar_255 VARCHAR(255),
        varchar_plain VARCHAR,
        char_10 CHAR(10),
        character_20 CHARACTER(20),
        nchar_50 NCHAR(50),
        nvarchar_200 NVARCHAR(200),
        text_col TEXT,
        
        -- Integer types with UNSIGNED variants (should map to Int32 or Int64)
        tinyint_unsigned TINYINT UNSIGNED,
        smallint_unsigned SMALLINT UNSIGNED, 
        mediumint_unsigned MEDIUMINT UNSIGNED,
        int_unsigned INT UNSIGNED,
        integer_unsigned INTEGER UNSIGNED,
        bigint_unsigned BIGINT UNSIGNED,
        
        -- JSON variants (should both map to Json)
        json_col JSON,
        jsonb_col JSONB,
        
        -- Other supported types
        boolean_col BOOLEAN,
        datetime_col DATETIME,
        blob_col BLOB
      );
    `);

    const result = await adapter.queryRaw({
      sql: "SELECT * FROM type_support_test LIMIT 0",
      args: [],
      argTypes: []
    });

    const expectedTypes = [
      ColumnTypeEnum.Int32,    // id
      ColumnTypeEnum.Text,     // varchar_255
      ColumnTypeEnum.Text,     // varchar_plain
      ColumnTypeEnum.Text,     // char_10
      ColumnTypeEnum.Text,     // character_20
      ColumnTypeEnum.Text,     // nchar_50
      ColumnTypeEnum.Text,     // nvarchar_200
      ColumnTypeEnum.Text,     // text_col
      ColumnTypeEnum.Int32,    // tinyint_unsigned
      ColumnTypeEnum.Int32,    // smallint_unsigned
      ColumnTypeEnum.Int32,    // mediumint_unsigned
      ColumnTypeEnum.Int32,    // int_unsigned
      ColumnTypeEnum.Int32,    // integer_unsigned
      ColumnTypeEnum.Int64,    // bigint_unsigned
      ColumnTypeEnum.Json,     // json_col
      ColumnTypeEnum.Json,     // jsonb_col
      ColumnTypeEnum.Boolean,  // boolean_col
      ColumnTypeEnum.DateTime, // datetime_col
      ColumnTypeEnum.Bytes,    // blob_col
    ];

    expect(result.columnTypes).toEqual(expectedTypes);
  });

  it("should handle Prisma migration table types correctly", async () => {
    // This is the exact table structure that Prisma creates for migrations
    await adapter.executeScript(`
      CREATE TABLE "_prisma_migrations" (
          "id"                    TEXT PRIMARY KEY NOT NULL,
          "checksum"              TEXT NOT NULL,
          "finished_at"           DATETIME,
          "migration_name"        TEXT NOT NULL,
          "logs"                  TEXT,
          "rolled_back_at"        DATETIME,
          "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
          "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
      );
    `);

    const result = await adapter.queryRaw({
      sql: "SELECT * FROM _prisma_migrations LIMIT 0",
      args: [],
      argTypes: []
    });

    const expectedTypes = [
      ColumnTypeEnum.Text,     // id
      ColumnTypeEnum.Text,     // checksum
      ColumnTypeEnum.DateTime, // finished_at
      ColumnTypeEnum.Text,     // migration_name
      ColumnTypeEnum.Text,     // logs
      ColumnTypeEnum.DateTime, // rolled_back_at
      ColumnTypeEnum.DateTime, // started_at
      ColumnTypeEnum.Int32,    // applied_steps_count (INTEGER UNSIGNED)
    ];

    expect(result.columnTypes).toEqual(expectedTypes);
  });

  it("should handle common Prisma schema types", async () => {
    // Common types that might appear in Prisma schemas
    await adapter.executeScript(`
      CREATE TABLE user_example (
        id TEXT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(191) UNIQUE,
        age INTEGER UNSIGNED,
        balance DECIMAL(10,2),
        is_active BOOLEAN DEFAULT true,
        profile JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME
      );
    `);

    const result = await adapter.queryRaw({
      sql: "SELECT * FROM user_example LIMIT 0", 
      args: [],
      argTypes: []
    });

    const expectedTypes = [
      ColumnTypeEnum.Text,     // id
      ColumnTypeEnum.Text,     // name (VARCHAR with length)
      ColumnTypeEnum.Text,     // email (VARCHAR with length)
      ColumnTypeEnum.Int32,    // age (INTEGER UNSIGNED)
      ColumnTypeEnum.Numeric,  // balance (DECIMAL)
      ColumnTypeEnum.Boolean,  // is_active
      ColumnTypeEnum.Json,     // profile (JSON)
      ColumnTypeEnum.DateTime, // created_at
      ColumnTypeEnum.DateTime, // updated_at
    ];

    expect(result.columnTypes).toEqual(expectedTypes);
  });
});