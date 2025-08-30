import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { PrismaBunSQLiteAdapterFactory } from "../src/adapter";

describe("WAL Mode Configuration", () => {
  let tempDbPath: string;

  beforeEach(() => {
    // Create a unique temporary database file for each test
    tempDbPath = `/tmp/test-wal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.db`;
  });

  afterEach(() => {
    // Clean up temporary database files
    try {
      const fs = require("fs");
      if (fs.existsSync(tempDbPath)) {
        fs.unlinkSync(tempDbPath);
      }
      // Also clean up WAL and SHM files
      if (fs.existsSync(tempDbPath + "-wal")) {
        fs.unlinkSync(tempDbPath + "-wal");
      }
      if (fs.existsSync(tempDbPath + "-shm")) {
        fs.unlinkSync(tempDbPath + "-shm");
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test("should create adapter without WAL mode by default", async () => {
    const factory = new PrismaBunSQLiteAdapterFactory({
      url: tempDbPath,
    });

    const adapter = await factory.connect();
    
    // Check that journal mode is not WAL
    const result = await adapter.queryRaw({
      sql: "PRAGMA journal_mode",
      args: [],
      argTypes: []
    });
    
    expect(result.rows[0]).not.toEqual(["wal"]);
    
    await adapter.dispose();
  });

  test("should enable WAL mode when walMode is true", async () => {
    const factory = new PrismaBunSQLiteAdapterFactory({
      url: tempDbPath,
      walMode: true,
    });

    const adapter = await factory.connect();
    
    // Verify WAL mode is enabled
    const result = await adapter.queryRaw({
      sql: "PRAGMA journal_mode",
      args: [],
      argTypes: []
    });
    
    expect(result.rows[0]).toEqual(["wal"]);
    
    await adapter.dispose();
  });

  test("should configure WAL mode with advanced options", async () => {
    const factory = new PrismaBunSQLiteAdapterFactory({
      url: tempDbPath,
      walMode: {
        enabled: true,
        synchronous: "NORMAL",
        walAutocheckpoint: 2000,
        busyTimeout: 10000,
      },
    });

    const adapter = await factory.connect();
    
    // Verify WAL mode
    const journalResult = await adapter.queryRaw({
      sql: "PRAGMA journal_mode",
      args: [],
      argTypes: []
    });
    expect(journalResult.rows[0]).toEqual(["wal"]);
    
    // Verify synchronous mode
    const syncResult = await adapter.queryRaw({
      sql: "PRAGMA synchronous",
      args: [],
      argTypes: []
    });
    expect(syncResult.rows[0]).toEqual(["1"]); // NORMAL = 1
    
    // Verify WAL autocheckpoint
    const walResult = await adapter.queryRaw({
      sql: "PRAGMA wal_autocheckpoint",
      args: [],
      argTypes: []
    });
    expect(walResult.rows[0]).toEqual(["2000"]);
    
    // Verify busy timeout
    const timeoutResult = await adapter.queryRaw({
      sql: "PRAGMA busy_timeout",
      args: [],
      argTypes: []
    });
    expect(timeoutResult.rows[0]).toEqual(["10000"]);
    
    await adapter.dispose();
  });

  test("should handle WAL mode disabled in config object", async () => {
    const factory = new PrismaBunSQLiteAdapterFactory({
      url: tempDbPath,
      walMode: {
        enabled: false,
      },
    });

    const adapter = await factory.connect();
    
    // Verify WAL mode is not enabled
    const result = await adapter.queryRaw({
      sql: "PRAGMA journal_mode",
      args: [],
      argTypes: []
    });
    
    expect(result.rows[0]).not.toEqual(["wal"]);
    
    await adapter.dispose();
  });

  test("should configure only specified WAL options", async () => {
    const factory = new PrismaBunSQLiteAdapterFactory({
      url: tempDbPath,
      walMode: {
        enabled: true,
        synchronous: "FULL",
        // walAutocheckpoint and busyTimeout not specified
      },
    });

    const adapter = await factory.connect();
    
    // Verify WAL mode
    const journalResult = await adapter.queryRaw({
      sql: "PRAGMA journal_mode",
      args: [],
      argTypes: []
    });
    expect(journalResult.rows[0]).toEqual(["wal"]);
    
    // Verify synchronous mode
    const syncResult = await adapter.queryRaw({
      sql: "PRAGMA synchronous",
      args: [],
      argTypes: []
    });
    expect(syncResult.rows[0]).toEqual(["2"]); // FULL = 2
    
    await adapter.dispose();
  });

  test("should work with memory database and ignore WAL mode", async () => {
    const factory = new PrismaBunSQLiteAdapterFactory({
      url: ":memory:",
      walMode: true,
    });

    const adapter = await factory.connect();
    
    // Memory databases don't support WAL mode, so it should be ignored
    // The adapter should handle this gracefully
    const result = await adapter.queryRaw({
      sql: "PRAGMA journal_mode",
      args: [],
      argTypes: []
    });
    
    // Memory databases return 'memory' mode instead of 'wal'
    expect(result.rows[0]).toEqual(["memory"]);
    
    await adapter.dispose();
  });

  test("should handle different synchronous modes", async () => {
    const modes = [
      { config: "OFF", expected: "0" },
      { config: "NORMAL", expected: "1" },
      { config: "FULL", expected: "2" },
      { config: "EXTRA", expected: "3" },
    ] as const;

    for (const mode of modes) {
      const dbPath = `/tmp/test-sync-${mode.config}-${Date.now()}.db`;
      
      try {
        const factory = new PrismaBunSQLiteAdapterFactory({
          url: dbPath,
          walMode: {
            enabled: true,
            synchronous: mode.config,
          },
        });

        const adapter = await factory.connect();
        
        const result = await adapter.queryRaw({
          sql: "PRAGMA synchronous",
          args: [],
          argTypes: []
        });
        
        expect(result.rows[0]).toEqual([mode.expected]);
        
        await adapter.dispose();
      } finally {
        // Cleanup
        try {
          const fs = require("fs");
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
          if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
          if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  });

  test("should handle WAL autocheckpoint values", async () => {
    const checkpoints = [0, 100, 1000, 5000];

    for (const checkpoint of checkpoints) {
      const dbPath = `/tmp/test-checkpoint-${checkpoint}-${Date.now()}.db`;
      
      try {
        const factory = new PrismaBunSQLiteAdapterFactory({
          url: dbPath,
          walMode: {
            enabled: true,
            walAutocheckpoint: checkpoint,
          },
        });

        const adapter = await factory.connect();
        
        const result = await adapter.queryRaw({
          sql: "PRAGMA wal_autocheckpoint",
          args: [],
          argTypes: []
        });
        
        expect(result.rows[0]).toEqual([checkpoint.toString()]);
        
        await adapter.dispose();
      } finally {
        // Cleanup
        try {
          const fs = require("fs");
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
          if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
          if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  });

  test("should handle busy timeout values", async () => {
    const timeouts = [0, 1000, 5000, 30000];

    for (const timeout of timeouts) {
      const dbPath = `/tmp/test-timeout-${timeout}-${Date.now()}.db`;
      
      try {
        const factory = new PrismaBunSQLiteAdapterFactory({
          url: dbPath,
          walMode: {
            enabled: true,
            busyTimeout: timeout,
          },
        });

        const adapter = await factory.connect();
        
        const result = await adapter.queryRaw({
          sql: "PRAGMA busy_timeout",
          args: [],
          argTypes: []
        });
        
        expect(result.rows[0]).toEqual([timeout.toString()]);
        
        await adapter.dispose();
      } finally {
        // Cleanup
        try {
          const fs = require("fs");
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
          if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
          if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  });

  test("should work with shadow database", async () => {
    const shadowDbPath = `/tmp/test-shadow-${Date.now()}.db`;
    
    try {
      const factory = new PrismaBunSQLiteAdapterFactory({
        url: tempDbPath,
        shadowDatabaseURL: shadowDbPath,
        walMode: true,
      });

      const adapter = await factory.connectToShadowDb();
      
      // Verify WAL mode is enabled on shadow database
      const result = await adapter.queryRaw({
        sql: "PRAGMA journal_mode",
        args: [],
        argTypes: []
      });
      
      expect(result.rows[0]).toEqual(["wal"]);
      
      await adapter.dispose();
    } finally {
      // Cleanup shadow database
      try {
        const fs = require("fs");
        if (fs.existsSync(shadowDbPath)) fs.unlinkSync(shadowDbPath);
        if (fs.existsSync(shadowDbPath + "-wal")) fs.unlinkSync(shadowDbPath + "-wal");
        if (fs.existsSync(shadowDbPath + "-shm")) fs.unlinkSync(shadowDbPath + "-shm");
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });
});