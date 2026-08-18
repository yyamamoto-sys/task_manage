// src/stores/__tests__/guestBranchCoverage.test.ts
//
// 【設計意図】v3.78 パートB①「ゲスト分岐の網羅性」対応（CLAUDE.md参照）。
//
// appStore.ts の書き込み系アクション（AppState interfaceに宣言された、Promise<void>を
// 返す関数群のうち load/reload/loadDemoData/setCurrentGroupId/setCurrentUserIsSuperAdmin/
// applyRemoteChangeを除いたもの）を全て列挙し、それぞれが次の3つのいずれかに
// 分類できることを検査する（modalStyles.test.ts / labViewContainment.test.ts と同じ
// 「ソースを読んで検査する」方式。AST解析はしない）：
//
//   ① 実装本文に isGuestMode() の直接ガードを持つ（Section 23の日常編集開放パターン）
//   ② DELEGATING_ACTIONS（src/lib/admin/adminOnlyActions.ts）に載っており、委譲先の
//      アクション自身が①を満たす（例：bulkShiftTasks → saveTask）
//   ③ ADMIN_ONLY_ACTIONS（同ファイル）に載っている「なぜ①が無くても安全か」の
//      許可リスト（AdminView専用・ゲストはUI分岐でAdminViewに到達できないため）
//
// v3.77で実際に見つかった saveMember の分岐漏れ（CLAUDE.md Section 35 件5）と同型の
// 漏れを、新しいアクションを足した人がテストで気づける形にする。
//
// 【わざと壊して赤くなることを確認した記録（実装前）】
// saveMilestone の `if (isGuestMode())` を一時的にコメントアウトし、①②③のいずれにも
// 当たらなくなることを確認 → テストが red になり、offenders配列に "saveMilestone" が
// 出ることを確認済み（実装後に元に戻した）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_ONLY_ACTIONS, DELEGATING_ACTIONS } from "../../lib/admin/adminOnlyActions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_STORE_PATH = path.resolve(__dirname, "../appStore.ts");

// 書き込み（Supabaseへの反映）を伴わないアクション。取得・ローカルUI状態・ゲスト専用の
// 初期化・realtime受信はこの網羅性チェックの対象外。
const NON_WRITE_ACTIONS = new Set([
  "load",
  "reload",
  "loadDemoData",
  "setCurrentGroupId",
  "setCurrentUserIsSuperAdmin",
  "applyRemoteChange",
]);

function readAppStoreSource(): string {
  return fs.readFileSync(APP_STORE_PATH, "utf8");
}

/** `export interface AppState { ... }` のブロック本文（前後の波括弧を除く）を取り出す。 */
function extractAppStateInterfaceBody(source: string): string {
  const startNeedle = "export interface AppState {";
  const startIdx = source.indexOf(startNeedle);
  if (startIdx < 0) throw new Error("extractAppStateInterfaceBody: AppState interfaceが見つかりません");
  const after = source.slice(startIdx + startNeedle.length);
  // インターフェース内の型はネストした{}を単独行に持たないため、行頭"}"を終端とみなせる。
  const endMatch = /\n\}/.exec(after);
  if (!endMatch) throw new Error("extractAppStateInterfaceBody: 終端の}が見つかりません");
  return after.slice(0, endMatch.index);
}

