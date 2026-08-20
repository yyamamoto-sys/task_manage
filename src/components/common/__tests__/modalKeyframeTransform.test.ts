// src/components/common/__tests__/modalKeyframeTransform.test.ts
//
// 【設計意図】
// 2026-08-20、globals.css の @keyframes modalEnter が「旧 top:50%/left:50% 中央寄せ方式
// （画面中央に絶対配置して自分の幅・高さの半分だけ戻す手法）」の名残である
// translate(-50%, -50%) を animation-fill-mode:both（.animate-modalEnter）で永久に残していた。
// 現在のモーダルは margin:auto 方式（CLAUDE.md Section 21・modalStyles.ts）で中央寄せしている
// ため、この transform は純粋な「余計なズレ」になり、箱が可視領域の半分より高くなった瞬間に
// 上端が画面外に出てスクロールでも到達できなくなる（QuickAddTaskModal で実際に発生）。
//
// modalStyles.test.ts は「インラインstyleの中央寄せ手段（alignItems:center / margin:auto）」
// しか検査しておらず、**CSSアニメーション由来のtransform残留**は検出できなかった（今回の不具合が
// 機械チェックをすり抜けた理由）。このテストはその穴を塞ぐ。modalStyles.test.ts /
// widgetContract.test.ts と同じ「ソースを読んで正規表現で検査する」方式。
//
// 【検査内容】
// ① globals.css の @keyframes のうち、本文に translate(-50% を含むもの（中央寄せの残骸に
//    なりうるもの）を洗い出し、それを使う .animate-*（等）クラスが、modalBoxStyle() を使う
//    モーダルの箱に適用されていないことを検査する（許可リスト方式。許可する場合は
//    ALLOWED_CENTERING_RESIDUE_USAGE に「このアニメーションは top:50%/left:50% 方式専用」等の
//    理由コメントを書く）。
// ② modalBoxStyle() を使っている箱の style オブジェクトが、transform を直接指定していないこと
//    も検査する（アニメーションクラス経由でなくても同じ穴になりうるため）。
//
// 【検出の限界】
// - CSSのパースは正規表現＋波括弧カウントによる簡易実装であり、本物のCSSパーサではない。
//   globals.css の実際の書式（1クラス1ルール・入れ子なし）を前提にしている。
// - class名とアニメーション名の対応づけは「.className { ... animation: keyframeName ... }」
//   という同一ルール内の記述のみを見る。prefers-reduced-motion のセレクタリスト
//   （".a, .b, .c { animation: none !important; }" 等）は animation 値が実在する
//   @keyframes 名と一致しないため誤って対応づけられない設計にしてある。

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, "../../../");
const GLOBALS_CSS_PATH = path.join(SRC_DIR, "styles/globals.css");

/**
 * 許可リスト：中央寄せ残骸（translate(-50%）を最終状態に持つ @keyframes を使うクラスが、
 * modalBoxStyle() を使う箱に適用されていても良いケース。キー＝クラス名、値＝理由。
 * 「このアニメーションは top:50%/left:50% 方式専用」であることを実際に確認したうえで書くこと。
 * 現時点で該当ケースは無い（0件が正しい状態）。
 */
const ALLOWED_CENTERING_RESIDUE_USAGE: Record<string, string> = {};

/** globals.css の @keyframes ブロックを波括弧カウントで抽出する（名前→本文）。 */
function parseKeyframes(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    map.set(name, css.slice(start, i - 1));
  }
  return map;
}

/**
 * globals.css の「.className { ... }」単発ルールから animation プロパティを拾い、
 * クラス名→アニメーション名（@keyframes名）の対応を作る。値が実在する@keyframes名と
 * 一致するものだけを採用する（prefers-reduced-motion の "animation: none" 等の誤対応づけを
 * 防ぐため。詳細は本ファイル冒頭コメント参照）。
 */
