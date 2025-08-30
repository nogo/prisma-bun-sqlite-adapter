import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PrismaBunSQLiteAdapter } from "../src/adapter";

describe("Prisma Migrations Integration", () => {
  let db: Database;
  let adapter: PrismaBunSQLiteAdapter;

  beforeEach(() => {
    db = new Database(":memory:");
    adapter = new PrismaBunSQLiteAdapter(db);
  });

  afterEach(async () => {
    await adapter.dispose();
  });

  describe("_prisma_migrations table handling", () => {
    it("should handle real _prisma_migrations table structure", async () => {
      // Create the exact table structure that Prisma creates
      await adapter.executeScript(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
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

      // Insert migration data similar to what Prisma does
      await adapter.executeRaw({
        sql: `INSERT INTO "_prisma_migrations" (
          id, checksum, migration_name, started_at, finished_at, applied_steps_count
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          "25db1205-c9d0-42fc-a2bb-a96fc6fbc26e",
          "2885464d7837ff388bf4485fffad3efed6be8be324d6006b162c9e8810603d77",
          "20250820144226_init",
          "2025-08-20T14:42:26.556+00:00",
          "2025-08-20T14:42:26.577+00:00",
          "1"
        ],
        argTypes: [{ scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }, { scalarType: "datetime", arity: "scalar" }, { scalarType: "datetime", arity: "scalar" }, { scalarType: "int", arity: "scalar" }]
      });

      // Query the migrations table exactly as Prisma does
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

      expect(result.rows).toHaveLength(1);
      
      const row = result.rows[0];
      expect(row[0]).toBe("25db1205-c9d0-42fc-a2bb-a96fc6fbc26e"); // id
      expect(row[1]).toBe("2885464d7837ff388bf4485fffad3efed6be8be324d6006b162c9e8810603d77"); // checksum
      expect(row[2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // finished_at (converted to ISO)
      expect(row[3]).toBe("20250820144226_init"); // migration_name
      expect(row[4]).toBe(null); // logs
      expect(row[5]).toBe(null); // rolled_back_at
      expect(row[6]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // started_at (converted to ISO)
      expect(row[7]).toBe(1); // applied_steps_count
    });

    it("should handle multiple migrations with different datetime formats", async () => {
      // Create migrations table
      await adapter.executeScript(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
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

      // Insert migrations with different datetime formats
      db.exec(`
        INSERT INTO "_prisma_migrations" VALUES 
        (
          'migration-1',
          'checksum-1', 
          '2025-08-20T14:42:26.556+00:00',  -- ISO with timezone
          'first_migration',
          null,
          null,
          '2025-08-20 14:42:26',            -- SQLite DATETIME format
          1
        ),
        (
          'migration-2',
          'checksum-2',
          '2025-08-20T15:00:00.000Z',       -- ISO with Z
          'second_migration', 
          null,
          null,
          '2025-08-20T15:00:00',            -- ISO without timezone
          1
        )
      `);

      const result = await adapter.queryRaw({
        sql: `SELECT migration_name, started_at, finished_at FROM "_prisma_migrations" ORDER BY started_at ASC`,
        args: [],
        argTypes: []
      });

      expect(result.rows).toHaveLength(2);
      
      // All datetime values should be converted to proper ISO format
      expect(result.rows[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // started_at
      expect(result.rows[0][2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // finished_at
      expect(result.rows[1][1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // started_at  
      expect(result.rows[1][2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // finished_at
    });

    it("should handle migration records with null datetime values", async () => {
      // Create migrations table
      await adapter.executeScript(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
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

      // Insert a migration that's in progress (finished_at and rolled_back_at are null)
      db.exec(`
        INSERT INTO "_prisma_migrations" VALUES 
        (
          'in-progress-migration',
          'checksum-in-progress',
          null,                             -- finished_at (in progress)
          'in_progress_migration',
          null,
          null,                            -- rolled_back_at
          '2025-08-20 16:00:00',           -- started_at
          0                                -- applied_steps_count
        )
      `);

      const result = await adapter.queryRaw({
        sql: `SELECT id, finished_at, rolled_back_at, started_at FROM "_prisma_migrations"`,
        args: [],
        argTypes: []
      });

      expect(result.rows).toHaveLength(1);
      
      const row = result.rows[0];
      expect(row[0]).toBe("in-progress-migration"); // id
      expect(row[1]).toBe(null);                    // finished_at (null)
      expect(row[2]).toBe(null);                    // rolled_back_at (null)
      expect(row[3]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // started_at (converted)
    });

    it("should handle edge case datetime values", async () => {
      // Create migrations table
      await adapter.executeScript(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
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

      // Insert migration with CURRENT_TIMESTAMP (uses SQLite's function)
      db.exec(`
        INSERT INTO "_prisma_migrations" (id, checksum, migration_name, applied_steps_count)
        VALUES ('current-timestamp-test', 'checksum-current', 'current_test', 1)
      `);

      const result = await adapter.queryRaw({
        sql: `SELECT started_at FROM "_prisma_migrations" WHERE id = ?`,
        args: ["current-timestamp-test"],
        argTypes: [{ scalarType: "string", arity: "scalar" }]
      });

      expect(result.rows).toHaveLength(1);
      
      // Should properly convert SQLite's CURRENT_TIMESTAMP format
      expect(result.rows[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe("user table datetime handling", () => {
    it("should handle user tables with datetime columns correctly", async () => {
      // Create a user table similar to what might exist in an app
      await adapter.executeScript(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME
        )
      `);

      // Insert user data
      db.exec(`
        INSERT INTO users VALUES 
        ('user-1', 'Alice', '2025-08-20 10:00:00', '2025-08-20T15:30:00'),
        ('user-2', 'Bob', '2025-08-20T11:00:00.123+02:00', null)
      `);

      const result = await adapter.queryRaw({
        sql: "SELECT * FROM users ORDER BY name",
        args: [],
        argTypes: []
      });

      expect(result.columnTypes).toEqual([
        7,   // id - Text
        7,   // name - Text
        10,  // created_at - DateTime
        10   // updated_at - DateTime
      ]);

      // Verify datetime conversion
      expect(result.rows[0][2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // Alice created_at
      expect(result.rows[0][3]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // Alice updated_at
      expect(result.rows[1][2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // Bob created_at
      expect(result.rows[1][3]).toBe(null); // Bob updated_at (null)
    });
  });
});