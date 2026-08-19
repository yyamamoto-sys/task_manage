// src/lib/schema/__tests__/checkSchemaHealth.test.ts
//
// 【設計意図】
// checkSchemaHealth.ts の純粋関数（toCheckPayload / isRpcMissingError /
// resolveSchemaHealthResult）を、supabaseクライアントをモックせずに直接検証する。
// runSchemaHealthCheck() 自体（supabase.rpc の薄いラッパー）はここではテストしない
// （App.tsx の is_system_bootstrapped 呼び出しと同様、既存コードベースの慣習に合わせる）。

import { describe, expect, it } from "vitest";
import {
  isRpcMissingError,
  resolveSchemaHealthResult,
  toCheckPayload,
} from "../checkSchemaHealth";
import { SCHEMA_HEALTH_CHECKS, type SchemaCheckDescriptor } from "../schemaChecks";

describe("toCheckPayload", () => {
  it("kindごとに必要なフィールドだけを送る（label/migrationは含めない）", () => {
    for (const check of SCHEMA_HEALTH_CHECKS) {
      const payload = toCheckPayload(check);
      expect(payload.id).toBe(check.id);
      expect(payload.kind).toBe(check.kind);
      expect(payload).not.toHaveProperty("label");
      expect(payload).not.toHaveProperty("migration");
    }
  });

  it("table系はtableのみ、column系はtable/column、check_contains系はtable/needle、function系はnameを含む", () => {
    expect(toCheckPayload({ id: "a", kind: "table", table: "t", label: "", migration: "" }))
      .toEqual({ id: "a", kind: "table", table: "t" });
    expect(toCheckPayload({ id: "b", kind: "column", table: "t", column: "c", label: "", migration: "" }))
      .toEqual({ id: "b", kind: "column", table: "t", column: "c" });
    expect(toCheckPayload({ id: "c", kind: "check_contains", table: "t", needle: "n", label: "", migration: "" }))
      .toEqual({ id: "c", kind: "check_contains", table: "t", needle: "n" });
    expect(toCheckPayload({ id: "d", kind: "function", name: "f", label: "", migration: "" }))
      .toEqual({ id: "d", kind: "function", name: "f" });
    expect(toCheckPayload({ id: "e", kind: "function_body_contains", name: "f", needle: "n", label: "", migration: "" }))
      .toEqual({ id: "e", kind: "function_body_contains", name: "f", needle: "n" });
    expect(toCheckPayload({ id: "f", kind: "column_type", table: "t", column: "c", udt: "_text", label: "", migration: "" }))
      .toEqual({ id: "f", kind: "column_type", table: "t", column: "c", udt: "_text" });
  });
});

describe("isRpcMissingError", () => {
  it("nullなら false", () => {
    expect(isRpcMissingError(null)).toBe(false);
  });

  it("code=PGRST202なら true", () => {
    expect(isRpcMissingError({ code: "PGRST202" })).toBe(true);
  });

  it("messageに'Could not find the function'を含むなら true", () => {
    expect(isRpcMissingError({ message: "Could not find the function public.check_schema_health" })).toBe(true);
  });

  it("それ以外のエラーは false", () => {
    expect(isRpcMissingError({ code: "PGRST301", message: "JWT expired" })).toBe(false);
  });
});

describe("resolveSchemaHealthResult", () => {
  const checks: SchemaCheckDescriptor[] = [
    { id: "a", kind: "table", table: "task_dependencies", label: "A", migration: "20260717_add_task_dependencies.sql" },
    { id: "b", kind: "check_contains", table: "tasks", needle: "on_hold", label: "B", migration: "20260721_add_task_status_hold_cancelled.sql" },
  ];

  it("RPC未適用エラー（PGRST202）は rpc_unavailable", () => {
    const result = resolveSchemaHealthResult(checks, { data: null, error: { code: "PGRST202" } });
    expect(result).toEqual({ status: "rpc_unavailable" });
  });

  it("その他のエラーは unknown（画面には何も出さないfail-safe）", () => {
    const result = resolveSchemaHealthResult(checks, { data: null, error: { code: "PGRST301" } });
    expect(result).toEqual({ status: "unknown" });
  });

  it("全項目ok=trueなら ok", () => {
    const result = resolveSchemaHealthResult(checks, {
      data: [{ id: "a", ok: true }, { id: "b", ok: true }],
      error: null,
    });
    expect(result).toEqual({ status: "ok" });
  });

  it("ok=falseの項目だけを missing として返す", () => {
    const result = resolveSchemaHealthResult(checks, {
      data: [{ id: "a", ok: true }, { id: "b", ok: false }],
      error: null,
    });
    expect(result.status).toBe("missing");
    if (result.status === "missing") {
      expect(result.items).toEqual([checks[1]]);
    }
  });

  it("応答に一部idが欠けていても、それを欠落と誤読しない（false positiveを避ける）", () => {
    const result = resolveSchemaHealthResult(checks, {
      data: [{ id: "a", ok: true }], // "b" が応答に含まれない
      error: null,
    });
    expect(result).toEqual({ status: "ok" });
  });

  it("dataが配列でない（null等）場合は空応答として扱う", () => {
    const result = resolveSchemaHealthResult(checks, { data: null, error: null });
    expect(result).toEqual({ status: "ok" });
  });
});
