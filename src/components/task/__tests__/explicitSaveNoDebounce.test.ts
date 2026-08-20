// src/components/task/__tests__/explicitSaveNoDebounce.test.ts
//
// 【設計意図】
// v3.87でTaskEditModal.tsx / TaskSidePanel.tsxのform自動保存（600msデバウンス）を廃止し、
// 保存ボタン／Enter／Ctrl(Cmd)+Enterでの明示保存へ変更した（CLAUDE.md 新設グランドルール参照）。
// 「自動保存されているか分からず不安」というクレームへの対応の核心がこのデバウンス廃止のため、
// 将来の改修でうっかり復活させていないことをソース走査で機械的に検査する
// （modalStyles.test.ts / widgetContract.test.ts と同じ「ソースを読んで検査する」方式）。
//
// 【検証（実装時に実施・Section 22の作法にならう）】
// このテストのロジックを、修正前（v3.86時点＝デバウンス自動保存があった状態。
// `git show HEAD~0` 相当・commit cc81fa0時点）のTaskEditModal.tsx/TaskSidePanel.tsxの
// 実際のソースに対して走らせ、実際に検出（＝false陽性ではなく本物の検知）できることを
// 確認済み（`node`スクリプトでの単体確認。CLAUDE.md Section 22参照）。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODAL_PATH = path.resolve(__dirname, "../TaskEditModal.tsx");
const PANEL_PATH = path.resolve(__dirname, "../TaskSidePanel.tsx");

/**
 * `useEffect(() => { ... }, [depName]);` という形の副作用ブロックのうち、依存配列が
 * ちょうど `[depName]` 単体のものを走査し、その本文に setTimeout( が含まれるかを判定する。
 * setTimeout+タイマー方式の「form変更のたびに一定時間後へ保存を予約する」デバウンス自動保存の
 * 実装フィンガープリントとして扱う（実際の saveTask 呼び出しはrefのインダイレクション越しに
 * 別ブロックで行われるため、本文に "saveTask(" が直接現れるとは限らない＝依存配列と
 * setTimeoutの組み合わせで判定する）。
 */
function hasFormDebounceAutosave(source: string, depName: string): boolean {
  const pattern = new RegExp(
    `useEffect\\(\\s*\\(\\)\\s*=>\\s*\\{[\\s\\S]*?\\}\\s*,\\s*\\[${depName}\\]\\s*\\)`,
    "g",
  );
  const matches = source.match(pattern) ?? [];
  return matches.some(block => block.includes("setTimeout("));
}

describe("タスク編集面はform自動保存（デバウンス）を持たない（v3.87）", () => {
  it("TaskEditModal.tsx：useEffect(...,[form])にsetTimeoutを使ったデバウンス自動保存が無い", () => {
    const source = fs.readFileSync(MODAL_PATH, "utf-8");
    expect(hasFormDebounceAutosave(source, "form")).toBe(false);
  });

  it("TaskSidePanel.tsx：useEffect(...,[sidebarForm])にsetTimeoutを使ったデバウンス自動保存が無い", () => {
    const source = fs.readFileSync(PANEL_PATH, "utf-8");
    expect(hasFormDebounceAutosave(source, "sidebarForm")).toBe(false);
  });

  it("検出ロジック自体の健全性：合成フィクスチャでは正しく検出できる（誤って常にfalseを返す壊れたテストになっていないことの確認）", () => {
    const fixtureWithDebounce = `
      export function Dummy() {
        const [form, setForm] = useState(initial);
        useEffect(() => {
          const timer = setTimeout(() => {
            void handleAutoSaveRef.current();
          }, 600);
          return () => clearTimeout(timer);
        }, [form]);
      }
    `;
    expect(hasFormDebounceAutosave(fixtureWithDebounce, "form")).toBe(true);

    const fixtureWithoutDebounce = `
      export function Dummy() {
        const [form, setForm] = useState(initial);
        const handleSave = async () => { await saveTask(payload); };
        return <button onClick={handleSave}>保存</button>;
      }
    `;
    expect(hasFormDebounceAutosave(fixtureWithoutDebounce, "form")).toBe(false);
  });

  it("両ファイルとも常時表示の保存ボタン（明示保存の入口）を持つ", () => {
    const modalSource = fs.readFileSync(MODAL_PATH, "utf-8");
    const panelSource = fs.readFileSync(PANEL_PATH, "utf-8");
    expect(modalSource).toContain("void handleSave()");
    expect(panelSource).toContain("void handleSave()");
  });
});
