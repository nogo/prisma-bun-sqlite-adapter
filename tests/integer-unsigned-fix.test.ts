import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PrismaBunSQLiteAdapter } from "../src/adapter";

describe("INTEGER UNSIGNED Type Support", () => {
  let db: Database;
  let adapter: PrismaBunSQLiteAdapter;

  beforeEach(() => {
    db = new Database(":memory:");
    adapter = new PrismaBunSQLiteAdapter(db);
  });

  afterEach(async () => {
    await adapter.dispose();
  });

  it("should correctly handle INTEGER UNSIGNED columns like Prisma migrations table", async () => {
    // This test reproduces the exact issue found with Prisma's _prisma_migrations table
    // where the applied_steps_count column uses INTEGER UNSIGNED type
    
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

    // Insert a migration record
    await adapter.executeRaw({
      sql: `INSERT INTO "_prisma_migrations" (
        id, checksum, migration_name, started_at, finished_at, applied_steps_count
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        "test-migration-id",
        "test-checksum",
        "20250820000000_test",
        "2025-08-20T15:31:44.333+00:00",
        "2025-08-20T15:31:44.397+00:00",
        1
      ],
      argTypes: [{ scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }, { scalarType: "datetime", arity: "scalar" }, { scalarType: "datetime", arity: "scalar" }, { scalarType: "int", arity: "scalar" }]
    });

    // Query the migration data - this should not cause "unknown decltype" warnings
    const result = await adapter.queryRaw({
      sql: `SELECT
          id,
          checksum,
          finished_at,
          migration_name,
          logs,
          rolled_back_at,
          started_at,
          applied_steps_count
      FROM "_prisma_migrations"`,
      args: [],
      argTypes: []
    });

    expect(result.rows).toHaveLength(1);
    
    // Verify that the INTEGER UNSIGNED column is properly typed as Int32
    expect(result.columnTypes[7]).toBe(0); // ColumnTypeEnum.Int32
    
    // Verify the value is correctly handled
    const row = result.rows[0];
    expect(row[7]).toBe(1); // applied_steps_count should be 1
  });

  it("should handle INTEGER UNSIGNED in various contexts", async () => {
    await adapter.executeScript(`
      CREATE TABLE test_table (
          id TEXT PRIMARY KEY,
          unsigned_int INTEGER UNSIGNED NOT NULL DEFAULT 0,
          regular_int INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Insert test data
    await adapter.executeRaw({
      sql: "INSERT INTO test_table VALUES (?, ?, ?)",
      args: ["test1", 42, 24],
      argTypes: [{ scalarType: "string", arity: "scalar" }, { scalarType: "int", arity: "scalar" }, { scalarType: "int", arity: "scalar" }]
    });

    const result = await adapter.queryRaw({
      sql: "SELECT * FROM test_table",
      args: [],
      argTypes: []
    });

    // Both INTEGER UNSIGNED and INTEGER should be mapped to Int32
    expect(result.columnTypes[1]).toBe(0); // ColumnTypeEnum.Int32 for INTEGER UNSIGNED
    expect(result.columnTypes[2]).toBe(0); // ColumnTypeEnum.Int32 for INTEGER
    
    expect(result.rows[0][1]).toBe(42); // unsigned_int value
    expect(result.rows[0][2]).toBe(24); // regular_int value
  });
});