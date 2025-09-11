import type {
  IsolationLevel,
  SqlDriverAdapter,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
  TransactionOptions,
} from "@prisma/driver-adapter-utils";
import { Debug, DriverAdapterError } from "@prisma/driver-adapter-utils";
import { Mutex } from "async-mutex";
import { Database } from "bun:sqlite";

import { name as packageName } from '../package.json'
import { convertDriverError } from "./errors";
import { getColumnTypes, mapQueryArgs, mapRow, Row } from "./conversion";

const debug = Debug("prisma:driver-adapter:bun-sqlite");
type StdClient = Database
const LOCK_TAG = Symbol();

type BunSQLiteResultSet = {
  declaredTypes: Array<string | null>;
  columnNames: string[];
  values: unknown[][];
};

// SqlQueryable implementation using bun:sqlite
class BunSQLiteQueryable implements SqlQueryable {
  readonly provider = "sqlite";
  readonly adapterName = packageName;

  constructor(protected readonly db: Database) { }

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const tag = "[js::queryRaw]";
    debug(`${tag} %O`, query);

    const { columnNames, declaredTypes, values } = await this.performIO(query);
    const rows = values as Array<Row>;

    const columnTypes = getColumnTypes(declaredTypes, rows);

    return {
      columnNames,
      columnTypes,
      rows: rows.map((row) => mapRow(row, columnTypes)),
    };
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    const tag = "[js::executeRaw]";
    debug(`${tag} %O`, query);
    return (await this.executeIO(query)).changes;
  }

  private async executeIO(query: SqlQuery): Promise<{ changes: number }> {
    try {
      // Check if this is a multi-statement script
      const statements = query.sql.split(';').filter(s => s.trim()).filter(s => !s.startsWith('--'));
      if (statements.length > 1) {
        debug("Executing multi-statement script by splitting into individual statements");
        // For multi-statement scripts, execute each statement individually
        if (query.args && query.args.length > 0) {
          throw new Error("Multi-statement scripts with parameters are not supported");
        }
        
        let totalChanges = 0;
        for (const statement of statements) {
          const trimmed = statement.trim();
          if (trimmed) {
            try {
              const stmt = this.db.query(trimmed);
              const result = stmt.run();
              totalChanges += result.changes;
            } catch (stmtError) {
              debug("Statement failed: %s, Error: %O", trimmed.substring(0, 50), stmtError);
              throw stmtError;
            }
          }
        }
        return Promise.resolve({ changes: totalChanges });
      }
      
      // Single statement
      const stmt = this.db.query(query.sql);
      const args = mapQueryArgs(query.args, query.argTypes);
      const result = stmt.run(...(args as any));
      return Promise.resolve({ changes: result.changes });
    } catch (e) {
      this.onError(e);
    }
  }

  private async performIO(query: SqlQuery): Promise<BunSQLiteResultSet> {
    try {
      const stmt = this.db.query(query.sql);
      const args = mapQueryArgs(query.args, query.argTypes);

      const columns = stmt.columnNames;

      if (columns.length === 0) {
        stmt.run(...(args as any));
        return Promise.resolve({
          columnNames: [],
          declaredTypes: [],
          values: [],
        });
      }

      // Schema-declared types may be available. Will be `null` for e.g. computed columns or expressions
      const declaredTypes: Array<string | null> = stmt.declaredTypes;

      const resultSet = {
        declaredTypes,
        columnNames: columns,
        values: stmt.values(...(args as any)) as unknown[][],
      };

      return Promise.resolve(resultSet);
    } catch (e) {
      this.onError(e);
    }
  }

  protected onError(error: any): never {
    debug("Error in query execution: %O", error);
    throw new DriverAdapterError(convertDriverError(error));
  }
}

// Transaction wrapper
class BunSQLiteTransaction extends BunSQLiteQueryable implements Transaction {
  private _state: 'active' | 'committed' | 'rolled_back' = 'active';

