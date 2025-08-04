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
      expect(adapter.adapterName).toBe("bun-sqlite");
    });
  });
});