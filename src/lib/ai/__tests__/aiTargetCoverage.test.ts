// AIへ送るPJ・タスクの組み立て箇所が、必ず aiTarget.ts（アーカイブ済み除外の唯一の判定元）を通っていることの検査。
// CLAUDE.md Section 73。Section 59 に従い、コメントを除去してから走査する
// （コメントに書いた語で検査が無力化されない）。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..", "..", "..");

function listSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : listSources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
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

const rel = (p: string) => path.relative(SRC, p).replace(/\\/g, "/");

/** 「PJ・タスクをAIへ渡す関数」を呼んでよいファイルと、その理由・通すべき関数 */
interface Entry { symbol: RegExp; callers: Record<string, { gate: RegExp | null; reason: string }> }

const ENTRIES: Entry[] = [
  {
    symbol: /\bbuildPayload\b/,
    callers: {
      "lib/ai/payloadBuilder.ts": { gate: /\bresolveAiScope\s*\(/, reason: "AI相談のペイロード本体" },
      "hooks/useAIConsultation.ts": { gate: null, reason: "buildPayload を呼ぶだけ（範囲の判定は payloadBuilder 内）" },
    },
  },
  {
    symbol: /\bextractMeetingData\b/,
    callers: {
      "components/meeting/MeetingImportPanel.tsx": { gate: /\bresolveAiScope\s*\(/, reason: "資料インプット" },
    },
  },
  {
    symbol: /\banalyzeAllProjects\b/,
    callers: {
      "components/dashboard/DashboardView.tsx": { gate: /\bisAiTargetProject\s*\(/, reason: "全PJ分析" },
    },
  },
  {
    symbol: /\banalyzeProject\b/,
    callers: {
      "components/dashboard/ProjectKarte.tsx": { gate: null, reason: "PJ単体の分析（利用者が1PJを明示して実行する。範囲を絞る対象外）" },
    },
  },
];

const files = listSources(SRC);
const importers = (symbol: RegExp) =>
  files.filter(f => {
    const src = stripComments(fs.readFileSync(f, "utf8"));
    return /import[^;]*from\s+["'][^"']*(payloadBuilder|meetingExtractor|allProjectsAnalysisClient|projectAnalysisClient)["']/.test(src)
      && symbol.test(src);
  }).map(rel);

describe("AIへPJ・タスクを送る経路は aiTarget.ts を通る（アーカイブ済みPJの除外を統一）", () => {
  for (const entry of ENTRIES) {
    it(`${entry.symbol.source} を使うファイルが登録済みで、判定関数を通っている`, () => {
      const defining = files.filter(f => new RegExp(`export\\s+(async\\s+)?function\\s+${entry.symbol.source.replace(/\\b/g, "")}\\b`).test(fs.readFileSync(f, "utf8"))).map(rel);
      const actual = importers(entry.symbol).sort();
      const expected = Object.keys(entry.callers).filter(f => !defining.includes(f) || actual.includes(f)).sort();
      // 新しい呼び出し元が増えたらここで落ちる → 判定関数を通すか、理由を書いて ENTRIES に足す
      expect(actual.filter(f => !defining.includes(f))).toEqual(expected.filter(f => !defining.includes(f)));
      for (const [file, { gate }] of Object.entries(entry.callers)) {
        if (!gate) continue;
        const src = stripComments(fs.readFileSync(path.join(SRC, file), "utf8"));
        expect(gate.test(src), `${file} が aiTarget の判定関数を呼んでいない`).toBe(true);
        expect(/from\s+["'][^"']*aiTarget["']/.test(src), `${file} が aiTarget を import していない`).toBe(true);
      }
    });
  }

  it("検査自体が効いている：コメントに書いた関数名では通らない", () => {
    const fake = "// resolveAiScope( を呼ぶ\nconst x = 1;";
    expect(/\bresolveAiScope\s*\(/.test(stripComments(fake))).toBe(false);
  });
});