function parseAnimationClassMap(css: string, keyframeNames: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const className = m[1];
    const body = m[2];
    const am = /animation:\s*([\w-]+)/.exec(body);
    if (am && keyframeNames.has(am[1])) {
      map.set(className, am[1]);
    }
  }
  return map;
}

/** 本文に translate(-50% を含む @keyframes 名の集合（中央寄せ残骸の疑いがあるもの）。 */
function findCenteringResidueKeyframeNames(keyframes: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [name, body] of keyframes) {
    if (/translate\(\s*-50%/.test(body)) out.add(name);
  }
  return out;
}

/** src/ 配下の .tsx ファイル一覧（__tests__ ディレクトリ自身は除く）を再帰的に集める */
function listAllTsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listAllTsxFiles(full, out);
    } else if (entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ファイル内の各 `modalBoxStyle(` 呼び出しの直前にある className="..." の値を集める
 * （QuickAddTaskModal.tsx のように className と style={{ ...modalBoxStyle(...) }} が
 * 隣接するJSX要素の箱を検出するため）。
 */
const WINDOW_BEFORE = 250;
function classNamesBeforeModalBoxUsages(content: string): string[] {
  const results: string[] = [];
  const re = /modalBoxStyle\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const start = Math.max(0, m.index - WINDOW_BEFORE);
    const before = content.slice(start, m.index);
    const classMatches = [...before.matchAll(/className="([^"]*)"/g)];
    if (classMatches.length > 0) {
      results.push(classMatches[classMatches.length - 1][1]);
    }
  }
  return results;
}

/** クラス一覧文字列（"a b c"）の中に、対象クラスが単語単位で含まれるか。 */
function hasClassToken(classAttrValue: string, className: string): boolean {
  return classAttrValue.split(/\s+/).includes(className);
}

/**
 * `style={{ ... }}` オブジェクトの中身（波括弧カウントで抽出）を全て集める。
 * "style={{" は JSX 式コンテナ + オブジェクトリテラルの2つの `{` を開くため depth は 2 から始める。
 */
