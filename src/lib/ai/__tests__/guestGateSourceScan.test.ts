// src/lib/ai/__tests__/guestGateSourceScan.test.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）のAI利用回数制限（Phase 3・v3.29・CLAUDE.md Section 23）は
// 「クライアントから送られたフラグではなく、JWTの is_anonymous クレームでゲスト判定する」
// ことが要件（クライアント送信のフラグは偽装できるため）。この不変条件をコードレビューだけに
// 頼らず、Edge Function（supabase/functions/ai-consult/index.ts）のソースを走査して機械的に
// 検証する（modalStyles.test.ts / widgetContract.test.ts と同じ「ソースを読んで検査する」方式）。
//
// 【検出の限界（正直に書く）】
// テキスト走査であり、実際にDenoランタイムで実行して確認するE2Eテストではない
// （このリポジトリのテストはVitest/Node実行のみで、Edge Functionを実際に起動して確認する
// 手段が無いため）。ここでは「ゲスト判定の根拠が is_anonymous であること」「クライアント側の
// bodyから読んだ値をゲスト判定の条件式に使っていないこと」をソースの文字列パターンで検証する。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_CONSULT_INDEX = path.resolve(__dirname, "../../../../supabase/functions/ai-consult/index.ts");

const source = fs.readFileSync(AI_CONSULT_INDEX, "utf-8");

describe("ai-consult Edge Function：ゲスト判定はJWTのis_anonymousクレームだけで行う", () => {
  it("user.is_anonymous でゲスト判定している箇所が存在する", () => {
    expect(source).toContain("user.is_anonymous");
  });

  it("クライアント送信のbodyから読んだ値をゲスト判定の条件式に使っていない", () => {
    // body.isGuest / body.is_guest / body.guest のような、クライアントが送ってくる
    // フラグをif条件（ゲスト判定）に使っていないことを確認する。ai_usage_logsへのINSERT時に
    // is_guest: true を書く（記録用の固定値。判定には使わない）のは対象外のため、
    // "if" を伴う条件式としての出現だけを見る。
    const forbiddenGuestFlagPatterns = [
      /if\s*\([^)]*body\.isGuest/,
      /if\s*\([^)]*body\.is_guest/,
      /if\s*\([^)]*body\.guest/,
    ];
    for (const pattern of forbiddenGuestFlagPatterns) {
      expect(source).not.toMatch(pattern);
    }
  });

  it("ゲスト用の回数制限チェック（consume_guest_ai_quota呼び出し）がuser.is_anonymousの分岐の中にある", () => {
    const anonBlockMatch = source.match(/if\s*\(user\.is_anonymous\)\s*\{([\s\S]*?)\n {2}\}/);
    expect(anonBlockMatch).toBeTruthy();
    expect(anonBlockMatch![1]).toContain("consume_guest_ai_quota");
  });
});