  constructor(
    db: Database,
    readonly options: TransactionOptions,
    readonly unlockParent: () => void,
  ) {
    super(db);
  }

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    if (this._state !== 'active') {
      throw new DriverAdapterError({
        kind: "TransactionAlreadyClosed",
        cause: "Cannot execute query on a closed transaction.",
      });
    }
    return super.queryRaw(query);
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    if (this._state !== 'active') {
      throw new DriverAdapterError({
        kind: "TransactionAlreadyClosed",
        cause: "Cannot execute query on a closed transaction.",
      });
    }

    // Handle COMMIT/ROLLBACK statements specially to avoid double execution
    const sql = query.sql.trim().toUpperCase();
    if (sql === 'COMMIT') {
      await this.commit();
      return 0; // Return 0 for successful commit
    }
    if (sql === 'ROLLBACK') {
      await this.rollback();
      return 0; // Return 0 for successful rollback
    }

    return super.executeRaw(query);
  }

  commit(): Promise<void> {
    debug(`[js::commit]`);
    if (this._state !== 'active') {
      debug(`[js::commit] Transaction already closed (state: ${this._state}), ignoring commit`);
      return Promise.resolve();
    }

    try {
      // Execute COMMIT directly on database
      this.db.query("COMMIT").run();
      this._state = 'committed';
    } catch (e) {
      this._state = 'rolled_back';
      debug("Error in commit: %O", e);
      throw new DriverAdapterError(convertDriverError(e));
    } finally {
      this.unlockParent();
    }
    return Promise.resolve();
  }

  rollback(): Promise<void> {
    debug(`[js::rollback]`);
    if (this._state !== 'active') {
      debug(`[js::rollback] Transaction already closed (state: ${this._state}), ignoring rollback`);
      return Promise.resolve();
    }

    try {
      // Execute ROLLBACK directly on database
      this.db.query("ROLLBACK").run();
      this._state = 'rolled_back';
    } catch (e) {
      this._state = 'rolled_back';
      debug("Error in rollback: %O", e);
      throw new DriverAdapterError(convertDriverError(e));
    } finally {
      this.unlockParent();
    }
    return Promise.resolve();
  }
}

