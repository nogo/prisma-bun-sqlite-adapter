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

import { convertDriverError } from "./errors";
import { getColumnTypes, mapQueryArgs, mapRow, Row } from "./conversion";

const debug = Debug("prisma:driver-adapter:bun-sqlite");
const LOCK_TAG = Symbol();

type BunSQLiteResultSet = {
  declaredTypes: Array<string | null>;
  columnNames: string[];
  values: unknown[][];
};

// SqlQueryable implementation using bun:sqlite
class BunSQLiteQueryable implements SqlQueryable {
  readonly provider = "sqlite";
  readonly adapterName = "bun-sqlite";

  constructor(protected readonly db: Database) {}

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
      const stmt = this.db.query(query.sql);
      const result = stmt.run(...(mapQueryArgs(query.args, query.argTypes) as any));
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

      const resultSet = {
        declaredTypes: columns.map((col: any) => null),
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
    
    // Handle COMMIT/ROLLBACK statements specially
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
      // Silently handle multiple commit attempts (might happen if Prisma calls both executeRaw("COMMIT") and commit())
      debug(`[js::commit] Transaction already closed (state: ${this._state}), ignoring commit`);
      return Promise.resolve();
    }
    
    try {
      // Execute COMMIT directly on database, bypassing our executeRaw to avoid recursion
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
      // Silently ignore rollback attempts on already closed transactions
      // This handles Prisma's cleanup behavior where it may try to rollback after commit
      debug(`[js::rollback] Transaction already closed (state: ${this._state}), ignoring rollback`);
      return Promise.resolve();
    }

    try {
      // Execute ROLLBACK directly on database, bypassing our executeRaw to avoid recursion
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
  implements SqlDriverAdapter
{
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
      this.db.exec(script);
    } catch (e) {
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
type BunSQLiteFactoryParams = {
  url: ":memory:" | (string & {});
  shadowDatabaseURL?: ":memory:" | (string & {});
};

export class PrismaBunSQLiteAdapterFactory
  implements SqlMigrationAwareDriverAdapterFactory
{
  readonly provider = "sqlite";
  readonly adapterName = "bun-sqlite";

  constructor(private readonly config: BunSQLiteFactoryParams) {}

  connect(): Promise<SqlDriverAdapter> {
    const url = this.config.url.replace("file:", "").replace("//", "");
    const db = new Database(url);
    return Promise.resolve(new PrismaBunSQLiteAdapter(db));
  }

  connectToShadowDb(): Promise<SqlDriverAdapter> {
    const url = (this.config.shadowDatabaseURL ?? ":memory:")
      .replace("file:", "")
      .replace("//", "");
    const db = new Database(url);
    return Promise.resolve(new PrismaBunSQLiteAdapter(db));
  }
}
