// src/lib/schema/__tests__/functionBodyContainsNeedles.test.ts
//
// 【設計意図】
// kind:"function_body_contains" のneedleが実際に「本文差し替え前には存在せず、
// 差し替え後にだけ存在する」ことを固定する回帰テスト。CLAUDE.md Section 22の
// 「わざと壊して赤くなることを確認する」の記録として、このファイルは以下の順で
// 作成した：
//   1. 本テストを書く前に、意図的に間違ったneedle（旧本文にも存在する汎用的な
//      文字列）に差し替えて `npx vitest run functionBodyContainsNeedles` を実行し、
//      「旧本文にもneedleが含まれる」ため fail（red）になることを確認した。
//   2. 正しいneedle（schemaChecks.ts に実際に書いた値）に戻し、pass（green）に
//      なることを確認した。
// 実際のPostgres（pg_get_functiondef + position()）を起動して検証する手段が
// このリポジトリのテスト環境（Vitest/Node）に無いため、position()の意味と等価な
// 単純な部分文字列一致（String.includes）を、実際のマイグレーションSQLファイルの
// テキストに対して直接検証する（guestAiQuotaCounter.ts等の「参照実装で固定する」
// 方式と同じ考え方）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_HEALTH_CHECKS } from "../schemaChecks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../supabase/migrations");

function readMigration(filename: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
}

describe("function_body_contains のneedleは「本文差し替え後」にのみ存在する", () => {
  const functionBodyChecks = SCHEMA_HEALTH_CHECKS.filter(
    (c): c is Extract<typeof c, { kind: "function_body_contains" }> => c.kind === "function_body_contains",
  );

  it("SCHEMA_HEALTH_CHECKSに2件登録されている（2026-08-17の棚卸し結果と一致）", () => {
    expect(functionBodyChecks).toHaveLength(2);
  });

  it("accept_project_invite: needleは20260812（差し替え後）にのみ存在し、20260810（差し替え前）には存在しない", () => {
    const check = functionBodyChecks.find(c => c.name === "accept_project_invite");
    expect(check).toBeDefined();
    const before = readMigration("20260810_add_project_invites.sql");
    const after = readMigration(check!.migration);
    expect(before.includes(check!.needle)).toBe(false);
    expect(after.includes(check!.needle)).toBe(true);
  });

  it("guard_member_privilege_columns: needleは20260818（差し替え後）にのみ存在し、20260810（差し替え前）には存在しない", () => {
    const check = functionBodyChecks.find(c => c.name === "guard_member_privilege_columns");
    expect(check).toBeDefined();
    const before = readMigration("20260810_add_project_invites.sql");
    const after = readMigration(check!.migration);
    expect(before.includes(check!.needle)).toBe(false);
    expect(after.includes(check!.needle)).toBe(true);
  });

  it("needleは変数名・コメント文言だけの断片ではなく、実行される式そのものである（先頭が識別子+代入/比較演算子）", () => {
    // 「変数名やコメント文言のような消えやすいものを目印にしない」（本タスクの要件）ことの
    // 最低限の機械的な裏付け。needleが `--` で始まるコメント行そのものでないこと・
    // 代入(:=)または比較(=)演算子を含む実行文であることを確認する。
    for (const check of functionBodyChecks) {
      expect(check.needle.trim().startsWith("--")).toBe(false);
      expect(/:=|=/.test(check.needle)).toBe(true);
    }
  });
});
