// src/lib/feedback/__tests__/limit.test.ts
//
// v3.157：ご意見の頻度上限（1時間3件・24時間10件・同一本文の1分以内の再送は黙って1件にまとめる）。
// 本番の判定は DB の submit_feedback（アドバイザリロック付き）。ここは判定手順の参照実装の境界値と、
// RPC の戻り値 → 利用者向け文言の対応表の検査（SQL の定数との一致は feedbackMigration.test.ts）。

import { describe, expect, it } from "vitest";
import {
  feedbackResultMessageKey, isFeedbackAccepted, judgeFeedbackSend, parseSubmitResult, type FeedbackSendRecord,
} from "../limit";
import { isFeedbackNotAppliedError } from "../errors";
import { layoutJa } from "../../../i18n/layout.ja";
import { layoutEn } from "../../../i18n/layout.en";

const NOW = Date.parse("2026-10-15T03:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const rec = (agoMs: number, comment = "別の内容"): FeedbackSendRecord => ({ at: NOW - agoMs, comment });

describe("judgeFeedbackSend：判定の手順（SQL と同じ境界）", () => {
  it("履歴なしは ok", () => {
    expect(judgeFeedbackSend([], "こんにちは", NOW)).toBe("ok");
  });

  it("同一本文が1分以内なら throttled（黙って1件にまとめる）。ちょうど1分前は数えない", () => {
    expect(judgeFeedbackSend([rec(30 * 1000, "同じ")], "同じ", NOW)).toBe("throttled");
    expect(judgeFeedbackSend([rec(MIN - 1, "同じ")], "同じ", NOW)).toBe("throttled");
    expect(judgeFeedbackSend([rec(MIN, "同じ")], "同じ", NOW)).toBe("ok");
    expect(judgeFeedbackSend([rec(30 * 1000, "違う")], "同じ", NOW)).toBe("ok");
  });

  it("1時間に3件まで：3件目の送信は ok、4件目から limited_hour。ちょうど1時間前は数えない", () => {
    expect(judgeFeedbackSend([rec(10 * MIN), rec(20 * MIN)], "新しい", NOW)).toBe("ok");
    expect(judgeFeedbackSend([rec(10 * MIN), rec(20 * MIN), rec(30 * MIN)], "新しい", NOW)).toBe("limited_hour");
    expect(judgeFeedbackSend([rec(10 * MIN), rec(20 * MIN), rec(HOUR)], "新しい", NOW)).toBe("ok");
  });

  it("24時間に10件まで：10件あれば limited_day（1時間の枠は空いていても）。ちょうど24時間前は数えない", () => {
    const ten = Array.from({ length: 10 }, (_, i) => rec((2 + i) * HOUR));
    expect(judgeFeedbackSend(ten, "新しい", NOW)).toBe("limited_day");
    expect(judgeFeedbackSend(ten.slice(0, 9), "新しい", NOW)).toBe("ok");
    const withOld = [...ten.slice(0, 9), rec(24 * HOUR)];
    expect(judgeFeedbackSend(withOld, "新しい", NOW)).toBe("ok");
  });

  it("重複の判定は件数の判定より先（二重クリックで上限の文言を出さない）", () => {
    const three = [rec(10 * 1000, "同じ"), rec(20 * MIN), rec(30 * MIN)];
    expect(judgeFeedbackSend(three, "同じ", NOW)).toBe("throttled");
  });

  it("1時間と24時間の両方に当たるときは limited_hour（短い方の理由を先に伝える）", () => {
    const many = Array.from({ length: 10 }, (_, i) => rec((i + 1) * MIN));
    expect(judgeFeedbackSend(many, "新しい", NOW)).toBe("limited_hour");
  });
});

describe("RPC の戻り値 → 利用者向けの扱い", () => {
  it("ok と throttled は成功として扱う。limited_* は失敗（理由の文言キーがある）", () => {
    expect(isFeedbackAccepted("ok")).toBe(true);
    expect(isFeedbackAccepted("throttled")).toBe(true);
    expect(isFeedbackAccepted("limited_hour")).toBe(false);
    expect(isFeedbackAccepted("limited_day")).toBe(false);
    expect(feedbackResultMessageKey("ok")).toBeNull();
    expect(feedbackResultMessageKey("throttled")).toBeNull();
    for (const r of ["limited_hour", "limited_day"] as const) {
      const key = feedbackResultMessageKey(r) as string;
      expect(key).toBeTruthy();
      expect(layoutJa).toHaveProperty([key]);
      expect(layoutEn).toHaveProperty([key]);
    }
  });

  it("想定外の戻り値は ok 扱いにしない方向でなく、既知の4値だけを解釈する", () => {
    expect(parseSubmitResult("throttled")).toBe("throttled");
    expect(parseSubmitResult("limited_hour")).toBe("limited_hour");
    expect(parseSubmitResult("limited_day")).toBe("limited_day");
    expect(parseSubmitResult("ok")).toBe("ok");
    expect(parseSubmitResult(null)).toBe("ok");
  });
});

describe("isFeedbackNotAppliedError：表・RPC が無い（未適用）の判定", () => {
  it("表・関数が無いエラーで、メッセージに feedback が入るものだけ true", () => {
    expect(isFeedbackNotAppliedError({ code: "42P01", message: 'relation "public.app_feedback" does not exist' })).toBe(true);
    expect(isFeedbackNotAppliedError({ code: "PGRST205", message: "Could not find the table 'public.app_feedback' in the schema cache" })).toBe(true);
    expect(isFeedbackNotAppliedError({ code: "PGRST202", message: "Could not find the function public.submit_feedback(...) in the schema cache" })).toBe(true);
    expect(isFeedbackNotAppliedError({ code: "42883", message: "function public.list_my_feedback() does not exist" })).toBe(true);
  });
  it("他の表の欠落・他のエラーは false（誤って「適用がまだ」と言わない）", () => {
    expect(isFeedbackNotAppliedError({ code: "42P01", message: 'relation "public.project_sections" does not exist' })).toBe(false);
    expect(isFeedbackNotAppliedError({ code: "42501", message: "permission denied for table app_feedback" })).toBe(false);
    expect(isFeedbackNotAppliedError(new Error("network"))).toBe(false);
    expect(isFeedbackNotAppliedError(null)).toBe(false);
  });
});
