import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PrismaBunSQLiteAdapterFactory } from "../src/adapter";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("PrismaBunSQLiteAdapterFactory", () => {
  let factory: PrismaBunSQLiteAdapterFactory;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = join(tmpdir(), `test-${Date.now()}.db`);
  });

  afterEach(() => {
    // Clean up test database files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe("constructor and properties", () => {
    it("should have correct provider and adapter name", () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: ":memory:"
      });

      expect(factory.provider).toBe("sqlite");
      expect(factory.adapterName).toBe("@synapsenwerkstatt/prisma-bun-sqlite-adapter");
    });
  });

  describe("connect", () => {
    it("should create adapter with memory database", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: ":memory:"
      });

      const adapter = await factory.connect();

      expect(adapter).toBeDefined();
      expect(adapter.provider).toBe("sqlite");
      expect(adapter.adapterName).toBe("@synapsenwerkstatt/prisma-bun-sqlite-adapter");

      await adapter.dispose();
    });

    it("should create adapter with file database", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: testDbPath
      });

      const adapter = await factory.connect();

      expect(adapter).toBeDefined();
      expect(existsSync(testDbPath)).toBe(true);

      await adapter.dispose();
    });

    it("should handle file:// URL format", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: `file://${testDbPath}`
      });

      const adapter = await factory.connect();

      expect(adapter).toBeDefined();
      expect(existsSync(testDbPath)).toBe(true);

      await adapter.dispose();
    });

    it("should handle file: URL format", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: `file:${testDbPath}`
      });

      const adapter = await factory.connect();

      expect(adapter).toBeDefined();
      expect(existsSync(testDbPath)).toBe(true);

      await adapter.dispose();
    });

    it("should create functional adapter that can execute queries", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: ":memory:"
      });

      const adapter = await factory.connect();

      // Create a table and insert data
      await adapter.executeScript(`
        CREATE TABLE test_table (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      await adapter.executeRaw({
        sql: "INSERT INTO test_table (name) VALUES (?)",
        args: ["Test Name"],
        argTypes: [{ scalarType: "string", arity: "scalar" }]
      });

      const result = await adapter.queryRaw({
        sql: "SELECT * FROM test_table",
        args: [],
        argTypes: []
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0][1]).toBe("Test Name");

      await adapter.dispose();
    });
  });

  describe("connectToShadowDb", () => {
    it("should create shadow database with default memory database", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: testDbPath
      });

      const shadowAdapter = await factory.connectToShadowDb();

      expect(shadowAdapter).toBeDefined();
      expect(shadowAdapter.provider).toBe("sqlite");
      expect(shadowAdapter.adapterName).toBe("@synapsenwerkstatt/prisma-bun-sqlite-adapter");

      await shadowAdapter.dispose();
    });

    it("should create shadow database with specified shadow URL", async () => {
      const shadowDbPath = join(tmpdir(), `shadow-${Date.now()}.db`);

      factory = new PrismaBunSQLiteAdapterFactory({
        url: testDbPath,
        shadowDatabaseURL: shadowDbPath
      });

      const shadowAdapter = await factory.connectToShadowDb();

      expect(shadowAdapter).toBeDefined();
      expect(existsSync(shadowDbPath)).toBe(true);

      await shadowAdapter.dispose();

      // Clean up shadow database
      if (existsSync(shadowDbPath)) {
        unlinkSync(shadowDbPath);
      }
    });

    it("should handle file:// format for shadow database URL", async () => {
      const shadowDbPath = join(tmpdir(), `shadow-${Date.now()}.db`);

      factory = new PrismaBunSQLiteAdapterFactory({
        url: testDbPath,
        shadowDatabaseURL: `file://${shadowDbPath}`
      });

      const shadowAdapter = await factory.connectToShadowDb();

      expect(shadowAdapter).toBeDefined();
      expect(existsSync(shadowDbPath)).toBe(true);

      await shadowAdapter.dispose();

      // Clean up shadow database
      if (existsSync(shadowDbPath)) {
        unlinkSync(shadowDbPath);
      }
    });

    it("should create memory shadow database when specified", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: testDbPath,
        shadowDatabaseURL: ":memory:"
      });

      const shadowAdapter = await factory.connectToShadowDb();

      expect(shadowAdapter).toBeDefined();

      // Should be able to create tables and query
      await shadowAdapter.executeScript(`
        CREATE TABLE shadow_test (
          id INTEGER PRIMARY KEY,
          data TEXT
        )
      `);

      const result = await shadowAdapter.queryRaw({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='shadow_test'",
        args: [],
        argTypes: []
      });

      expect(result.rows).toHaveLength(1);

      await shadowAdapter.dispose();
    });

    it("should create independent shadow database", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: ":memory:",
        shadowDatabaseURL: ":memory:"
      });

      const mainAdapter = await factory.connect();
      const shadowAdapter = await factory.connectToShadowDb();

      // Create table in main database
      await mainAdapter.executeScript(`
        CREATE TABLE main_table (id INTEGER PRIMARY KEY)
      `);

      // Create different table in shadow database
      await shadowAdapter.executeScript(`
        CREATE TABLE shadow_table (id INTEGER PRIMARY KEY)
      `);

      // Verify tables are independent
      const mainTables = await mainAdapter.queryRaw({
        sql: "SELECT name FROM sqlite_master WHERE type='table'",
        args: [],
        argTypes: []
      });

      const shadowTables = await shadowAdapter.queryRaw({
        sql: "SELECT name FROM sqlite_master WHERE type='table'",
        args: [],
        argTypes: []
      });

      expect(mainTables.rows).toHaveLength(1);
      expect(mainTables.rows[0][0]).toBe("main_table");

      expect(shadowTables.rows).toHaveLength(1);
      expect(shadowTables.rows[0][0]).toBe("shadow_table");

      await mainAdapter.dispose();
      await shadowAdapter.dispose();
    });
  });

  describe("multiple connections", () => {
    it("should create multiple independent adapters", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: ":memory:"
      });

      const adapter1 = await factory.connect();
      const adapter2 = await factory.connect();

      // Each should be independent
      await adapter1.executeScript(`
        CREATE TABLE table1 (id INTEGER PRIMARY KEY)
      `);

      await adapter2.executeScript(`
        CREATE TABLE table2 (id INTEGER PRIMARY KEY)
      `);

      // Verify independence
      const tables1 = await adapter1.queryRaw({
        sql: "SELECT name FROM sqlite_master WHERE type='table'",
        args: [],
        argTypes: []
      });

      const tables2 = await adapter2.queryRaw({
        sql: "SELECT name FROM sqlite_master WHERE type='table'",
        args: [],
        argTypes: []
      });

      expect(tables1.rows[0][0]).toBe("table1");
      expect(tables2.rows[0][0]).toBe("table2");

      await adapter1.dispose();
      await adapter2.dispose();
    });
  });

  describe("edge cases", () => {
    it("should handle empty URL strings gracefully", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: ""
      });

      const adapter = await factory.connect();
      expect(adapter).toBeDefined();

      await adapter.dispose();
    });

    it("should handle URLs with multiple slashes", async () => {
      factory = new PrismaBunSQLiteAdapterFactory({
        url: `file:///${testDbPath}`
      });

      const adapter = await factory.connect();
      expect(adapter).toBeDefined();

      await adapter.dispose();
    });
  });
});