import { describe, it, expect } from "vitest";
import { extractEdgeError, readEdgeErrorPayload, buildInvokeErrorMessage } from "../edgeFunctionError";

// 本物のResponseに近い最小限のダック型モック（.text()のみ実装）
function mockResponse(opts: { status?: number; text?: () => Promise<string>; textThrows?: boolean }) {
  return {
    status: opts.status,
    text: async () => {
      if (opts.textThrows) throw new Error("body already read");
      return opts.text ? await opts.text() : "";
    },
  };
}

describe("extractEdgeError：JSON本文", () => {
  it("ANTHROPIC_ERRORはdetail内のmessageとステータスを含める", () => {
    const msg = extractEdgeError({
      body: { error: "ANTHROPIC_ERROR", status: 400, detail: JSON.stringify({ error: { message: "invalid request" } }) },
      fallback: "fallback",
    });
    expect(msg).toContain("Anthropic APIエラー (400)");
    expect(msg).toContain("invalid request");
  });

  it("RATE_LIMIT_EXCEEDEDはmessageをそのまま使う", () => {
    const msg = extractEdgeError({
      body: { error: "RATE_LIMIT_EXCEEDED", message: "1分あたりの利用上限に達しました。しばらくお待ちください。" },
      fallback: "fallback",
    });
    expect(msg).toBe("1分あたりの利用上限に達しました。しばらくお待ちください。");
  });

  it("RATE_LIMIT_EXCEEDEDでmessageが無ければフォールバック文言", () => {
    const msg = extractEdgeError({ body: { error: "RATE_LIMIT_EXCEEDED" }, fallback: "fallback" });
    expect(msg).toContain("しばらくお待ちください");
  });

  it("GUEST_DAILY_LIMIT_EXCEEDEDはmessageを使う", () => {
    const msg = extractEdgeError({
      body: { error: "GUEST_DAILY_LIMIT_EXCEEDED", message: "サンプルでのAI利用は1日3回までです。" },
      fallback: "fallback",
    });
    expect(msg).toBe("サンプルでのAI利用は1日3回までです。");
  });

  it("GUEST_GLOBAL_LIMIT_EXCEEDEDはmessageを使う", () => {
    const msg = extractEdgeError({
      body: { error: "GUEST_GLOBAL_LIMIT_EXCEEDED", message: "本日のサンプルAI利用枠が上限に達しました。" },
      fallback: "fallback",
    });
    expect(msg).toBe("本日のサンプルAI利用枠が上限に達しました。");
  });

  it("GUEST_QUOTA_UNAVAILABLEはmessage無しでもフォールバック文言を出す", () => {
    const msg = extractEdgeError({ body: { error: "GUEST_QUOTA_UNAVAILABLE" }, fallback: "fallback" });
    expect(msg).toContain("サンプルのAI利用を確認できませんでした");
  });

  it("未知のerror値はその文字列をそのまま返す（汎用文言に落とさない）", () => {
    const msg = extractEdgeError({ body: { error: "SOME_NEW_EDGE_ERROR" }, fallback: "fallback" });
    expect(msg).toContain("SOME_NEW_EDGE_ERROR");
    expect(msg).not.toBe("fallback");
  });

  it("未知のerror値でもHTTPステータスが分かれば含める", () => {
    const msg = extractEdgeError({ body: { error: "SOME_NEW_EDGE_ERROR" }, fallback: "fallback", status: 500 });
    expect(msg).toContain("SOME_NEW_EDGE_ERROR");
    expect(msg).toContain("(500)");
  });
});

describe("extractEdgeError：JSONでない本文・空の本文・ステータスのみ", () => {
  it("JSONでない本文はステータス＋生テキストの断片を出す（汎用文言だけで終わらせない）", () => {
    const msg = extractEdgeError({
      body: null,
      fallback: "Edge Function returned a non-2xx status code",
      status: 502,
      rawText: "<html>Bad Gateway</html>",
    });
    expect(msg).toContain("(502)");
    expect(msg).toContain("Bad Gateway");
  });

  it("413はステータスを含む添付サイズの案内文になる", () => {
    const msg = extractEdgeError({
      body: null,
      fallback: "Edge Function returned a non-2xx status code",
      status: 413,
      rawText: "Payload Too Large",
    });
    expect(msg).toContain("(413)");
    expect(msg).toContain("添付ファイルが大きすぎます");
  });

  it("空の本文でもステータスだけは出す", () => {
    const msg = extractEdgeError({
      body: null,
      fallback: "Edge Function returned a non-2xx status code",
      status: 500,
      rawText: "",
    });
    expect(msg).toBe("Edge Function returned a non-2xx status code (500)");
  });

  it("ステータスも本文も無ければfallbackのみ", () => {
    const msg = extractEdgeError({ body: null, fallback: "fallback" });
    expect(msg).toBe("fallback");
  });

  it("長い生テキストは切り詰める", () => {
    const longText = "x".repeat(1000);
    const msg = extractEdgeError({ body: null, fallback: "fallback", status: 500, rawText: longText });
    expect(msg.length).toBeLessThan(400);
  });
});

