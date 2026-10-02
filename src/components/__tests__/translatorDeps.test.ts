// src/components/__tests__/translatorDeps.test.ts
//
// 🔴 v3.135（CLAUDE.md Section 69）：useT() の戻り値を useEffect／useLayoutEffect／useCallback の依存配列に入れない。
// v3.133 のベルは取得関数の依存に翻訳関数を入れ、描画ごとに取得をやり直して止まらなくなった。
// useT は安定化したが、取得を伴う effect・その中から呼ぶ関数は言語切替でも作り直す必要がないため、文言は ref から読む。
// useMemo（表示用の値の組み立て）は言語切替で作り直す必要があるので対象外。
// コメントは構文木の外にあるため、コメントに書いた文字列でこの検査は成立も無力化もしない（Section 59）。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const GUARDED_HOOKS = new Set(["useEffect", "useLayoutEffect", "useCallback"]);

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : listSources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

function hookName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

export function findTranslatorDeps(src: string, fileName = "x.tsx"): string[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set<string>();
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isCallExpression(node.initializer) && hookName(node.initializer.expression) === "useT") {
      names.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  if (names.size === 0) return [];

  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const hook = hookName(node.expression);
      const deps = node.arguments[node.arguments.length - 1];
      if (hook && GUARDED_HOOKS.has(hook) && node.arguments.length >= 2 && deps && ts.isArrayLiteralExpression(deps)) {
        for (const el of deps.elements) {
          if (ts.isIdentifier(el) && names.has(el.text)) {
            const { line } = sf.getLineAndCharacterOfPosition(deps.getStart(sf));
            found.push(`${hook}:${line + 1}:${el.text}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("🔴 翻訳関数を effect・callback の依存に入れない（v3.135・Section 69）", () => {
  it("src 配下に該当箇所が無い", () => {
    const offenders = listSources(SRC).flatMap(file =>
      findTranslatorDeps(readFileSync(file, "utf8"), file).map(s => `${relative(SRC, file)} ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it("検査自体が効いている：実コードは検出し、コメントの中は数えない・useMemo は対象外", () => {
    const bad = [
      "function C() {",
      "  const tr = useT();",
      "  const load = useCallback(async () => { await f(tr('k')); }, [id,",
      "    tr]);",
      "  useEffect(() => { void load(); }, [load, tr]);",
      "  const label = useMemo(() => tr('x'), [tr]);",
      "}",
    ].join("\n");
    expect(findTranslatorDeps(bad)).toEqual(["useCallback:3:tr", "useEffect:5:tr"]);

    const commented = [
      "function C() {",
      "  const t = useT();",
      "  // useEffect(() => { void load(); }, [load, t]);",
      "  /* useCallback(() => t('k'), [t]); */",
      "  useEffect(() => { void load(); }, [load]);",
      "}",
    ].join("\n");
    expect(findTranslatorDeps(commented)).toEqual([]);
  });
});
