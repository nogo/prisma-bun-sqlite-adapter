import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PrismaBunSQLiteAdapter } from "../src/adapter";
import { convertDriverError } from "../src/errors";
import { DriverAdapterError } from "@prisma/driver-adapter-utils";

describe("Error Handling Tests", () => {
  let db: Database;
  let adapter: PrismaBunSQLiteAdapter;

  beforeEach(() => {
    db = new Database(":memory:");
    adapter = new PrismaBunSQLiteAdapter(db);
    
    // Create test table with constraints
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        age INTEGER
      )
    `);

    db.exec(`
      CREATE TABLE profiles (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        bio TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  });

  afterEach(async () => {
    await adapter.dispose();
  });

  describe("convertDriverError", () => {
    it("should convert SQLITE_CONSTRAINT_UNIQUE errors", () => {
      const sqliteError = {
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message: "UNIQUE constraint failed: users.email"
      };

      const result = convertDriverError(sqliteError);
      
      expect(result.kind).toBe("UniqueConstraintViolation");
      expect(result.constraint?.fields).toEqual(["email"]);
    });

    it("should convert SQLITE_CONSTRAINT_PRIMARYKEY errors", () => {
      const sqliteError = {
        code: "SQLITE_CONSTRAINT_PRIMARYKEY",
        message: "PRIMARY KEY constraint failed: users.id"
      };

      const result = convertDriverError(sqliteError);
      
      expect(result.kind).toBe("UniqueConstraintViolation");
      expect(result.constraint?.fields).toEqual(["id"]);
    });

    it("should convert SQLITE_CONSTRAINT_NOTNULL errors", () => {
      const sqliteError = {
        code: "SQLITE_CONSTRAINT_NOTNULL",
        message: "NOT NULL constraint failed: users.name"
      };

      const result = convertDriverError(sqliteError);
      
      expect(result.kind).toBe("NullConstraintViolation");
      expect(result.constraint?.fields).toEqual(["name"]);
    });

    it("should convert SQLITE_CONSTRAINT_FOREIGNKEY errors", () => {
      const sqliteError = {
        code: "SQLITE_CONSTRAINT_FOREIGNKEY",
        message: "FOREIGN KEY constraint failed"
      };

      const result = convertDriverError(sqliteError);
      
      expect(result.kind).toBe("ForeignKeyConstraintViolation");
      expect(result.constraint?.foreignKey).toEqual({});
    });

    it("should convert SQLITE_BUSY errors", () => {
      const sqliteError = {
        code: "SQLITE_BUSY",
        message: "database is locked"
      };

      const result = convertDriverError(sqliteError);
      
      expect(result.kind).toBe("SocketTimeout");
    });

    it("should convert table not found errors", () => {
      const sqliteError = {
        code: "SQLITE_ERROR",
        message: "no such table: nonexistent_table"
      };

      const result = convertDriverError(sqliteError);
      
      expect(result.kind).toBe("TableDoesNotExist");
      expect(result.table).toBe("nonexistent_table");
    });

    it("should convert column not found errors", () => {
      const sqliteError = {
        code: "SQLITE_ERROR",
        message: "no such column: nonexistent_column"
      };

      const result = convertDriverError(sqliteError);
      
      expect(result.kind).toBe("ColumnNotFound");
      expect(result.column).toBe("nonexistent_column");
    });

    it("should convert 'has no column named' errors", () => {
      const sqliteError = {
        code: "SQLITE_ERROR",
        message: "table users has no column named nonexistent_column"
      };

      const result = convertDriverError(sqliteError);
      
      expect(result.kind).toBe("ColumnNotFound");
      expect(result.column).toBe("nonexistent_column");
    });

    it("should throw original error for unhandled cases", () => {
      const sqliteError = {
        code: "UNKNOWN_ERROR",
        message: "some unknown error"
      };

      expect(() => convertDriverError(sqliteError)).toThrow("some unknown error");
    });

    it("should throw original error for invalid error format", () => {
      const invalidError = { someProperty: "value" };

      expect(() => convertDriverError(invalidError)).toThrow();
    });
  });

  describe("Adapter error handling", () => {
    it("should handle unique constraint violations during insert", async () => {
      // Insert first user
      await adapter.executeRaw({
        sql: "INSERT INTO users (email, name) VALUES (?, ?)",
        args: ["test@example.com", "Test User"],
        argTypes: [{ scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }]
      });

      // Try to insert duplicate email
      await expect(
        adapter.executeRaw({
          sql: "INSERT INTO users (email, name) VALUES (?, ?)",
          args: ["test@example.com", "Another User"],
          argTypes: [{ scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }]
        })
      ).rejects.toThrow(DriverAdapterError);
    });

    it("should handle NOT NULL constraint violations", async () => {
      await expect(
        adapter.executeRaw({
          sql: "INSERT INTO users (email) VALUES (?)",
          args: ["test@example.com"],
          argTypes: [{ scalarType: "string", arity: "scalar" }]
        })
      ).rejects.toThrow(DriverAdapterError);
    });

    it("should handle table not found errors", async () => {
      await expect(
        adapter.queryRaw({
          sql: "SELECT * FROM nonexistent_table",
          args: [],
          argTypes: []
        })
      ).rejects.toThrow(DriverAdapterError);
    });

    it("should handle column not found errors", async () => {
      await expect(
        adapter.queryRaw({
          sql: "SELECT nonexistent_column FROM users",
          args: [],
          argTypes: []
        })
      ).rejects.toThrow(DriverAdapterError);
    });

    it("should handle syntax errors", async () => {
      await expect(
        adapter.queryRaw({
          sql: "INVALID SQL SYNTAX",
          args: [],
          argTypes: []
        })
      ).rejects.toThrow();
    });

    it("should propagate errors in executeScript", async () => {
      const invalidScript = `
        INSERT INTO users (email, name) VALUES ('test@example.com', 'Test User');
        INSERT INTO nonexistent_table (column) VALUES ('value');
      `;

      try {
        await adapter.executeScript(invalidScript);
        expect.unreachable("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(DriverAdapterError);
        expect(error.message).toBe("TableDoesNotExist");
      }
    });
  });

  describe("Transaction error handling", () => {
    it("should handle errors during transaction operations", async () => {
      const transaction = await adapter.startTransaction();

      // Valid insert
      await transaction.executeRaw({
        sql: "INSERT INTO users (email, name) VALUES (?, ?)",
        args: ["test@example.com", "Test User"],
        argTypes: [{ scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }]
      });

      // Invalid insert (duplicate email)
      await expect(
        transaction.executeRaw({
          sql: "INSERT INTO users (email, name) VALUES (?, ?)",
          args: ["test@example.com", "Another User"],
          argTypes: [{ scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }]
        })
      ).rejects.toThrow(DriverAdapterError);

      await transaction.rollback();
    });

    it("should handle transaction start errors with invalid isolation", async () => {
      await expect(
        adapter.startTransaction("READ_COMMITTED" as any)
      ).rejects.toThrow(DriverAdapterError);
    });
  });

  describe("Foreign key constraint errors", () => {
    it("should handle foreign key violations", async () => {
      // Insert user first
      await adapter.executeRaw({
        sql: "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
        args: ["1", "test@example.com", "Test User"],
        argTypes: [{ scalarType: "int", arity: "scalar" }, { scalarType: "string", arity: "scalar" }, { scalarType: "string", arity: "scalar" }]
      });

      // Try to insert profile with non-existent user_id
      await expect(
        adapter.executeRaw({
          sql: "INSERT INTO profiles (user_id, bio) VALUES (?, ?)",
          args: ["999", "Test bio"],
          argTypes: [{ scalarType: "int", arity: "scalar" }, { scalarType: "string", arity: "scalar" }]
        })
      ).rejects.toThrow(DriverAdapterError);
    });
  });
});