import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { PrismaBunSQLiteAdapter } from "../src/adapter";
import { DriverAdapterError } from "@prisma/driver-adapter-utils";

describe("Transaction Tests", () => {
  let db: Database;
  let adapter: PrismaBunSQLiteAdapter;

  beforeEach(() => {
    db = new Database(":memory:");
    adapter = new PrismaBunSQLiteAdapter(db);

    // Create test table
    db.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Insert initial data
    db.exec("INSERT INTO accounts (name, balance) VALUES ('Alice', 1000)");
    db.exec("INSERT INTO accounts (name, balance) VALUES ('Bob', 500)");
  });

  afterEach(async () => {
    await adapter.dispose();
  });

  describe("startTransaction", () => {
    it("should create a transaction with default isolation level", async () => {
      const transaction = await adapter.startTransaction();

      expect(transaction).toBeDefined();
      expect(transaction.provider).toBe("sqlite");
      expect(transaction.adapterName).toBe("@synapsenwerkstatt/prisma-bun-sqlite-adapter");
      expect(transaction.options.usePhantomQuery).toBe(false);

      await transaction.rollback();
    });

    it("should accept SERIALIZABLE isolation level", async () => {
      const transaction = await adapter.startTransaction("SERIALIZABLE");

      expect(transaction).toBeDefined();
      await transaction.rollback();
    });

    it("should reject unsupported isolation levels", async () => {
      await expect(adapter.startTransaction("READ_COMMITTED" as any)).rejects.toThrow();
      await expect(adapter.startTransaction("READ_UNCOMMITTED" as any)).rejects.toThrow();
      await expect(adapter.startTransaction("REPEATABLE_READ" as any)).rejects.toThrow();
    });
  });

  describe("transaction operations", () => {
    it("should execute queries within a transaction", async () => {
      const transaction = await adapter.startTransaction();

      const result = await transaction.queryRaw({
        sql: "SELECT * FROM accounts WHERE name = ?",
        args: ["Alice"],
        argTypes: ["Text"]
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0][1]).toBe("Alice");
      expect(result.rows[0][2]).toBe(1000);

      await transaction.rollback();
    });

    it("should execute updates within a transaction", async () => {
      const transaction = await adapter.startTransaction();

      const updateResult = await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["100", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      expect(updateResult).toBe(1);

      // Verify within transaction
      const selectResult = await transaction.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Alice"],
        argTypes: ["Text"]
      });

      expect(selectResult.rows[0][0]).toBe(900);

      await transaction.rollback();
    });
  });

  describe("transaction commit", () => {
    it("should commit changes to the database", async () => {
      const transaction = await adapter.startTransaction();

      // Transfer money from Alice to Bob
      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["200", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance + ? WHERE name = ?",
        args: ["200", "Bob"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.commit();

      // Verify changes persisted after commit
      const aliceBalance = await adapter.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Alice"],
        argTypes: ["Text"]
      });

      const bobBalance = await adapter.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Bob"],
        argTypes: ["Text"]
      });

      expect(aliceBalance.rows[0][0]).toBe(800);
      expect(bobBalance.rows[0][0]).toBe(700);
    });
  });

  describe("transaction rollback", () => {
    it("should rollback changes when explicitly rolled back", async () => {
      const transaction = await adapter.startTransaction();

      // Transfer money from Alice to Bob
      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["200", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance + ? WHERE name = ?",
        args: ["200", "Bob"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.rollback();

      // Verify changes were rolled back
      const aliceBalance = await adapter.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Alice"],
        argTypes: ["Text"]
      });

      const bobBalance = await adapter.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Bob"],
        argTypes: ["Text"]
      });

      expect(aliceBalance.rows[0][0]).toBe(1000); // Original balance
      expect(bobBalance.rows[0][0]).toBe(500);   // Original balance
    });

    it("should rollback changes when an error occurs", async () => {
      const transaction = await adapter.startTransaction();

      try {
        // Valid update
        await transaction.executeRaw({
          sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
          args: ["200", "Alice"],
          argTypes: ["Int32", "Text"]
        });

        // Invalid update (syntax error)
        await transaction.executeRaw({
          sql: "UPDATE accounts SET invalid_column = ? WHERE name = ?",
          args: ["200", "Bob"],
          argTypes: ["Int32", "Text"]
        });
      } catch (error) {
        await transaction.rollback();
      }

      // Verify original state is preserved
      const aliceBalance = await adapter.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Alice"],
        argTypes: ["Text"]
      });

      expect(aliceBalance.rows[0][0]).toBe(1000); // Original balance
    });
  });

  describe("transaction isolation", () => {
    it("should isolate transaction changes until commit", async () => {
      const transaction1 = await adapter.startTransaction();

      // Update within transaction
      await transaction1.executeRaw({
        sql: "UPDATE accounts SET balance = ? WHERE name = ?",
        args: ["999", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      // Read from within transaction should see updated value
      const insideRead = await transaction1.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Alice"],
        argTypes: ["Text"]
      });

      expect(insideRead.rows[0][0]).toBe(999); // Updated value

      await transaction1.rollback();

      // After rollback, should see original value
      const afterRollback = await adapter.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Alice"],
        argTypes: ["Text"]
      });

      expect(afterRollback.rows[0][0]).toBe(1000); // Original value
    });
  });

  describe("multiple transactions", () => {
    it("should handle sequential transactions", async () => {
      // First transaction
      const transaction1 = await adapter.startTransaction();
      await transaction1.executeRaw({
        sql: "UPDATE accounts SET balance = ? WHERE name = ?",
        args: ["900", "Alice"],
        argTypes: ["Int32", "Text"]
      });
      await transaction1.commit();

      // Second transaction
      const transaction2 = await adapter.startTransaction();
      await transaction2.executeRaw({
        sql: "UPDATE accounts SET balance = ? WHERE name = ?",
        args: ["800", "Alice"],
        argTypes: ["Int32", "Text"]
      });
      await transaction2.commit();

      // Verify final state
      const finalBalance = await adapter.queryRaw({
        sql: "SELECT balance FROM accounts WHERE name = ?",
        args: ["Alice"],
        argTypes: ["Text"]
      });

      expect(finalBalance.rows[0][0]).toBe(800);
    });
  });

  describe("transaction already closed errors", () => {
    it("should silently ignore rollback attempts after commit", async () => {
      const transaction = await adapter.startTransaction();

      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["100", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.commit();

      // Should not throw error - Prisma may attempt rollback during cleanup
      await expect(transaction.rollback()).resolves.toBeUndefined();
    });

    it("should silently ignore multiple commit attempts", async () => {
      const transaction = await adapter.startTransaction();

      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["100", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.commit();

      // Should not throw error on second commit attempt
      await expect(transaction.commit()).resolves.toBeUndefined();
    });

    it("should silently ignore multiple rollback attempts", async () => {
      const transaction = await adapter.startTransaction();

      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["100", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.rollback();

      // Should not throw error on second rollback
      await expect(transaction.rollback()).resolves.toBeUndefined();
    });

    it("should throw error when trying to query after commit", async () => {
      const transaction = await adapter.startTransaction();

      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["100", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.commit();

      try {
        await transaction.queryRaw({
          sql: "SELECT * FROM accounts WHERE name = ?",
          args: ["Alice"],
          argTypes: ["Text"]
        });
        expect.unreachable("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(DriverAdapterError);
        expect((error as DriverAdapterError).cause.kind).toBe("TransactionAlreadyClosed");
      }
    });

    it("should throw error when trying to execute after rollback", async () => {
      const transaction = await adapter.startTransaction();

      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["100", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.rollback();

      try {
        await transaction.executeRaw({
          sql: "UPDATE accounts SET balance = balance + ? WHERE name = ?",
          args: ["50", "Bob"],
          argTypes: ["Int32", "Text"]
        });
        expect.unreachable("Should have thrown error");
      } catch (error) {
        expect(error).toBeInstanceOf(DriverAdapterError);
        expect((error as DriverAdapterError).cause.kind).toBe("TransactionAlreadyClosed");
      }
    });

    it("should silently ignore commit after rollback", async () => {
      const transaction = await adapter.startTransaction();

      await transaction.executeRaw({
        sql: "UPDATE accounts SET balance = balance - ? WHERE name = ?",
        args: ["100", "Alice"],
        argTypes: ["Int32", "Text"]
      });

      await transaction.rollback();

      // Should not throw error when trying to commit after rollback
      await expect(transaction.commit()).resolves.toBeUndefined();
    });
  });
});