// Primary adapter
export class PrismaBunSQLiteAdapter
  extends BunSQLiteQueryable
  implements SqlDriverAdapter {
  [LOCK_TAG] = new Mutex();

  constructor(db: Database) {
    super(db);
    // Enable foreign key constraints
    try {
      db.query("PRAGMA foreign_keys = ON").run();
    } catch (e) {
      // Ignore if pragma fails
    }
  }

  executeScript(script: string): Promise<void> {
    try {
      if (script.trim() === "") {
        return Promise.resolve();
      }
      debug("[js::executeScript] Running script: %s", script.substring(0, 100) + (script.length > 100 ? '...' : ''));
      
      // Check if we can test database connectivity first
      try {
        this.db.query("SELECT 1").get();
        debug("[js::executeScript] Database connectivity verified");
      } catch (dbError) {
        debug("[js::executeScript] Database connectivity issue: %O", dbError);
        throw dbError;
      }
      
      // Use the same logic as executeIO for consistency
      const statements = script.split(';').filter(s => s.trim()).filter(s => !s.startsWith('--'));
      if (statements.length > 1) {
        debug("[js::executeScript] Multi-statement script detected (%d statements), executing individually", statements.length);
        for (let i = 0; i < statements.length; i++) {
          const trimmed = statements[i].trim();
          if (trimmed) {
            try {
              debug("[js::executeScript] Executing statement %d: %s", i + 1, trimmed.substring(0, 50) + '...');
              const stmt = this.db.query(trimmed);
              stmt.run();
            } catch (stmtError) {
              debug("[js::executeScript] Statement %d failed: %s", i + 1, trimmed.substring(0, 100));
              debug("[js::executeScript] Statement error: %O", stmtError);
              throw stmtError;
            }
          }
        }
      } else {
        // Single statement or fallback to exec
        this.db.exec(script);
      }
      
      debug("[js::executeScript] Script completed successfully");
    } catch (e) {
      debug("[js::executeScript] Script failed: %O", e);
      this.onError(e);
    }
    return Promise.resolve();
  }

  async startTransaction(
    isolationLevel?: IsolationLevel,
  ): Promise<Transaction> {
    if (isolationLevel && isolationLevel !== "SERIALIZABLE") {
      throw new DriverAdapterError({
        kind: "InvalidIsolationLevel",
        level: isolationLevel,
      });
    }

    const options: TransactionOptions = { usePhantomQuery: false };
    debug("[js::startTransaction] options: %O", options);

    const release = await this[LOCK_TAG].acquire();
    try {
      this.db.query("BEGIN").run();
      return new BunSQLiteTransaction(this.db, options, release);
    } catch (e) {
      release();
      this.onError(e);
    }
  }

  dispose(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}

// Factory for migrations and connections
export type WALConfig = {
  enabled: boolean;
  synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
  walAutocheckpoint?: number;
  busyTimeout?: number;
};

type BunSQLiteFactoryParams = {
  url: ":memory:" | (string & {});
  shadowDatabaseURL?: ":memory:" | (string & {});
  walMode?: boolean | WALConfig;
};

export class PrismaBunSQLiteAdapterFactory
  implements SqlMigrationAwareDriverAdapterFactory {
  readonly provider = "sqlite";
  readonly adapterName = packageName;

  constructor(private readonly config: BunSQLiteFactoryParams) { }

  connect(): Promise<SqlDriverAdapter> {
    return Promise.resolve(new PrismaBunSQLiteAdapter(createBunSqliteClient({ ...this.config })));
  }

  connectToShadowDb(): Promise<SqlDriverAdapter> {
    const url = (this.config.shadowDatabaseURL ?? ":memory:")
    return Promise.resolve(new PrismaBunSQLiteAdapter(createBunSqliteClient({ ...this.config, url })));
  }
}

function createBunSqliteClient(input: BunSQLiteFactoryParams): StdClient {
  const { url, walMode } = input
  const filename = url.replace(/^file:/, '')
  const db = new Database(filename, { safeIntegers: true })

  // Configure WAL mode if enabled
  if (walMode) {
    try {
      configureWALMode(db, walMode);
    } catch (e) {
      db.close();
      throw new DriverAdapterError({
        kind: "GenericJs",
        id: 0,
        originalMessage: `Failed to configure WAL mode: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return db
}

function configureWALMode(db: Database, walConfig: boolean | WALConfig): void {
  // Normalize config
  const config: WALConfig = typeof walConfig === 'boolean' 
    ? { enabled: walConfig }
    : walConfig;

  if (!config.enabled) {
    return;
  }

  // Set journal mode to WAL
  const journalResult = db.query("PRAGMA journal_mode = WAL;").get() as { journal_mode: string } | undefined;
  const currentMode = journalResult?.journal_mode?.toLowerCase();
  
  // Memory databases don't support WAL mode, silently ignore
  if (currentMode === 'memory') {
    debug("WAL mode not supported for in-memory database, skipping");
    return;
  }
  
  if (!journalResult || currentMode !== 'wal') {
    throw new Error(`Failed to enable WAL mode. Current mode: ${currentMode || 'unknown'}`);
  }

  debug("WAL mode enabled successfully");

  // Configure synchronous mode if specified
  if (config.synchronous) {
    db.exec(`PRAGMA synchronous = ${config.synchronous};`);
    debug(`WAL synchronous mode set to: ${config.synchronous}`);
  }

  // Configure WAL autocheckpoint if specified
  if (config.walAutocheckpoint !== undefined) {
    db.exec(`PRAGMA wal_autocheckpoint = ${config.walAutocheckpoint};`);
    debug(`WAL autocheckpoint set to: ${config.walAutocheckpoint}`);
  }

  // Configure busy timeout if specified
  if (config.busyTimeout !== undefined) {
    db.exec(`PRAGMA busy_timeout = ${config.busyTimeout};`);
    debug(`Busy timeout set to: ${config.busyTimeout}ms`);
  }
}
