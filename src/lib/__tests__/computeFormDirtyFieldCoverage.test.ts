// src/lib/__tests__/computeFormDirtyFieldCoverage.test.ts
//
// 【設計意図・v3.93】
// クレーム「内容を変更したのに保存ボタンが押せない」の調査で、TaskEditFormState・
// computeFormDirty自体は現時点で全フィールドを網羅していることを確認した（taskEditPayload.test.ts
// のcomputeFormDirty群がそれを裏付けている）。ただし将来フィールドが追加されたときに
// computeFormDirty側の比較を足し忘れる（＝新フィールドを変更してもdirtyにならない＝
// 「画面上で変わったのに保存できない」という今回と同種のバグが再発する）リスクは
// 構造的に残ったままだった。
//
// このテストは、TaskEditFormState インターフェースが持つフィールド名の集合と、
// computeFormDirty が実際に比較しているフィールド名の集合をソース走査で突き合わせ、
// 両者が完全一致することを機械的に固定する。
//
// 【実装前に実施した確認（Section 22の作法にならう）】
// computeFormDirty から `if (current.parent_task_id !== baseline.parent_task_id) return true;`
// を一時的に削除し、このテストが実際に赤くなる（parent_task_idの比較漏れを検出する）ことを
// 確認済み（削除後は元に戻した）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.resolve(__dirname, "../taskEditPayload.ts");

/** `{`と`}`の対応を数えて、開始位置から対応する閉じ括弧までの範囲を切り出す。
 *  文字列・コメント内の中括弧は対象コードに存在しないため単純なカウントで足りる。 */
function extractBracedBlock(source: string, startIndex: number): string {
  const openIndex = source.indexOf("{", startIndex);
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  throw new Error("対応する閉じ括弧が見つかりませんでした（extractBracedBlock）");
}

/** `export interface TaskEditFormState { ... }` の本体から、フィールド名の集合を取り出す。
 *  コメント行（`//`始まり）は除外する。 */
function extractInterfaceFieldNames(source: string): Set<string> {
  const marker = "export interface TaskEditFormState";
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error("TaskEditFormState interfaceが見つかりません");
  const block = extractBracedBlock(source, idx);
  const fields = new Set<string>();
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line === "{" || line === "}") continue;
    const m = line.match(/^(\w+)\??:/);
    if (m) fields.add(m[1]);
  }
  return fields;
}

/** `export function computeFormDirty(...) { ... }` の本体から、`current.<field>` として
 *  参照されているフィールド名の集合を取り出す（sameStringSet呼び出し内の
 *  `current.assignee_member_ids` / `current.tags ?? []` も対象に含む）。 */
function extractComparedFieldNames(source: string): Set<string> {
  const marker = "export function computeFormDirty";
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error("computeFormDirty関数が見つかりません");
  const block = extractBracedBlock(source, idx);
  const fields = new Set<string>();
  const re = /current\.(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) fields.add(m[1]);
  return fields;
}

describe("computeFormDirty はTaskEditFormStateの全フィールドを比較している（v3.93）", () => {
  it("interfaceのフィールド集合と、computeFormDirtyがcurrent.xxxで参照しているフィールド集合が一致する", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf-8");
    const interfaceFields = extractInterfaceFieldNames(source);
    const comparedFields = extractComparedFieldNames(source);

    // 差分を出力してテスト失敗時に原因が一目で分かるようにする
    const missingFromComparison = [...interfaceFields].filter(f => !comparedFields.has(f));
    const extraInComparison = [...comparedFields].filter(f => !interfaceFields.has(f));

    expect(missingFromComparison, `computeFormDirtyで比較されていないフィールド: ${missingFromComparison.join(", ")}`).toEqual([]);
    expect(extraInComparison, `interfaceに存在しないのに参照されているフィールド: ${extraInComparison.join(", ")}`).toEqual([]);
    expect(interfaceFields.size).toBeGreaterThan(0); // 走査ロジック自体が空集合を返す壊れ方をしていないことの保険
  });

  it("検出ロジック自体の健全性：フィールドを1つ削った合成フィクスチャでは実際に検出できる", () => {
    const fixtureMissingField = `
      export interface TaskEditFormState {
        name: string;
        status: string;
        priority: string;
      }

      export function computeFormDirty(current: TaskEditFormState, baseline: TaskEditFormState): boolean {
        if (current.name !== baseline.name) return true;
        if (current.status !== baseline.status) return true;
        return false;
      }
    `;
    const interfaceFields = extractInterfaceFieldNames(fixtureMissingField);
    const comparedFields = extractComparedFieldNames(fixtureMissingField);
    const missing = [...interfaceFields].filter(f => !comparedFields.has(f));
    expect(missing).toEqual(["priority"]);
  });
});
