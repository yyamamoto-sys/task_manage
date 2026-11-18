// src/lib/transcriptClean.ts
//
// 会議の字幕ファイル（.vtt / .srt）を、AI に読ませる文字起こしの形に整える純粋関数（v3.221）。
// Teams の文字起こしは1時間で数万字あり、時刻行・キュー番号・タグが量の大半を占める。
// それらを除き、同じ話者の連続発言を1行にまとめ、先頭に [mm:ss] を付けるのは話者が変わる行だけにする。

interface Utterance {
  speaker: string | null;
  time: string;
  text: string;
}

const TIME_RE = /(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?\s*-->/;
const VOICE_RE = /^<v(?:\.[^\s>]*)?\s+([^>]*)>/;

function clock(h: string | undefined, m: string, s: string): string {
  const mins = Number(h ?? 0) * 60 + Number(m);
  return `${String(mins).padStart(2, "0")}:${s}`;
}

function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function joinText(a: string, b: string): string {
  if (a === "") return b;
  return /[\x21-\x7e]$/.test(a) && /^[\x21-\x7e]/.test(b) ? `${a} ${b}` : `${a}${b}`;
}

const SENTENCE_END = /[。！？.!?]$/;
/** 話者の無い字幕（srt など）は1行が際限なく伸びないよう、文末で区切る */
const NO_SPEAKER_LINE_CHARS = 120;

export function cleanTranscript(text: string, ext: string): string {
  const e = ext.replace(/^\./, "").toLowerCase();
  if (e !== "vtt" && e !== "srt") return text;
  const blocks = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const out: Utterance[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const ti = lines.findIndex((l) => TIME_RE.test(l));
    if (ti < 0) continue; // WEBVTT ヘッダ・NOTE・STYLE・REGION・時刻の無い塊
    const m = TIME_RE.exec(lines[ti]);
    if (!m) continue;
    const time = clock(m[1], m[2], m[3]);
    let speaker: string | null = null;
    for (const raw of lines.slice(ti + 1)) {
      let line = raw.trim();
      if (line === "") continue;
      const v = VOICE_RE.exec(line);
      if (v) speaker = decodeEntities(v[1]).trim() || null;
      line = decodeEntities(line.replace(/<[^>]*>/g, "")).trim();
      if (line === "") continue;
      const last = out[out.length - 1];
      if (last && last.speaker === speaker) {
        if (speaker === null && last.text.length >= NO_SPEAKER_LINE_CHARS && SENTENCE_END.test(last.text)) {
          out.push({ speaker, time, text: line });
        } else {
          last.text = joinText(last.text, line);
        }
      } else {
        out.push({ speaker, time, text: line });
      }
    }
  }
  return out.map((u) => `[${u.time}] ${u.speaker ? `${u.speaker}：` : ""}${u.text}`).join("\n");
}