describe("readEdgeErrorPayload", () => {
  it("JSON本文を読んでパースする", async () => {
    const res = mockResponse({ status: 429, text: async () => JSON.stringify({ error: "RATE_LIMIT_EXCEEDED", message: "待って" }) });
    const result = await readEdgeErrorPayload(res);
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "RATE_LIMIT_EXCEEDED", message: "待って" });
    expect(result.rawText).toContain("RATE_LIMIT_EXCEEDED");
  });

  it("JSONでない本文はbody=nullでrawTextだけ返す", async () => {
    const res = mockResponse({ status: 502, text: async () => "<html>Bad Gateway</html>" });
    const result = await readEdgeErrorPayload(res);
    expect(result.status).toBe(502);
    expect(result.body).toBeNull();
    expect(result.rawText).toBe("<html>Bad Gateway</html>");
  });

  it("空の本文はbody=null・rawText=''を返す", async () => {
    const res = mockResponse({ status: 500, text: async () => "" });
    const result = await readEdgeErrorPayload(res);
    expect(result.status).toBe(500);
    expect(result.body).toBeNull();
    expect(result.rawText).toBe("");
  });

  it("本文読み取り自体が失敗しても例外を投げずステータスだけ返す", async () => {
    const res = mockResponse({ status: 502, textThrows: true });
    const result = await readEdgeErrorPayload(res);
    expect(result.status).toBe(502);
    expect(result.body).toBeNull();
    expect(result.rawText).toBeUndefined();
  });

  it("Response互換でないオブジェクト（text関数を持たない）でも例外を投げない", async () => {
    const result = await readEdgeErrorPayload({ status: 500 });
    expect(result.body).toBeNull();
  });

  it("responseがnull/undefinedでも例外を投げない", async () => {
    expect(await readEdgeErrorPayload(null)).toEqual({ body: null });
    expect(await readEdgeErrorPayload(undefined)).toEqual({ body: null });
  });
});

describe("buildInvokeErrorMessage：dataとresponseの優先順位", () => {
  it("dataがある場合はresponseを読まずdataから組み立てる（既存テストの後方互換）", async () => {
    const msg = await buildInvokeErrorMessage(
      { error: "GUEST_DAILY_LIMIT_EXCEEDED", message: "サンプルでのAI利用は1日3回までです。" },
      { message: "Edge Function returned a non-2xx status code" },
      undefined,
    );
    expect(msg).toBe("サンプルでのAI利用は1日3回までです。");
  });

  it("dataがnullのときはresponseの本文を読む（実際のsupabase-js非2xx挙動）", async () => {
    const res = mockResponse({ status: 502, text: async () => JSON.stringify({ error: "ANTHROPIC_ERROR", status: 529, detail: JSON.stringify({ error: { message: "overloaded" } }) }) });
    const msg = await buildInvokeErrorMessage(null, { message: "Edge Function returned a non-2xx status code" }, res);
    expect(msg).toContain("Anthropic APIエラー (529)");
    expect(msg).toContain("overloaded");
  });

  it("dataがnull・responseもJSONでないときはステータス＋生テキストで案内する", async () => {
    const res = mockResponse({ status: 502, text: async () => "upstream connect error" });
    const msg = await buildInvokeErrorMessage(null, { message: "Edge Function returned a non-2xx status code" }, res);
    expect(msg).toContain("(502)");
    expect(msg).toContain("upstream connect error");
  });

  it("errorが無い/messageが無いときも例外を投げず既定のフォールバックになる", async () => {
    const msg = await buildInvokeErrorMessage(null, null, undefined);
    expect(msg).toBe("AI呼び出しに失敗しました。");
  });
});
