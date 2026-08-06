// src/lib/schema/__tests__/schemaChecks.test.ts
//
// 【設計意図】
// schemaChecks.ts の各項目が指す migration ファイルが supabase/migrations/ に
// 実在することを機械的に検証する（version.test.ts / modalStyles.test.ts と同じ
// 「ソース/ファイルを読んで検査する」方式）。存在しないファイル名を書いた時点で落ちる
// ため、今後の追記漏れ・誤字を検知できる。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_HEALTH_CHECKS } from "../schemaChecks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../supabase/migrations");

describe("SCHEMA_HEALTH_CHECKS: 各項目のmigrationファイルが実在する", () => {
  const migrationFiles = new Set(fs.readdirSync(MIGRATIONS_DIR));

  for (const check of SCHEMA_HEALTH_CHECKS) {
    it(`${check.id}: "${check.migration}" が supabase/migrations/ に存在する`, () => {
      expect(migrationFiles.has(check.migration)).toBe(true);
    });
  }

  it("idがSCHEMA_HEALTH_CHECKS内で重複していない", () => {
    const ids = SCHEMA_HEALTH_CHECKS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labelとmigrationが全項目で空文字ではない", () => {
    for (const check of SCHEMA_HEALTH_CHECKS) {
      expect(check.label.length).toBeGreaterThan(0);
      expect(check.migration.length).toBeGreaterThan(0);
    }
  });
});
