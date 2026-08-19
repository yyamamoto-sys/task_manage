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

  it("SCHEMA_HEALTH_CHECKSに3件登録されている（2026-08-17の棚卸し結果2件＋v3.81で追加した1件）", () => {
    expect(functionBodyChecks).toHaveLength(3);
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

  it("visible_project_member_ids: needleは20260819d（性能改善後）にのみ存在し、20260818（改善前の初出時点）には存在しない", () => {
    const check = functionBodyChecks.find(c => c.name === "visible_project_member_ids");
    expect(check).toBeDefined();
    const before = readMigration("20260818_harden_invite_related_rls.sql");
    const after = readMigration(check!.migration);
    expect(before.includes(check!.needle)).toBe(false);
    expect(after.includes(check!.needle)).toBe(true);
  });

  it("needleは変数名・コメント文言だけの断片ではなく、実行される式・SQL構文そのものである", () => {
    // 「変数名やコメント文言のような消えやすいものを目印にしない」（本タスクの要件）ことの
    // 最低限の機械的な裏付け。needleが `--` で始まるコメント行そのものでないこと・
    // 代入(:=)/比較(=)演算子を含む実行文、または実際に構文として解釈される
    // SQLディレクティブ（例：`AS MATERIALIZED`。CTEのインライン展開を禁止する
    // 実行時の挙動を左右する構文そのもの）のどちらかであることを確認する
    // （2026-08-19・v3.81でMATERIALIZED系needleを追加した際に許容条件を拡張した。
    // 単なる識別子・命名の一部だけを見ているわけではないことの担保として、
    // 「MATERIALIZED」1語だけの一致は許さず、実際にCTE定義の一部として現れる
    // 形（`<CTE名> AS MATERIALIZED`）を要求する）。
    for (const check of functionBodyChecks) {
      expect(check.needle.trim().startsWith("--")).toBe(false);
      const isAssignmentOrComparison = /:=|=/.test(check.needle);
      const isMaterializedDirective = /\S+\s+AS\s+MATERIALIZED\b/.test(check.needle);
      expect(isAssignmentOrComparison || isMaterializedDirective).toBe(true);
    }
  });
});
