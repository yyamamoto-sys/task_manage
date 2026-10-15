// src/components/settings/__tests__/savePolicy.test.ts
//
// v3.155：設定画面・管理ページの「保存の見せ方」の統一（設計仕様 §3・saveUi.tsx）をソース走査で固定する。
//  ① 🚫（cursor: not-allowed）を使わない（Section 48）
//  ② 保存ボタンを手書きしない：「保存」「保存する」「追加する」の固定ラベルのボタンは SaveButton に任せる
//     （状態＝保存済み／保存／保存中・未保存の表示・cursor が共通になる）
//  ③ 管理ページの保存フォームの失敗は永続のエラー帯（SaveErrorBand）で出す＝保存の失敗を alertDialog（モーダル）で
//     出さない（実行系の削除・解除・取り消しの失敗は対象外）
// コメントは除去してから走査する（Section 59）。
//
// 【わざと壊して赤くなることを確認した記録】SettingsView.tsx に cursor: "not-allowed" を足す／AdminView.tsx に
// `<button onClick={x} style={primaryBtnStyle}>保存</button>` を足す／AdminView.tsx に
// alertDialog(`保存に失敗しました。…`) を足す → それぞれ赤になることを確認 → 戻して緑。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../../");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  }).join("\n");
}

function list(dirRel: string, exts: RegExp): string[] {
  return fs.readdirSync(path.join(SRC, dirRel)).filter(f => exts.test(f)).map(f => `${dirRel}/${f}`);
}

const FILES = [
  ...list("components/settings", /\.tsx$/),
  ...list("components/admin", /\.(tsx|ts)$/),
  "components/common/saveUi.tsx",
];

const read = (rel: string) => stripComments(fs.readFileSync(path.join(SRC, rel), "utf8"));

/** 手書きの保存ボタン（固定ラベルの button）の検出 */
export function countHandWrittenSaveButtons(src: string): number {
  return (src.match(/<button\b[^<]*?>\s*(?:保存|保存する|追加する)\s*<\/button>/g) ?? []).length;
}

/** 保存の失敗をモーダル（alertDialog）で出している箇所の検出 */
export function countSaveFailureAlerts(src: string): number {
  return (src.match(/alertDialog\(`保存に失敗しました/g) ?? []).length;
}

describe("保存の見せ方の統一（設計仕様 §3）", () => {
  it("検出器の健全性", () => {
    expect(countHandWrittenSaveButtons('<button onClick={x} style={primaryBtnStyle}>保存</button>')).toBe(1);
    expect(countHandWrittenSaveButtons('<button onClick={x}>\n  保存する\n</button>')).toBe(1);
    expect(countHandWrittenSaveButtons('<button onClick={() => onSave(v)} style={primaryBtnStyle}>保存</button>')).toBe(1);
    expect(countHandWrittenSaveButtons('<SaveButton dirty saving onClick={x} />')).toBe(0);
    expect(countSaveFailureAlerts("await alertDialog(`保存に失敗しました。\\n${msg}`);")).toBe(1);
  });

  it("対象ファイルが見つかっている", () => {
    expect(FILES.length).toBeGreaterThan(12);
  });

  it.each(FILES)("%s：cursor: not-allowed を使わない（Section 48）", (file) => {
    expect(read(file)).not.toMatch(/not-allowed/);
  });

  it.each(FILES)("%s：保存ボタンを手書きしない（SaveButton を使う）", (file) => {
    expect(countHandWrittenSaveButtons(read(file))).toBe(0);
  });

  it.each(FILES)("%s：保存の失敗を alertDialog で出さない（永続のエラー帯にする）", (file) => {
    expect(countSaveFailureAlerts(read(file))).toBe(0);
  });
});
