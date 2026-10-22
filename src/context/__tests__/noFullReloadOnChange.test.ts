// tasks/projects の変更で load()（全件再取得）を呼ばないこと、復帰時だけ呼ぶこと（v3.146・CLAUDE.md Section 76）。
// 🔴 Section 59：コメントの文字列で検査が無力化されないよう、コメントを除去してから走査する。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("AppDataContext", () => {
  const src = code("src/context/AppDataContext.tsx");
  it("realtime のチャンネルを持たない（app-data-changes を撤去）", () => {
    expect(src).not.toMatch(/\.channel\(/);
    expect(src).not.toMatch(/postgres_changes/);
    expect(src).not.toMatch(/app-data-changes/);
  });
  it("変更をきっかけにしたデバウンス再取得（setTimeout）を持たない", () => {
    expect(src).not.toMatch(/setTimeout/);
  });
  it("初回の load() は残っている", () => {
    expect(src).toMatch(/load\(\)/);
  });
});

describe("App.tsx の realtime 購読", () => {
  const src = code("src/App.tsx");
  it("onChange は applyRemoteChange のみ。load() は onResync（復帰）経由だけ", () => {
    expect(src).toMatch(/subscribeToRealtime\(applyRemoteChange, \{\s*onResync: resync,/);
    expect(src).toMatch(/createResyncRunner\(\(\) => \{ void load\(\); \}\)/);
  });
  it("間引いた再取得の要求先（setRemoteResyncRequester）を差し込み、アンマウントで後追いタイマーの解除と要求先の解除をする", () => {
    expect(src).toMatch(/setRemoteResyncRequester\(resync\)/);
    expect(src).toMatch(/resync\.cancel\(\)/);
    expect(src).toMatch(/setRemoteResyncRequester\(null\)/);
  });
  it("最初の SUBSCRIBED で差分取得（catchUpRemoteChanges）し、失敗したら全件再取得に切り替える", () => {
    // v3.171：停止（10分以上の非表示）からの再開は全件再取得が埋めるので、差分取得は重ねない
    expect(src).toMatch(/onFirstSubscribed: resumed \? undefined : \(\) => \{ void catchUpRemoteChanges\(\)\.catch\(\(\) => resync\(\)\); \}/);
  });
  it("購読 effect の依存に loading を入れない（load のたびに張り直さない）", () => {
    expect(src).toMatch(/\[realtimeReady, applyRemoteChange, load, realtimeEpoch]/);
    expect(src).not.toMatch(/\[loading, applyRemoteChange\]/);
  });
  it("非表示からの復帰（visibilitychange）を購読し、解除する", () => {
    expect(src).toMatch(/addEventListener\("visibilitychange", onVisibility\)/);
    expect(src).toMatch(/removeEventListener\("visibilitychange", onVisibility\)/);
  });
});