/** インターフェース本文から「関数型のプロパティ名」だけを抜き出す（状態フィールドは除く）。 */
function extractFunctionPropertyNames(interfaceBody: string): string[] {
  const names: string[] = [];
  for (const line of interfaceBody.split("\n")) {
    const m = /^ {2}(\w+): \(.*=>.*;$/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * `  <name>: ...` の実装本文を取り出す（`create<AppState>()((set, get) => ({ ... }))` の
 * オブジェクトリテラル内、2スペースインデントのプロパティ定義）。
 * アロー関数本体（`{ ... }`）を波括弧の深さで追跡して終端を判定する
 * （labViewContainment.test.tsと同じ「宣言的な範囲抽出」の方式）。
 */
function extractActionImplementationBody(source: string, name: string): string | null {
  const implStartNeedle = "export const useAppStore = create<AppState>()((set, get) => ({";
  const implStartIdx = source.indexOf(implStartNeedle);
  if (implStartIdx < 0) throw new Error("extractActionImplementationBody: ストア実装本体が見つかりません");
  const body = source.slice(implStartIdx);

  const propRe = new RegExp(`^  ${name}:`, "m");
  const m = propRe.exec(body);
  if (!m) return null;

  const afterName = body.slice(m.index);
  const arrowIdx = afterName.indexOf("=>");
  if (arrowIdx < 0) return null;
  let i = arrowIdx + 2;
  while (afterName[i] === " " || afterName[i] === "\n") i++;

  if (afterName[i] !== "{") {
    // 波括弧を持たない一行実装（例：`=> set({...})`）。次の改行までを本文とみなす。
    const nlIdx = afterName.indexOf("\n", i);
    return afterName.slice(0, nlIdx < 0 ? undefined : nlIdx);
  }

  let depth = 0;
  let j = i;
  for (; j < afterName.length; j++) {
    if (afterName[j] === "{") depth++;
    else if (afterName[j] === "}") {
      depth--;
      if (depth === 0) { j++; break; }
    }
  }
  return afterName.slice(0, j);
}

describe("appStore書き込み系アクション：ゲスト分岐の網羅性（CLAUDE.md Section 23・v3.78）", () => {
  const source = readAppStoreSource();
  const interfaceBody = extractAppStateInterfaceBody(source);
  const allDeclaredNames = extractFunctionPropertyNames(interfaceBody);
  const writeActionNames = allDeclaredNames.filter(n => !NON_WRITE_ACTIONS.has(n));

  it("AppState interfaceから最低限期待される書き込みアクションが読み取れている（抽出ロジックの健全性）", () => {
    // 抽出ロジック自体が壊れて0件になる事故を防ぐ最低限のセーフガード。
    expect(writeActionNames.length).toBeGreaterThan(20);
    expect(writeActionNames).toContain("saveTask");
    expect(writeActionNames).toContain("saveMember");
  });

  it("書き込み系アクションは全て「isGuestMode()ガード」「delegate」「ADMIN_ONLY_ACTIONS許可リスト」のいずれかに分類できる", () => {
    const offenders: string[] = [];
    for (const name of writeActionNames) {
      if ((ADMIN_ONLY_ACTIONS as readonly string[]).includes(name)) continue;
      if (name in DELEGATING_ACTIONS) continue;
      const body = extractActionImplementationBody(source, name);
      if (body == null) {
        offenders.push(`${name}（実装本文が見つからない）`);
        continue;
      }
      if (!body.includes("isGuestMode()")) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("DELEGATING_ACTIONSの委譲先自身は isGuestMode() ガードを持つ（委譲先が分岐を失うと連鎖的に破綻するため）", () => {
    const offenders: string[] = [];
    for (const [delegator, target] of Object.entries(DELEGATING_ACTIONS)) {
      const body = extractActionImplementationBody(source, target);
      if (body == null || !body.includes("isGuestMode()")) {
        offenders.push(`${delegator} → ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ADMIN_ONLY_ACTIONS許可リストに、実在しないアクション名（リネーム・削除で陳腐化した項目）が残っていない", () => {
    const stale = ADMIN_ONLY_ACTIONS.filter(n => !writeActionNames.includes(n));
    expect(stale).toEqual([]);
  });

  it("ADMIN_ONLY_ACTIONSに載っているアクションが、実はisGuestMode()ガードを既に持っている場合は許可リストから外すべき（許可リストの陳腐化検知）", () => {
    // 許可リストは「ガードが無いこと」の記録。ガードが後から追加されたのに許可リストにも
    // 残っていると、なぜ許可リストに載っているのか読み手に伝わらなくなる。
    const staleGuarded: string[] = [];
    for (const name of ADMIN_ONLY_ACTIONS) {
      const body = extractActionImplementationBody(source, name);
      if (body != null && body.includes("isGuestMode()")) {
        staleGuarded.push(name);
      }
    }
    expect(staleGuarded).toEqual([]);
  });
});
