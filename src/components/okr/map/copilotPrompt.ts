// 会議の文字起こしを Copilot にまとめさせるためのプロンプトを、今期の KR から組む純粋関数（v3.221）。
// Teams の文字起こしは1時間で数万字になり、そのままだと LONG_RESOURCE_CHARS を超える。先に Copilot で要約してから読ませる。
// 見出しの語は checkinAi.ts の抽出（assessments の basis＝確認できた／一部／まだ、learnings＝分かったこと／次に試すこと、
// decisions＝決定／宿題、hint_values＝数字）が拾いやすい形に合わせてある。
import { BASIS_STATUSES, LEARNING_KINDS } from "./checkinAi";
import type { KrDef } from "./types";

export const COPILOT_SUMMARY_MAX_CHARS = 8000;

export interface CopilotPromptKr {
  label: string;
  text: string;
  def: KrDef | null;
}

const BAND_KEYS = [60, 70, 80, 90, 100] as const;

/** KR が1本も無いときは空文字（呼び出し側は欄を出さない） */
export function buildCopilotPrompt(krs: CopilotPromptKr[]): string {
  if (krs.length === 0) return "";
  const krBlocks = krs.map((k) => {
    const bands = BAND_KEYS.filter((b) => (k.def?.bands[b] ?? "").trim() !== "");
    const lines = [`${k.label}：${k.text}`];
    if (bands.length === 0) lines.push("  段ごとの要件：未設定（要件の判定は不要。進み具合の事実・数字と、分かったこと・次に試すことだけ書く）");
    else for (const b of bands) lines.push(`  ${b}の段の要件：${k.def?.bands[b]}`);
    if (k.def?.evidence?.trim()) lines.push(`  証拠として見るもの：${k.def.evidence.trim()}`);
    return lines.join("\n");
  });
  return [
    "あなたは会議の記録係です。この会議の文字起こしから、次の形式で要点をまとめてください。",
    "",
    "【守ること】",
    "- 発言にないことは書かない。推測しない。発言が見つからない項目は「言及なし」と書く。",
    "- 事実・数字には、発言者の名前と、だいたいの時刻（例：[12:30]ごろ）を添える。",
    `- 全体を${COPILOT_SUMMARY_MAX_CHARS}字以内にする。`,
    "",
    "【1. KRごとの整理】",
    "下の KR それぞれについて「■KR番号 題名」の見出しを立て、次の3つを書く。",
    "① 進み具合の事実・数字：KRの進み具合を示す発言の事実と数字。",
    `② 段の要件：下に示す各段の要件について、「${BASIS_STATUSES.join("／")}」のどれかと、その根拠になった発言。`,
    `③ 学び：「${LEARNING_KINDS[0]}」「${LEARNING_KINDS[1]}」を1件1文で。`,
    "",
    "対象の KR と、段ごとの要件：",
    krBlocks.join("\n"),
    "",
    "【2. 決定事項と宿題】",
    "会議全体の決定事項と宿題を、1件1行で「決定：…」「宿題：…（担当者・期限）」の形で書く。関わる KR があれば KR番号を添える。",
  ].join("\n");
}