function extractInlineStyleObjects(content: string): string[] {
  const objects: string[] = [];
  const re = /style=\{\{/g;
  while (re.exec(content)) {
    let depth = 2;
    let i = re.lastIndex;
    const start = i;
    while (depth > 0 && i < content.length) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
      i++;
    }
    objects.push(content.slice(start, i));
  }
  return objects;
}

const globalsCss = fs.readFileSync(GLOBALS_CSS_PATH, "utf-8");
const keyframes = parseKeyframes(globalsCss);
const residueKeyframeNames = findCenteringResidueKeyframeNames(keyframes);
const animationClassMap = parseAnimationClassMap(globalsCss, new Set(keyframes.keys()));
const residueClasses = [...animationClassMap.entries()]
  .filter(([, kfName]) => residueKeyframeNames.has(kfName))
  .map(([className]) => className);

const allTsxFiles = listAllTsxFiles(SRC_DIR);

describe("モーダル契約：CSSアニメーション由来のtransformが箱の中央寄せを壊さないこと（CLAUDE.md Section 21・v3.84）", () => {
  it("検出ロジック自体の健全性チェック：合成フィクスチャで「残骸アニメーションクラスが箱に付いている」ケースを検出できる", () => {
    const buggyCss = `
      @keyframes fixtureEnter {
        from { opacity: 0; transform: translate(-50%, -47%) scale(0.96); }
        to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      .animate-fixtureEnter { animation: fixtureEnter 0.2s ease both; }
    `;
    const safeCss = `
      @keyframes fixtureEnterSafe {
        from { opacity: 0; transform: translateY(14px) scale(0.96); }
        to   { opacity: 1; transform: none; }
      }
      .animate-fixtureEnterSafe { animation: fixtureEnterSafe 0.2s ease both; }
    `;
    const fixtureKeyframesBuggy = parseKeyframes(buggyCss);
    const fixtureKeyframesSafe = parseKeyframes(safeCss);
    expect(findCenteringResidueKeyframeNames(fixtureKeyframesBuggy).has("fixtureEnter")).toBe(true);
    expect(findCenteringResidueKeyframeNames(fixtureKeyframesSafe).has("fixtureEnterSafe")).toBe(false);

    const classMapBuggy = parseAnimationClassMap(buggyCss, new Set(fixtureKeyframesBuggy.keys()));
    expect(classMapBuggy.get("animate-fixtureEnter")).toBe("fixtureEnter");

    const buggyTsx = `
      <div className="animate-fixtureEnter" style={{ ...modalBoxStyle("min(480px, 100%)"), background: "red" }}>
    `;
    const boxClassNames = classNamesBeforeModalBoxUsages(buggyTsx);
    expect(boxClassNames.some(v => hasClassToken(v, "animate-fixtureEnter"))).toBe(true);

    const safeTsx = `
      <div className="animate-fixtureEnterSafe" style={{ ...modalBoxStyle("min(480px, 100%)"), background: "red" }}>
    `;
    const safeBoxClassNames = classNamesBeforeModalBoxUsages(safeTsx);
    expect(safeBoxClassNames.some(v => hasClassToken(v, "animate-fixtureEnter"))).toBe(false);
  });

  it("現時点で globals.css の @keyframes に translate(-50% を含むものが無いこと（残骸ゼロ）", () => {
    // v3.84でmodalEnterのtranslate(-50%を除去した結果。新しく誰かが同じ書き方を持ち込むと
    // ここが失敗する（0件を維持することが目標）。
    expect([...residueKeyframeNames]).toEqual([]);
  });

  it.each(residueClasses)(
    "%s（translate(-50%を最終状態に持つアニメーションを使うクラス）は modalBoxStyle() を使う箱に適用されていない",
    className => {
      if (ALLOWED_CENTERING_RESIDUE_USAGE[className]) return; // 理由付きで許可済み
      const offendingFiles: string[] = [];
      for (const full of allTsxFiles) {
        const content = fs.readFileSync(full, "utf-8");
        const boxClassNames = classNamesBeforeModalBoxUsages(content);
        if (boxClassNames.some(v => hasClassToken(v, className))) {
          offendingFiles.push(path.relative(SRC_DIR, full).replace(/\\/g, "/"));
        }
      }
      if (offendingFiles.length > 0) {
        throw new Error(
          `[modalKeyframeTransform] クラス "${className}" は globals.css 上で ` +
          `translate(-50% を最終状態に持つ @keyframes を使っていますが、次のファイルで ` +
          `modalBoxStyle() を使う箱（margin:auto方式で中央寄せ）に適用されています：\n` +
          `${offendingFiles.join(", ")}\n` +
          `margin:auto方式の箱にtranslate(-50%,-50%)相当のtransformが残ると、箱が可視領域の` +
          `半分より高くなった瞬間に上端が画面外に出てスクロールでも到達できなくなります` +
          `（2026-08-20にQuickAddTaskModalで実際に発生。CLAUDE.md Section 21参照）。\n` +
          `直し方：@keyframesの終了状態をtransform:noneにするか、本当にtop:50%/left:50%方式` +
          `専用のアニメーションであるなら、このテストファイルの ` +
          `ALLOWED_CENTERING_RESIDUE_USAGE に理由付きで追加してください。`,
        );
      }
    },
  );

  it("modalBoxStyle() を使っている箱の style オブジェクトに transform が直接指定されていない", () => {
    const offending: string[] = [];
    for (const full of allTsxFiles) {
      const content = fs.readFileSync(full, "utf-8");
      const styleObjects = extractInlineStyleObjects(content);
      for (const obj of styleObjects) {
        if (/modalBoxStyle\(/.test(obj) && /\btransform\s*:/.test(obj)) {
          offending.push(path.relative(SRC_DIR, full).replace(/\\/g, "/"));
        }
      }
    }
    expect(offending).toEqual([]);
  });
});
