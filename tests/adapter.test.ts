import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PrismaBunSQLiteAdapter } from "../src/adapter";

describe("PrismaBunSQLiteAdapter", () => {
  let db: Database;
  let adapter: PrismaBunSQLiteAdapter;

  beforeEach(() => {
    db = new Database(":memory:");
    adapter = new PrismaBunSQLiteAdapter(db);
    
    // Create test table
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        age INTEGER,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        profile_data BLOB
      )
    `);
  });

  afterEach(async () => {
    await adapter.dispose();
  });

  describe("queryRaw", () => {
    it("should execute SELECT queries and return results", async () => {
      // Insert test data
      db.exec("INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@test.com', 25)");
      db.exec("INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@test.com', 30)");

      const result = await adapter.queryRaw({
        sql: "SELECT * FROM users ORDER BY id",
        args: [],
        argTypes: []
      });

      expect(result.columnNames).toEqual(['id', 'name', 'email', 'age', 'is_active', 'created_at', 'profile_data']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual([1, 'Alice', 'alice@test.com', 25, 1, expect.any(String), null]);
      expect(result.rows[1]).toEqual([2, 'Bob', 'bob@test.com', 30, 1, expect.any(String), null]);
    });

    it("should handle parameterized queries", async () => {
      db.exec("INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@test.com', 25)");

      const result = await adapter.queryRaw({
        sql: "SELECT * FROM users WHERE age > ? AND name = ?",
        args: ["20", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0][1]).toBe('Alice');
    });

    it("should handle empty result sets", async () => {
      const result = await adapter.queryRaw({
        sql: "SELECT * FROM users WHERE id = ?",
        args: ["999"],
        argTypes: ["Int32"]
      });

      expect(result.columnNames).toEqual(['id', 'name', 'email', 'age', 'is_active', 'created_at', 'profile_data']);
      expect(result.rows).toHaveLength(0);
    });

    it("should handle BLOB data", async () => {
      const blobData = new Uint8Array([1, 2, 3, 4, 5]);
      db.query("INSERT INTO users (name, email, profile_data) VALUES (?, ?, ?)")
        .run("Test User", "test@example.com", blobData);

      const result = await adapter.queryRaw({
        sql: "SELECT profile_data FROM users WHERE name = ?",
        args: ["Test User"],
        argTypes: ["Text"]
      });

      expect(result.rows[0][0]).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("executeRaw", () => {
    it("should execute INSERT statements and return affected rows", async () => {
      const result = await adapter.executeRaw({
        sql: "INSERT INTO users (name, email, age) VALUES (?, ?, ?)",
        args: ["Charlie", "charlie@test.com", "35"],
        argTypes: ["Text", "Text", "Int32"]
      });

      expect(result).toBe(1);
      
      // Verify the insert worked
      const selectResult = await adapter.queryRaw({
        sql: "SELECT name FROM users WHERE email = ?",
        args: ["charlie@test.com"],
        argTypes: ["Text"]
      });
      expect(selectResult.rows[0][0]).toBe("Charlie");
    });

    it("should execute UPDATE statements and return affected rows", async () => {
      db.exec("INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@test.com', 25)");
      db.exec("INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@test.com', 30)");

      const result = await adapter.executeRaw({
        sql: "UPDATE users SET age = ? WHERE name = ?",
        args: ["26", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      expect(result).toBe(1);
    });

    it("should execute DELETE statements and return affected rows", async () => {
      db.exec("INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@test.com', 25)");
      db.exec("INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@test.com', 30)");

      const result = await adapter.executeRaw({
        sql: "DELETE FROM users WHERE age > ?",
        args: ["28"],
        argTypes: ["Int32"]
      });

      expect(result).toBe(1);
    });
  });

  describe("executeScript", () => {
    it("should execute multiple SQL statements", async () => {
      const script = `
        INSERT INTO users (name, email, age) VALUES ('User1', 'user1@test.com', 20);
        INSERT INTO users (name, email, age) VALUES ('User2', 'user2@test.com', 25);
        INSERT INTO users (name, email, age) VALUES ('User3', 'user3@test.com', 30);
      `;

      await adapter.executeScript(script);

      const result = await adapter.queryRaw({
        sql: "SELECT COUNT(*) as count FROM users",
        args: [],
        argTypes: []
      });

      expect(result.rows[0][0]).toBe(3);
    });

    it("should handle empty scripts", async () => {
      await expect(adapter.executeScript("")).resolves.toBeUndefined();
    });
  });

  describe("provider and adapterName", () => {
    it("should have correct provider and adapter name", () => {
      expect(adapter.provider).toBe("sqlite");
      expect(adapter.adapterName).toBe("@synapsenwerkstatt/prisma-bun-sqlite-adapter");
    });
  });

  describe("column type detection", () => {
    it("should detect proper column types from table schema", async () => {
      // Create a table with various column types
      db.exec(`
        CREATE TABLE type_test (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          age INTEGER,
          salary REAL,
          is_active BOOLEAN,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          data BLOB
        )
      `);
      
      // Insert test data with datetime string (SQLite default format)
      db.exec(`
        INSERT INTO type_test (name, age, salary, is_active, created_at, data) 
        VALUES ('Test User', 25, 50000.50, 1, '2025-08-20 14:42:26', X'deadbeef')
      `);

      const result = await adapter.queryRaw({
        sql: "SELECT * FROM type_test",
        args: [],
        argTypes: []
      });

      // Verify column types are detected correctly
      expect(result.columnTypes).toEqual([
        0,     // id - INTEGER (Int32)
        7,     // name - TEXT
        0,     // age - INTEGER (Int32)
        3,     // salary - REAL (Double)
        5,     // is_active - BOOLEAN
        10,    // created_at - DATETIME
        13     // data - BLOB (Bytes)
      ]);

      // Verify datetime is properly converted from ISO string format
      expect(result.rows[0][5]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("should handle _prisma_migrations table correctly", async () => {
      // Create the _prisma_migrations table (as Prisma does)
      db.exec(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          "id"                    TEXT PRIMARY KEY NOT NULL,
          "checksum"              TEXT NOT NULL,
          "finished_at"           DATETIME,
          "migration_name"        TEXT NOT NULL,
          "logs"                  TEXT,
          "rolled_back_at"        DATETIME,
          "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
          "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
        )
      `);

      // Insert test data similar to real Prisma migrations
      db.exec(`
        INSERT INTO "_prisma_migrations" (
          id, checksum, migration_name, started_at, finished_at, applied_steps_count
        ) VALUES (
          'test-migration-id',
          'test-checksum', 
          'test_migration',
          '2025-08-20T14:42:26.556+00:00',
          '2025-08-20T14:42:26.577+00:00',
          1
        )
      `);

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
        FROM "_prisma_migrations"
        ORDER BY started_at ASC`,
        args: [],
        argTypes: []
      });

      // Verify column types are detected correctly
      expect(result.columnTypes).toEqual([
        7,      // id - TEXT
        7,      // checksum - TEXT  
        10,     // finished_at - DATETIME
        7,      // migration_name - TEXT
        7,      // logs - TEXT
        10,     // rolled_back_at - DATETIME
        10,     // started_at - DATETIME
        128     // applied_steps_count - INTEGER UNSIGNED (treated as UnknownNumber due to UNSIGNED keyword)
      ]);

      // Verify datetime columns are properly converted
      expect(result.rows[0][2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // finished_at
      expect(result.rows[0][6]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // started_at
    });

    it("should fallback gracefully when table info cannot be retrieved", async () => {
      // Query a non-existent table (should not crash)
      const result = await adapter.queryRaw({
        sql: "SELECT 'test' as col1, 42 as col2, 3.14 as col3",
        args: [],
        argTypes: []
      });

      // Should fall back to inference from values
      expect(result.columnNames).toEqual(["col1", "col2", "col3"]);
      expect(result.columnTypes).toEqual([
        7,    // inferred from 'test' (Text)
        128,  // inferred from 42 (UnknownNumber)
        128   // inferred from 3.14 (UnknownNumber)
      ]);
    });

    it("should handle queries without FROM clause", async () => {
      const result = await adapter.queryRaw({
        sql: "SELECT 1 as one, 'hello' as greeting",
        args: [],
        argTypes: []
      });

      // Should work without column type detection
      expect(result.columnNames).toEqual(["one", "greeting"]);
      expect(result.rows[0]).toEqual([1, "hello"]);
    });

    it("should handle table names with quotes", async () => {
      // Create table with quoted name
      db.exec(`CREATE TABLE "quoted_table" (id INTEGER, "quoted_column" TEXT)`);
      db.exec(`INSERT INTO "quoted_table" VALUES (1, 'test')`);

      const result = await adapter.queryRaw({
        sql: 'SELECT * FROM "quoted_table"',
        args: [],
        argTypes: []
      });

      expect(result.columnTypes).toEqual([0, 7]); // Int32, Text
      expect(result.rows[0]).toEqual([1, "test"]);
    });
  });
});