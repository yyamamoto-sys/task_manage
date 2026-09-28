import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// 一覧を丸ごと読む select を直書きすると PostgREST の1000行上限で黙って欠ける（CLAUDE.md Section 61）。
// src 配下で Supabase の select を含む文が、ページング経由か件数を絞る形になっているかを走査する。
// Section 59：コメントに書いた語で検査が無力化されないよう、コメントを除去してから走査する。

const SRC = join(__dirname, "..", "..", "..");

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : listSources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .map(line => line.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}

const CLIENT_FROM = /\bsupabase\s*\.from\(/;
const SELECT = /\.select\(/;
const ALLOWED = [
  /fetchAllRows\s*(<[^>]*>)?\(/,
  /\.limit\(/, /\.single\(/, /\.maybeSingle\(/,
  /\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/,
];

export function findUnpagedSelects(src: string): string[] {
  return stripComments(src)
    .split(";")
    .filter(stmt => CLIENT_FROM.test(stmt) && SELECT.test(stmt))
    .filter(stmt => !ALLOWED.some(re => re.test(stmt)))
    .map(stmt => stmt.trim().replace(/\s+/g, " ").slice(0, 160));
}

describe("🔴 一覧 select はページング経由にする（v3.116・Section 61）", () => {
  it("src 配下に単発の一覧 select が無い", () => {
    const offenders = listSources(SRC).flatMap(file =>
      findUnpagedSelects(readFileSync(file, "utf8")).map(s => `${relative(SRC, file)}: ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it("検査自体が効いている：直書きは検出し、コメント内の語では見逃さない", () => {
    const bad = [
      "// fetchAllRows( を使うこと",
      "const { data } = await supabase.from(\"tasks\").select(\"*\").eq(\"is_deleted\", false);",
    ].join("\n");
    expect(findUnpagedSelects(bad)).toHaveLength(1);
    const good = "const r = await fetchAllRows(o => supabase.from(\"tasks\").select(\"*\", o));";
    expect(findUnpagedSelects(good)).toEqual([]);
    const limited = "const r = await supabase.from(\"t\").select(\"id\").limit(1);";
    expect(findUnpagedSelects(limited)).toEqual([]);
  });
});
