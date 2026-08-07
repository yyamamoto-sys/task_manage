// src/lib/supabase/__tests__/client.test.ts
//
// 【設計意図】
// 2026-08-06のゲスト（サンプル閲覧）モード再設計の再発防止テスト。旧実装は
// from(table) の insert/update/upsert/delete だけをブロックし、select（読み取り）・
// rpc・functions.invoke・storage は素通りしていた（実部署データの漏洩経路）。
// ここでは実際に supabase（Proxy）を経由して、ゲストモード時に全経路がネットワークへ
// 一切届かずブロックされることを検証する。
//
// 2026-08-07（v3.29・Phase 3）：ゲストにAI機能を限定開放したため、
// functions.invoke("ai-consult") だけが例外的に実クライアントへ通るようになった。
// 「例外はai-consultだけ」であることは isGuestInvokeBlocked() を直接呼んで検証する
// （実際にfetchする実クライアントを経由すると、テスト環境の.env.local設定次第で
// 本物のSupabaseプロジェクトへネットワークが飛んでしまうため、ここでは避ける）。

import { describe, it, expect, afterEach } from "vitest";
import { supabase, isGuestInvokeBlocked } from "../client";
import { setGuestMode, isGuestMode } from "../../guestMode";

describe("ゲストモード時のSupabase遮断（choke point：assertGuestBlocked）", () => {
  afterEach(() => setGuestMode(false));

  it("from().select() はゲストモードだとdata:null/errorを返す（実クライアントに届かない）", async () => {
    setGuestMode(true);
    const { data, error } = await supabase.from("tasks").select("*");
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("from().insert() もブロックされる", async () => {
    setGuestMode(true);
    const { data, error } = await supabase.from("tasks").insert({ name: "x" });
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("from().select().eq().single() のようなチェーンでもブロックされたままである", async () => {
    setGuestMode(true);
    const { data, error } = await supabase.from("tasks").select("*").eq("id", "1").single();
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("rpc() はブロックされる", async () => {
    setGuestMode(true);
    const { data, error } = await supabase.rpc("is_system_bootstrapped");
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("functions.invoke() は ai-consult 以外の関数名ならブロックされる", async () => {
    setGuestMode(true);
    const { data, error } = await supabase.functions.invoke("some-other-function", { body: {} });
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("storage.from().download() はブロックされる", async () => {
    setGuestMode(true);
    const { data, error } = await supabase.storage.from("admin-templates").download("x.zip");
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  it("ゲストモードでなければ from() は実クライアントのビルダーを返す（差し替えられていない）", () => {
    expect(isGuestMode()).toBe(false);
    const builder = supabase.from("tasks");
    // 実クライアントのquery builderはthenableだがブロック用ダミーとは別オブジェクト。
    // ネットワークを叩くメソッド（select等）は呼ばず、存在確認のみに留める。
    expect(builder).toBeTruthy();
    expect(typeof (builder as { select?: unknown }).select).toBe("function");
  });
});

describe("isGuestInvokeBlocked：functions.invoke の例外は ai-consult だけ（Phase 3・v3.29）", () => {
  afterEach(() => setGuestMode(false));

  it("ゲストモードなら ai-consult は通す（=ブロックしない）", () => {
    setGuestMode(true);
    expect(isGuestInvokeBlocked("ai-consult")).toBe(false);
  });

  it("ゲストモードなら ai-consult 以外はブロックする", () => {
    setGuestMode(true);
    expect(isGuestInvokeBlocked("notify-deadlines")).toBe(true);
    expect(isGuestInvokeBlocked("some-future-function")).toBe(true);
  });

  it("ゲストモードでなければ何もブロックしない（ai-consultも他の関数名も）", () => {
    expect(isGuestMode()).toBe(false);
    expect(isGuestInvokeBlocked("ai-consult")).toBe(false);
    expect(isGuestInvokeBlocked("notify-deadlines")).toBe(false);
  });
});
