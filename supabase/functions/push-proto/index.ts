// supabase/functions/push-proto/index.ts
//
// 【これは何か】
// docs/dev/web-push-reminder-design.md §8.2「ライブラリ選定」の dev 最小試作。
// npm:web-push と jsr:@negrel/webpush のどちらが Supabase Edge Functions（Deno）から
// 実際に Web Push を送れるか（import できるか・送信できるか）を確かめるためだけの関数。
// 🔴 プロトタイプ専用。dev 以外へは絶対にデプロイしない。DBへの書き込みは一切行わない。
//
// 【使い方】
//   GET  /push-proto?holidays=1
//     → 今日が祝日かどうかだけを返す（japanese-holidays を esm.sh 経由で読み込む）
//   POST /push-proto?lib=webpush   （body = PushSubscription の JSON）
//   POST /push-proto?lib=negrel    （body = PushSubscription の JSON）
//     → 指定したライブラリでテスト通知を1件送る
//   どちらのクエリも同時に指定可（POSTで ?lib=webpush&holidays=1 等）。
//
// 【認証】x-proto-secret ヘッダが Deno.env PUSH_PROTO_SECRET と一致すること（--no-verify-jwt
// で動かすため、Supabase側のJWT検証には頼らない。この簡易チェックだけが認証）。
//
// 【必要な Edge Function secrets（dev にのみ設定済み・値はここでは扱わない）】
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY … 生の base64url（npm:web-push 用・ブラウザの
//     applicationServerKey とも共通）
//   VAPID_PUBLIC_KEY_JWK / VAPID_PRIVATE_KEY_JWK … 同じ鍵ペアを JWK（JSON文字列）で持った
//     もの（jsr:@negrel/webpush の importVapidKeys() は JWK 形式を要求するため。
//     ExportedVapidKeys = { publicKey: JsonWebKey; privateKey: JsonWebKey }）
//   VAPID_SUBJECT … VAPID の連絡先URL（mailto: にしない。CLAUDE.md該当箇所参照）
//   PUSH_PROTO_SECRET … このFunction専用の簡易シークレット

const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:5173",
  "http://localhost:4173",
]);

function getCorsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-proto-secret",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===== 祝日判定（japanese-holidays を esm.sh 経由。design書§7.3と同じ手法） =====
async function checkHoliday(): Promise<Record<string, unknown>> {
  try {
    const mod: any = await import("https://esm.sh/japanese-holidays@1");
    const isHolidayFn = mod?.isHoliday ?? mod?.default?.isHoliday;
    if (typeof isHolidayFn !== "function") {
      return {
        ok: false,
        stage: "api-shape",
        error: `isHoliday関数が見つかりません。exportsは: ${Object.keys(mod ?? {}).join(",")}`,
      };
    }
    const now = new Date();
    const result = isHolidayFn(now, true);
    return {
      ok: true,
      today: now.toISOString().slice(0, 10),
      isHoliday: result != null,
      holidayName: result ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      stage: "import-or-call",
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
}

// ===== lib=webpush（npm:web-push） =====
async function sendViaWebPush(subscription: unknown, payloadText: string): Promise<Record<string, unknown>> {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "https://example.invalid";
  if (!publicKey || !privateKey) {
    return { ok: false, stage: "config", error: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY が未設定です" };
  }

  let webpush: any;
  try {
    webpush = (await import("npm:web-push@^3.6.6")).default;
  } catch (e) {
    return {
      ok: false,
      stage: "import",
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const result = await webpush.sendNotification(subscription, payloadText);
    return { ok: true, stage: "send", statusCode: result?.statusCode ?? null };
  } catch (e: any) {
    return {
      ok: false,
      stage: "send",
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      statusCode: e?.statusCode ?? null,
      body: typeof e?.body === "string" ? e.body.slice(0, 500) : null,
    };
  }
}

// ===== lib=negrel（jsr:@negrel/webpush） =====
async function sendViaNegrel(subscription: unknown, payloadText: string): Promise<Record<string, unknown>> {
  const publicKeyJwkRaw = Deno.env.get("VAPID_PUBLIC_KEY_JWK");
  const privateKeyJwkRaw = Deno.env.get("VAPID_PRIVATE_KEY_JWK");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "https://example.invalid";
  if (!publicKeyJwkRaw || !privateKeyJwkRaw) {
    return { ok: false, stage: "config", error: "VAPID_PUBLIC_KEY_JWK / VAPID_PRIVATE_KEY_JWK が未設定です" };
  }

  let webpush: any;
  try {
    webpush = await import("jsr:@negrel/webpush@^0.5.0");
  } catch (e) {
    return {
      ok: false,
      stage: "import",
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }

  try {
    const publicKey = JSON.parse(publicKeyJwkRaw);
    const privateKey = JSON.parse(privateKeyJwkRaw);
    const vapidKeys = await webpush.importVapidKeys({ publicKey, privateKey }, { extractable: false });
    const appServer = await webpush.ApplicationServer.new({
      contactInformation: subject.startsWith("mailto:") ? subject : `mailto:noreply@example.invalid`,
      vapidKeys,
    });
    const subscriber = appServer.subscribe(subscription);
    await subscriber.pushTextMessage(payloadText, {});
    return { ok: true, stage: "send" };
  } catch (e: any) {
    const resp: Response | undefined = e?.response;
    let bodyText: string | null = null;
    if (resp) {
      try {
        bodyText = (await resp.text()).slice(0, 500);
      } catch {
        bodyText = null;
      }
    }
    return {
      ok: false,
      stage: "send",
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      statusCode: resp?.status ?? null,
      body: bodyText,
    };
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const expectedSecret = Deno.env.get("PUSH_PROTO_SECRET");
  const gotSecret = req.headers.get("x-proto-secret");
  if (!expectedSecret || gotSecret !== expectedSecret) {
    return json({ error: "Unauthorized: x-proto-secret が一致しません" }, 401, corsHeaders);
  }

  const url = new URL(req.url);
  const lib = url.searchParams.get("lib");
  const wantHolidays = url.searchParams.get("holidays") === "1";

  const out: Record<string, unknown> = {};

  if (wantHolidays) {
    out.holidays = await checkHoliday();
  }

  if (lib) {
    if (lib !== "webpush" && lib !== "negrel") {
      return json({ error: `lib は "webpush" か "negrel" のみ対応（受け取った値: ${lib}）` }, 400, corsHeaders);
    }
    if (req.method !== "POST") {
      return json({ error: "lib指定時はPOSTでPushSubscription JSONを送ってください" }, 400, corsHeaders);
    }

    let subscription: unknown;
    try {
      subscription = await req.json();
    } catch (e) {
      return json({ error: `リクエストボディのJSON解析に失敗: ${e instanceof Error ? e.message : String(e)}` }, 400, corsHeaders);
    }

    const payloadText = JSON.stringify({
      title: `テスト通知（${lib}）`,
      body: `push-proto から ${lib} 経由で送信しました（${new Date().toISOString()}）`,
      url: "/",
      tag: "push-proto-test",
    });

    out.push = lib === "webpush"
      ? await sendViaWebPush(subscription, payloadText)
      : await sendViaNegrel(subscription, payloadText);
    out.lib = lib;
  }

  if (!wantHolidays && !lib) {
    return json({
      error: "何もしていません。?holidays=1 または ?lib=webpush|negrel（POST）を指定してください",
    }, 400, corsHeaders);
  }

  return json(out, 200, corsHeaders);
});
