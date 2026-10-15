// src/lib/feedback/__tests__/copyText.test.ts
//
// v3.157：管理ページの「Claude 用にコピー」の文面。
//  ① 送信者の ID・名前・メール・管理者メモを載せない（入力に紛れ込んでも出力に出ない）
//  ② 本文はコードブロック（柵は中身の最長のバッククォート列+1）。メール・トークンはコピー前にも伏せる
//  ③ スナップショットは「人が読む形」と JSON の両方。無いときは理由を書く

import { describe, expect, it } from "vitest";
import { buildFeedbackCopyText, type FeedbackCopyInput } from "../copyText";
import { buildFeedbackSnapshot } from "../snapshot";

const NOW = Date.parse("2026-10-15T01:00:00.000Z");

function snap() {
  return buildFeedbackSnapshot({
    now: NOW, screen: "list", route: "/", appVersion: "3.157",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36",
    viewport: { w: 1280, h: 720 }, display: null, dpr: 1,
    context: { mode: "plan", view: "list", isMobile: false },
    clicks: [{ tag: "button", role: null, tour: null, at: NOW - 2000, x: 10, y: 20, vw: 1280, vh: 720 }],
  });
}

function item(over: Partial<FeedbackCopyInput> = {}): FeedbackCopyInput {
  return {
    id: 1, kind: "bug", comment: "リストで担当者を変えられません。", screen: "list", route: "/", app_version: "3.157",
    status: "new", created_at: "2026-10-15T00:30:00.000Z", snapshot: snap(), snapshot_state: "attached", ...over,
  };
}

const OPTS = { now: new Date("2026-10-15T01:05:00.000Z"), appVersion: "3.157" };

describe("buildFeedbackCopyText", () => {
  it("依頼文・件数・コピー日時（JST）・本文・人が読む形・JSON が入る", () => {
    const text = buildFeedbackCopyText([item()], OPTS);
    expect(text).toContain("利用者のご意見 1件");
    expect(text).toContain("2026-10-15 10:05 JST");
    expect(text).toContain("再現手順と改修案を提案してください");
    expect(text).toContain("Claude 以外へ共有しないでください");
    expect(text).toContain("## 1. リストで担当者を変えられません。");
    expect(text).toContain("種類：不具合／状態：新規／受信：2026-10-15 09:30 JST");
    expect(text).toContain("### 画面の状況（人が読む形）");
    expect(text).toContain("- ウィンドウ：1280×720");
    expect(text).toContain("### 画面の状況（JSON）");
    expect(text).toContain('"v": 1');
  });

  it("🔴 送信者・管理者メモは載せない（入力に紛れ込んでも出力に出ない）", () => {
    const polluted = {
      ...item(), member_id: "m-secret-id", member_name: "山本 勇気", email: "yamamoto@amita-net.co.jp", admin_memo: "社内メモ：対応しない方針",
    } as unknown as FeedbackCopyInput;
    const text = buildFeedbackCopyText([polluted], OPTS);
    expect(text).not.toContain("m-secret-id");
    expect(text).not.toContain("山本 勇気");
    expect(text).not.toContain("amita-net.co.jp");
    expect(text).not.toContain("社内メモ");
    expect(text).not.toContain("member_id");
  });

  it("本文のコードブロックの柵は、中身の最長のバッククォート列より長い", () => {
    const text = buildFeedbackCopyText([item({ comment: "手順:\n```\nnpm run dev\n```\nで直りません", snapshot: null, snapshot_state: "off" })], OPTS);
    expect(text).toContain("````text\n手順:");
    expect(text).toContain("で直りません\n````");
  });

  it("本文中のメールアドレス・トークンはコピー前にも伏せる", () => {
    const text = buildFeedbackCopyText([item({ comment: "taro@example.co.jp に届きます。Bearer abcdef.ghijkl.mnopqr", snapshot: null, snapshot_state: "off" })], OPTS);
    expect(text).not.toContain("taro@example.co.jp");
    expect(text).toContain("[email]");
    expect(text).not.toContain("abcdef.ghijkl.mnopqr");
  });

  it("スナップショットが無いときは理由（本人がオフ／大きすぎ／90日で消えた）を書く", () => {
    expect(buildFeedbackCopyText([item({ snapshot: null, snapshot_state: "off" })], OPTS)).toContain("本人が付けませんでした");
    expect(buildFeedbackCopyText([item({ snapshot: null, snapshot_state: "too_large" })], OPTS)).toContain("大きすぎて付けられませんでした");
    expect(buildFeedbackCopyText([item({ snapshot: null, snapshot_state: "purged" })], OPTS)).toContain("90日");
  });

  it("複数件は通し番号で並ぶ", () => {
    const text = buildFeedbackCopyText([item({ id: 1, comment: "一つ目" }), item({ id: 2, comment: "二つ目", kind: "request" })], OPTS);
    expect(text).toContain("## 1. 一つ目");
    expect(text).toContain("## 2. 二つ目");
    expect(text).toContain("種類：要望");
  });
});
