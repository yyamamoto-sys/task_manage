// src/lib/ai/displayText.ts
//
// 【設計意図・v3.209】
// AIは「タスク名(task_001)」の形で参照を書く（プロンプトと保存データはこの形のまま＝内部で保持）。
// そのまま画面に出すと返答が記号だらけで読みにくいため、**表示の直前にだけ**識別記号を取り除く。
// AI相談の全表示経路（返答・提案カード・会話履歴・相談履歴・次の相談候補）はこの関数を通す。
// 提案の反映処理（applyProposal）は proposal の素のフィールドを使うので、ここを通さない。
//
// 変換規則：
//  - 名前の直後の括弧書き「タスク名(task_001)」「タスク名（task_001）」→「タスク名」（括弧ごと消す）
//  - 名前が付いていない参照（裸の task_001、文頭・句読点直後の括弧書き）→ 対応する名前。
//    名前を引けなければ「該当タスク」などの自然な語にする（消さない）
//  - 識別記号を含まない文はそのまま

export type AliasNameResolver = (alias: string) => string | undefined;

export type DisplaySegment =
  | { kind: "text"; text: string }
  /** alias は正規化済み（例 task_001）。resolved=名前を引けた */
  | { kind: "ref"; text: string; alias: string; resolved: boolean };

const ALIAS_SRC = "(?:task_?|(?:pj|kr|tf|o)_)\\d{1,4}";
const GUARD_BEFORE = "(?<![A-Za-z0-9_])";
const GUARD_AFTER = "(?![A-Za-z0-9_])";
const ALIAS = `${GUARD_BEFORE}${ALIAS_SRC}${GUARD_AFTER}`;
const PAREN = `[（(]\\s*(${ALIAS}(?:\\s*[,、，]\\s*${ALIAS})*)\\s*[）)]`;
const TOKEN_RE = new RegExp(`${PAREN}|(${ALIAS})`, "gi");
const ALIAS_RE = new RegExp(ALIAS, "gi");

const FALLBACK_LABEL: Record<string, string> = {
  task: "該当タスク",
  pj: "該当プロジェクト",
  kr: "該当KR",
  tf: "該当TF",
  o: "該当Objective",
};

/** 「task9」「TASK_009」→「task_009」。payloadBuilder の ID 形式（小文字・3桁）に揃える */
export function normalizeAlias(raw: string): string {
  const m = /^([a-z]+)_?(\d+)$/i.exec(raw);
  if (!m) return raw.toLowerCase();
  return `${m[1].toLowerCase()}_${m[2].padStart(3, "0")}`;
}

function fallbackLabel(alias: string): string {
  return FALLBACK_LABEL[alias.split("_")[0]] ?? "該当項目";
}

/** 括弧書きの直前が「名前の続き」か（空・改行・句読点直後なら名前なしの参照とみなす） */
function isAttachedToName(before: string): boolean {
  if (before.length === 0) return false;
  return !/[\n\r、。，．,.:：;；・「『（(\-—]$/.test(before);
}

/** text を、通常の文字列と「参照（名前）」の並びに分解する。識別記号は結果に残らない */
export function splitAliasRefs(text: string, resolve?: AliasNameResolver): DisplaySegment[] {
  const segs: DisplaySegment[] = [];
  let cursor = 0;
  const pushText = (t: string) => { if (t) segs.push({ kind: "text", text: t }); };
  const refOf = (aliasRaw: string): DisplaySegment => {
    const alias = normalizeAlias(aliasRaw);
    const name = resolve?.(alias);
    return { kind: "ref", text: name ?? fallbackLabel(alias), alias, resolved: !!name };
  };

  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const before = text.slice(cursor, start);
    const parenIds = m[1];
    if (parenIds !== undefined) {
      const ids = parenIds.match(ALIAS_RE) ?? [];
      const prefix = text.slice(0, start).replace(/[ \t\u3000]+$/, "");
      if (isAttachedToName(prefix)) {
        const pending = before.replace(/[ \t\u3000]+$/, "");
        const name = ids.length === 1 ? resolve?.(normalizeAlias(ids[0])) : undefined;
        if (name && pending.endsWith(name)) {
          pushText(pending.slice(0, pending.length - name.length));
          segs.push({ kind: "ref", text: name, alias: normalizeAlias(ids[0] ?? ""), resolved: true });
        } else {
          pushText(pending);
        }
      } else {
        pushText(before);
        ids.forEach((id, i) => {
          if (i > 0) pushText("、");
          segs.push(refOf(id));
        });
      }
    } else {
      pushText(before);
      segs.push(refOf(m[2] ?? ""));
    }
    cursor = start + m[0].length;
  }
  pushText(text.slice(cursor));
  return segs;
}

/** 識別記号を取り除いた表示用の文字列 */
export function stripAliasIds(text: string, resolve?: AliasNameResolver): string {
  if (!text) return text;
  return splitAliasRefs(text, resolve).map(s => s.text).join("");
}
