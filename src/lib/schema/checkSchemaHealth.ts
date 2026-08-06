// src/lib/schema/checkSchemaHealth.ts
//
// 【設計意図】
// schemaChecks.ts の検査項目一覧を、汎用の読み取り専用RPC（check_schema_health。
// supabase/migrations/20260806_add_schema_health_check.sql）に渡して結果を受け取る。
// 判定ロジック（RPCの応答をどう解釈するか）は resolveSchemaHealthResult に純粋関数として
// 切り出し、supabase クライアントをモックせずに単体テストできるようにしている。
//
// 【fail-safe方針（必須）】この検査が失敗しても、アプリの動作に一切影響を与えない。
// ただし「RPCが存在しない」（＝この仕組み自体のマイグレが未適用）ケースだけは、
// 黙って無効化せず "rpc_unavailable" として呼び出し側に伝える。ここを黙らせると
// 今回（on_hold事故）と同じ「静かに壊れたまま誰も気づかない」構造を再生産してしまうため。
// それ以外の失敗（一時的な通信エラー等）は "unknown" として静かに何も表示しない。

import { supabase } from "../supabase/client";
import { SCHEMA_HEALTH_CHECKS, type SchemaCheckDescriptor } from "./schemaChecks";

export type SchemaHealthResult =
  | { status: "ok" }
  | { status: "missing"; items: SchemaCheckDescriptor[] }
  | { status: "rpc_unavailable" }
  | { status: "unknown" };

interface CheckPayload {
  id: string;
  kind: SchemaCheckDescriptor["kind"];
  table?: string;
  column?: string;
  needle?: string;
  name?: string;
}

interface RpcRow {
  id: string;
  ok: boolean;
}

interface RpcErrorLike {
  code?: string;
  message?: string;
}

interface RpcOutcome {
  data: unknown;
  error: RpcErrorLike | null;
}

/**
 * RPCに送る最小のペイロードに変換する（label/migrationのような人間向け情報は送らない）。
 * 純粋関数のため __tests__/checkSchemaHealth.test.ts で直接検証できる。
 */
export function toCheckPayload(d: SchemaCheckDescriptor): CheckPayload {
  switch (d.kind) {
    case "table":
      return { id: d.id, kind: d.kind, table: d.table };
    case "column":
      return { id: d.id, kind: d.kind, table: d.table, column: d.column };
    case "check_contains":
      return { id: d.id, kind: d.kind, table: d.table, needle: d.needle };
    case "function":
      return { id: d.id, kind: d.kind, name: d.name };
  }
}

/**
 * PostgREST が「RPC関数がスキーマキャッシュに見つからない」ときに返すエラー
 * （code "PGRST202"、またはメッセージに "Could not find the function" を含む）を判別する。
 * これは「この仕組み自体のマイグレが未適用」の一次サインであり、他の一時的な失敗とは
 * 扱いを分ける（呼び出し側で唯一「可視化すべき」ケースとして扱うため）。
 */
export function isRpcMissingError(error: RpcErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true;
  return typeof error.message === "string" && error.message.includes("Could not find the function");
}

/**
 * RPCの応答（またはエラー）をSchemaHealthResultへ解釈する純粋関数。
 * - エラーが「RPC未適用」を示す場合のみ "rpc_unavailable"
 * - その他のエラーは "unknown"（画面には何も出さない。fail-safe）
 * - 応答に含まれる行のうち ok===false のものだけを missing として集める
 *   （応答に一部idが欠けている場合でも、それを「欠落」と誤読しない＝false positiveを避ける）
 */
export function resolveSchemaHealthResult(
  checks: SchemaCheckDescriptor[],
  outcome: RpcOutcome,
): SchemaHealthResult {
  if (outcome.error) {
    return isRpcMissingError(outcome.error) ? { status: "rpc_unavailable" } : { status: "unknown" };
  }
  const rows = Array.isArray(outcome.data) ? (outcome.data as RpcRow[]) : [];
  const okMap = new Map(rows.map(r => [r.id, r.ok]));
  const missing = checks.filter(c => okMap.get(c.id) === false);
  return missing.length > 0 ? { status: "missing", items: missing } : { status: "ok" };
}

/**
 * 起動時に管理者に対してのみ呼ぶ想定のエントリポイント。
 * 呼び出し側（SchemaHealthBanner）は awaitで初回描画をブロックしないこと。
 */
export async function runSchemaHealthCheck(): Promise<SchemaHealthResult> {
  try {
    const payload = SCHEMA_HEALTH_CHECKS.map(toCheckPayload);
    const { data, error } = await supabase.rpc("check_schema_health", { p_checks: payload });
    return resolveSchemaHealthResult(SCHEMA_HEALTH_CHECKS, { data, error });
  } catch {
    return { status: "unknown" };
  }
}
