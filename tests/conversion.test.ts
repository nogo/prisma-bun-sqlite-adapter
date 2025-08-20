import { describe, it, expect } from "bun:test";
import { getColumnTypes, mapRow, mapQueryArgs, type Row } from "../src/conversion";
import { ColumnTypeEnum, type ArgType } from "@prisma/driver-adapter-utils";

describe("Conversion Utilities", () => {
  describe("getColumnTypes", () => {
    it("should map declared SQLite types to Prisma column types", () => {
      const declaredTypes = ["INTEGER", "TEXT", "REAL", "BLOB", "BOOLEAN"];
      const rows: Row[] = [];

      const result = getColumnTypes(declaredTypes, rows);

      expect(result).toEqual([
        ColumnTypeEnum.Int32,
        ColumnTypeEnum.Text,
        ColumnTypeEnum.Double,
        ColumnTypeEnum.Bytes,
        ColumnTypeEnum.Boolean
      ]);
    });

    it("should handle various SQLite type aliases", () => {
      const declaredTypes = [
        "INT",
        "VARCHAR",
        "DOUBLE PRECISION",
        "DATETIME",
        "BIGINT",
        "DECIMAL",
        "FLOAT"
      ];
      const rows: Row[] = [];

      const result = getColumnTypes(declaredTypes, rows);

      expect(result).toEqual([
        ColumnTypeEnum.Int32,
        ColumnTypeEnum.Text,
        ColumnTypeEnum.Double,
        ColumnTypeEnum.DateTime,
        ColumnTypeEnum.Int64,
        ColumnTypeEnum.Numeric,
        ColumnTypeEnum.Float
      ]);
    });

    it("should infer types from row values when declared type is null", () => {
      const declaredTypes = [null, null, null, null];
      const rows: Row[] = [
        { length: 4, 0: "hello", 1: 42, 2: 1, 3: new Uint8Array([1, 2, 3]) },
        { length: 4, 0: "world", 1: 100, 2: 0, 3: new Uint8Array([4, 5, 6]) }
      ];

      const result = getColumnTypes(declaredTypes, rows);

      expect(result).toEqual([
        ColumnTypeEnum.Text,
        ColumnTypeEnum.UnknownNumber,
        ColumnTypeEnum.UnknownNumber,
        ColumnTypeEnum.Bytes
      ]);
    });

    it("should handle bigint values", () => {
      const declaredTypes = [null];
      const rows: Row[] = [
        { length: 1, 0: BigInt(9007199254740991) }
      ];

      const result = getColumnTypes(declaredTypes, rows);

      expect(result).toEqual([ColumnTypeEnum.Int64]);
    });

    it("should fall back to Int32 for columns with all null values", () => {
      const declaredTypes = [null, null];
      const rows: Row[] = [
        { length: 2, 0: null, 1: null },
        { length: 2, 0: null, 1: null }
      ];

      const result = getColumnTypes(declaredTypes, rows);

      expect(result).toEqual([
        ColumnTypeEnum.Int32,
        ColumnTypeEnum.Int32
      ]);
    });

    it("should handle empty rows", () => {
      const declaredTypes = ["TEXT", "INTEGER"];
      const rows: Row[] = [];

      const result = getColumnTypes(declaredTypes, rows);

      expect(result).toEqual([
        ColumnTypeEnum.Text,
        ColumnTypeEnum.Int32
      ]);
    });

    it("should handle mixed declared and inferred types", () => {
      const declaredTypes = ["TEXT", null];
      const rows: Row[] = [
        { length: 2, 0: "hello", 1: 42.5 }
      ];

      const result = getColumnTypes(declaredTypes, rows);

      expect(result).toEqual([
        ColumnTypeEnum.Text,
        ColumnTypeEnum.UnknownNumber
      ]);
    });
  });

  describe("mapRow", () => {
    it("should convert Uint8Array to byte arrays", () => {
      const row: Row = {
        length: 2,
        0: "text",
        1: new Uint8Array([1, 2, 3, 4])
      };
      const columnTypes = [ColumnTypeEnum.Text, ColumnTypeEnum.Bytes];

      const result = mapRow(row, columnTypes);

      expect(result).toEqual(["text", [1, 2, 3, 4]]);
    });

    it("should truncate non-integer numbers for integer columns", () => {
      const row: Row = {
        length: 3,
        0: 42.7,
        1: 99.9,
        2: 10.1
      };
      const columnTypes = [
        ColumnTypeEnum.Int32,
        ColumnTypeEnum.Int64,
        ColumnTypeEnum.Double
      ];

      const result = mapRow(row, columnTypes);

      expect(result).toEqual([42, 99, 10.1]); // Only first two truncated
    });

    it("should convert datetime numeric timestamps to ISO strings", () => {
      const timestamp = 1640995200000; // 2022-01-01T00:00:00.000Z
      const row: Row = {
        length: 2,
        0: timestamp,
        1: BigInt(timestamp)
      };
      const columnTypes = [ColumnTypeEnum.DateTime, ColumnTypeEnum.DateTime];

      const result = mapRow(row, columnTypes);

      expect(result).toEqual([
        "2022-01-01T00:00:00.000Z",
        "2022-01-01T00:00:00.000Z"
      ]);
    });

    it("should convert datetime ISO strings to ISO strings", () => {
      const row: Row = {
        length: 4,
        0: "2025-08-20 14:42:26",           // SQLite DATETIME format
        1: "2025-08-20T14:42:26.556+00:00", // ISO format with timezone
        2: "2025-08-20T14:42:26.556Z",      // ISO format with Z
        3: "2025-08-20T14:42:26"            // ISO format without timezone
      };
      const columnTypes = [
        ColumnTypeEnum.DateTime,
        ColumnTypeEnum.DateTime,
        ColumnTypeEnum.DateTime,
        ColumnTypeEnum.DateTime
      ];

      const result = mapRow(row, columnTypes);

      expect(result).toEqual([
        "2025-08-20T14:42:26.000Z",
        "2025-08-20T14:42:26.556Z", 
        "2025-08-20T14:42:26.556Z",
        "2025-08-20T14:42:26.000Z"
      ]);
    });

    it("should handle invalid datetime strings gracefully", () => {
      const row: Row = {
        length: 2,
        0: "invalid-date-string",
        1: "not-a-date"
      };
      const columnTypes = [ColumnTypeEnum.DateTime, ColumnTypeEnum.DateTime];

      const result = mapRow(row, columnTypes);

      // Invalid date strings should be left as-is
      expect(result).toEqual(["invalid-date-string", "not-a-date"]);
    });

    it("should handle mixed datetime formats in same row", () => {
      const timestamp = 1640995200000; // 2022-01-01T00:00:00.000Z
      const row: Row = {
        length: 3,
        0: timestamp,                        // Numeric timestamp
        1: "2025-08-20 14:42:26",           // SQLite DATETIME format
        2: "regular text"                    // Non-datetime column
      };
      const columnTypes = [
        ColumnTypeEnum.DateTime,
        ColumnTypeEnum.DateTime,
        ColumnTypeEnum.Text
      ];

      const result = mapRow(row, columnTypes);

      expect(result).toEqual([
        "2022-01-01T00:00:00.000Z",
        "2025-08-20T14:42:26.000Z",
        "regular text"
      ]);
    });

    it("should convert bigint to string", () => {
      const row: Row = {
        length: 2,
        0: BigInt(9007199254740991),
        1: "regular string"
      };
      const columnTypes = [ColumnTypeEnum.Int64, ColumnTypeEnum.Text];

      const result = mapRow(row, columnTypes);

      expect(result).toEqual(["9007199254740991", "regular string"]);
    });

    it("should preserve null values", () => {
      const row: Row = {
        length: 3,
        0: null,
        1: "text",
        2: null
      };
      const columnTypes = [
        ColumnTypeEnum.Text,
        ColumnTypeEnum.Text,
        ColumnTypeEnum.Int32
      ];

      const result = mapRow(row, columnTypes);

      expect(result).toEqual([null, "text", null]);
    });

    it("should handle complex row with multiple data types", () => {
      const row: Row = {
        length: 6,
        0: 42,
        1: "hello",
        2: 1,
        3: new Uint8Array([1, 2, 3]),
        4: BigInt(123456789),
        5: 1640995200000
      };
      const columnTypes = [
        ColumnTypeEnum.Int32,
        ColumnTypeEnum.Text,
        ColumnTypeEnum.Boolean,
        ColumnTypeEnum.Bytes,
        ColumnTypeEnum.Int64,
        ColumnTypeEnum.DateTime
      ];

      const result = mapRow(row, columnTypes);

      expect(result).toEqual([
        42,
        "hello",
        1,
        [1, 2, 3],
        "123456789",
        "2022-01-01T00:00:00.000Z"
      ]);
    });
  });

  describe("mapQueryArgs", () => {
    it("should parse Int32 arguments", () => {
      const args = ["42", "100"];
      const argTypes: ArgType[] = ["Int32", "Int32"];

      const result = mapQueryArgs(args, argTypes);

      expect(result).toEqual([42, 100]);
    });

    it("should parse Float and Double arguments", () => {
      const args = ["3.14", "2.718"];
      const argTypes: ArgType[] = ["Float", "Double"];

      const result = mapQueryArgs(args, argTypes);

      expect(result).toEqual([3.14, 2.718]);
    });

    it("should convert boolean to 1/0", () => {
      const args = [true, false];
      const argTypes: ArgType[] = ["Boolean", "Boolean"];

      const result = mapQueryArgs(args, argTypes);

      expect(result).toEqual([1, 0]);
    });

    it("should format Date objects for SQLite", () => {
      const date = new Date("2022-01-01T12:30:45.123Z");
      const args = [date];
      const argTypes: ArgType[] = ["DateTime"];

      const result = mapQueryArgs(args, argTypes);

      expect(result).toEqual(["2022-01-01 12:30:45"]);
    });

    it("should preserve Uint8Array for blobs", () => {
      const blobData = new Uint8Array([1, 2, 3, 4]);
      const args = [blobData];
      const argTypes: ArgType[] = ["Bytes"];

      const result = mapQueryArgs(args, argTypes);

      expect(result).toEqual([blobData]);
    });

    it("should convert ArrayBuffer to Uint8Array", () => {
      const buffer = new ArrayBuffer(4);
      const view = new Uint8Array(buffer);
      view[0] = 1;
      view[1] = 2;
      view[2] = 3;
      view[3] = 4;

      const args = [buffer];
      const argTypes: ArgType[] = ["Bytes"];

      const result = mapQueryArgs(args, argTypes);

      expect(result[0]).toBeInstanceOf(Uint8Array);
      expect(Array.from(result[0] as Uint8Array)).toEqual([1, 2, 3, 4]);
    });

    it("should preserve other argument types unchanged", () => {
      const args = ["text", null, undefined];
      const argTypes: ArgType[] = ["Text", "Text", "Text"];

      const result = mapQueryArgs(args, argTypes);

      expect(result).toEqual(["text", null, undefined]);
    });

    it("should handle mixed argument types", () => {
      const date = new Date("2022-01-01T12:00:00.000Z");
      const blob = new Uint8Array([1, 2, 3]);
      const args = ["42", "3.14", true, false, date, blob, "text"];
      const argTypes: ArgType[] = ["Int32", "Float", "Boolean", "Boolean", "DateTime", "Bytes", "Text"];

      const result = mapQueryArgs(args, argTypes);

      expect(result).toEqual([
        42,
        3.14,
        1,
        0,
        "2022-01-01 12:00:00",
        blob,
        "text"
      ]);
    });
  });
});