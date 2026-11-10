// src/lib/ai/replyLayout.ts
//
// 【設計意図・v3.210】
// AI相談の返答は、見出し【】と箇条書き「・」を改行で区切って書かせている（systemPrompt の書式ルール）。
// 画面側の white-space は pre-wrap で改行を潰していないが、AI が改行を出さず全角スペース区切りで
// 1段落に詰めて返すことがある。その保険として、表示の直前にだけ改行を補う（保存データは変えない）。
//  - 「【」の直前（行頭・「（(の直後を除く）
//  - 箇条書きの区切りの「・」：直前が句点・】、または空白（空白の前が改行でないもの）
//  タスク名の途中の「・」（例：A・B）は前の文字が上記に当たらないので割らない。
// 補った後、行ごとに見出し／箇条書き／通常へ分類して描画側へ渡す。

export function normalizeReplyBreaks(text: string): string {
  if (!text) return text;
  return text
    .replace(/([^\n「『（(])(?=【)/g, "$1\n")
    .replace(/([。】])[ \t\u3000]*・/g, "$1\n・")
    .replace(/([^\n \t\u3000])[ \t\u3000]+・/g, "$1\n・");
}

export type ReplyLine =
  | { kind: "heading"; text: string }
  | { kind: "bullet"; text: string; depth: number }
  | { kind: "text"; text: string }
  | { kind: "blank" };

/** 改行を補ったうえで行ごとに分類する。見出し・箇条書きの先頭記号「・」は text に含めたまま返す（描画側で字下げする） */
export function parseReplyLines(text: string): ReplyLine[] {
  return normalizeReplyBreaks(text)
    .split("\n")
    .map((raw): ReplyLine => {
      const line = raw.replace(/\s+$/, "");
      if (line.trim() === "") return { kind: "blank" };
      const m = /^([ \t\u3000]*)・\s*(.*)$/.exec(line);
      if (m) {
        const depth = Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").replace(/\u3000/g, "  ").length / 2));
        return { kind: "bullet", text: m[2], depth };
      }
      const t = line.trim();
      if (t.startsWith("【")) return { kind: "heading", text: t };
      return { kind: "text", text: line };
    });
}
