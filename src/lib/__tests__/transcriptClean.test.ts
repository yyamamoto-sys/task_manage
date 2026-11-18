// 字幕（.vtt / .srt）の整形（v3.221）。
import { describe, expect, it } from "vitest";
import { cleanTranscript } from "../transcriptClean";

const VTT = `WEBVTT

NOTE 会議の文字起こし

1
00:00:05.000 --> 00:00:09.500
<v 山田 太郎>今期の新規商談は、
先月から3件増えました。</v>

2
00:00:09.600 --> 00:00:12.000
<v 山田 太郎>来週、先方に提案します。</v>

3
00:01:15.000 --> 00:01:18.000
<v 佐藤 花子>了解です。見積は私が出します。</v>

4
01:02:03.000 --> 01:02:05.000
<v 山田 太郎>以上です。</v>
`;

describe("cleanTranscript", () => {
  it("vtt：ヘッダ・NOTE・キュー番号・時刻行が消え、話者が残り、連続行が1行にまとまる", () => {
    const out = cleanTranscript(VTT, "vtt");
    expect(out).not.toMatch(/WEBVTT|NOTE|-->|<v|<\/v>/);
    expect(out.split("\n")).toEqual([
      "[00:05] 山田 太郎：今期の新規商談は、先月から3件増えました。来週、先方に提案します。",
      "[01:15] 佐藤 花子：了解です。見積は私が出します。",
      "[62:03] 山田 太郎：以上です。",
    ]);
    expect(out.length).toBeLessThan(VTT.length / 2);
  });
  it("srt：番号・時刻行（カンマ区切り）が消え、本文が残る", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:03,000\r\nこんにちは。\r\n\r\n2\r\n00:00:03,500 --> 00:00:05,000\r\n始めます。\r\n";
    const out = cleanTranscript(srt, ".SRT");
    expect(out).toBe("[00:01] こんにちは。始めます。");
  });
  it("vtt・srt 以外はそのまま返す", () => {
    expect(cleanTranscript("00:00:01.000 --> 00:00:02.000\nabc", "txt")).toBe("00:00:01.000 --> 00:00:02.000\nabc");
  });
});
