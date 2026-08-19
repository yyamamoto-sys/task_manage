// src/lib/schema/__tests__/columnTypeChecks.test.ts
//
// 【設計意図】
// kind:"column_type" の udt が「宣言されている型」と実際に一致することを固定する回帰
// テスト。実際のPostgres（information_schema.columns.udt_name）を起動して検証する手段が
// このリポジトリのテスト環境（Vitest/Node）に無いため、宣言側（マイグレーションSQLの
// テキスト）に対して直接検証する（functionBodyContainsNeedles.test.tsと同じ考え方）。
//
// CLAUDE.md Section 22の「わざと壊して赤くなることを確認する」の記録として、このファイルは
// 以下の順で作成した：
//   1. projects.owner_member_idsのudtを意図的に間違った値（"_uuid"）に差し替えて
//      `npx vitest run columnTypeChecks` を実行し、宣言（20260819b_fix_owner_member_ids_type.sql
//      の `ALTER COLUMN owner_member_ids TYPE text[]`）と食い違うため fail（red）になることを
//      確認した。
//   2. 正しいudt（"_text"）に戻し、pass（green）になることを確認した。

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

// udt_name（information_schema.columns。配列型は先頭に"_"が付く内部表記）と
// SQLの型表記の対応。このリポジトリで実際に使う分だけを持つ（網羅目的ではない）。
const UDT_TO_SQL_ARRAY_TYPE: Record<string, string> = {
  _text: "text[]",
  _uuid: "uuid[]",
};

describe("kind:\"column_type\" のudtは宣言されている型と一致する", () => {
  const columnTypeChecks = SCHEMA_HEALTH_CHECKS.filter(
    (c): c is Extract<typeof c, { kind: "column_type" }> => c.kind === "column_type",
  );

  it("SCHEMA_HEALTH_CHECKSに3件登録されている（visible_project_member_ids()がUNIONする3列と一致）", () => {
    expect(columnTypeChecks).toHaveLength(3);
  });

  it("projects.owner_member_ids: udtは'_text'（20260819b_fix_owner_member_ids_type.sqlの ALTER COLUMN ... TYPE text[] と一致）", () => {
    const check = columnTypeChecks.find(c => c.table === "projects" && c.column === "owner_member_ids");
    expect(check).toBeDefined();
    const sql = readMigration(check!.migration);
    const expectedSqlType = UDT_TO_SQL_ARRAY_TYPE[check!.udt];
    expect(expectedSqlType).toBeDefined();
    expect(sql).toContain(`ALTER COLUMN owner_member_ids TYPE ${expectedSqlType}`);
  });

  it("projects.member_ids: udtは'_text'（20260515_add_project_member_ids.sqlの宣言と一致）", () => {
    const check = columnTypeChecks.find(c => c.table === "projects" && c.column === "member_ids");
    expect(check).toBeDefined();
    const sql = readMigration(check!.migration);
    const expectedSqlType = UDT_TO_SQL_ARRAY_TYPE[check!.udt];
    expect(expectedSqlType).toBeDefined();
    expect(sql).toContain(`member_ids ${expectedSqlType}`);
  });

  it("tasks.assignee_member_ids: udtは'_text'（20260420_add_task_assignee_member_ids.sqlの宣言と一致）", () => {
    const check = columnTypeChecks.find(c => c.table === "tasks" && c.column === "assignee_member_ids");
    expect(check).toBeDefined();
    const sql = readMigration(check!.migration);
    const expectedSqlType = UDT_TO_SQL_ARRAY_TYPE[check!.udt];
    expect(expectedSqlType).toBeDefined();
    expect(sql).toContain(`assignee_member_ids ${expectedSqlType}`);
  });

  it("udtは全件、配列型の内部表記（先頭がアンダースコア）である", () => {
    for (const check of columnTypeChecks) {
      expect(check.udt.startsWith("_")).toBe(true);
    }
  });
});
