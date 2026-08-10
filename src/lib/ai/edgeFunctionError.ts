// src/lib/ai/edgeFunctionError.ts
//
// 【設計意図】
// supabase.functions.invoke("ai-consult") が非2xxを返したとき、Edge Function が
// レスポンス本文（{ error, message, detail, status }）に詰めた「実際の原因」を
// ユーザーに見せるための共通ロジック。invokeAI.ts と apiClient.ts の両方から使う
// （CLAUDE.md Section 15：エラーは「何が起きたか」が判別できる粒度で見せる）。
//
// 【背景（2026-08-10発覚のバグ）】
// supabase-js の functions.invoke() は非2xx時に data を null にし、Edge Function が
// 返したレスポンス本文は invoke() の戻り値の response（Response オブジェクト。
// FunctionsHttpError.context と同じもの）にしか入らない。data だけを見て組み立てる
// コードは、ANTHROPIC_ERROR / RATE_LIMIT_EXCEEDED 等の丁寧な分岐に一切到達できず、
// 常に汎用フォールバック文言に落ちる（今回まさにこれで原因が数日見えなくなった）。
// 同じ轍を踏まないよう、data が無いときは必ず response の本文を読みに行くこと。

export type EdgeErrorBody = {
  error?: string;
  status?: number;
  detail?: string;
  message?: string;
};

/** レスポンス本文の読み取り結果。JSONとして読めなくても rawText に生テキストを残す */
export interface EdgeErrorPayload {
  status?: number;
  body: EdgeErrorBody | null;
  rawText?: string;
}

/** ユーザーに見せる生テキストの断片は長すぎないよう切り詰める */
const RAW_TEXT_SNIPPET_LEN = 300;

/**
 * FunctionsHttpError/FunctionsRelayError の response（Response 互換オブジェクト）から
 * 本文を読み取る。
 *
 * 【body読み取りは1回だけ】Response.json() は内部で text() を呼んでから JSON.parse する
 * ため、json() が非JSONで失敗した後に text() を呼び直すと「body already read」で
 * 例外になる。そのため text() を1回だけ呼び、読めたテキストに対して JSON.parse を試す
 * 方式にしている（json()→失敗したらtext()、という素朴な二段read方式は実際には
 * 二重読み取りエラーを起こすため採用していない）。
 *
 * response が Response 互換でない（text 関数を持たない）場合や、text() 自体が
 * 失敗する場合（既に読み取り済み等）も例外を投げず、分かっている範囲の情報だけを返す。
 */
export async function readEdgeErrorPayload(response: unknown): Promise<EdgeErrorPayload> {
  if (!response || typeof (response as { text?: unknown }).text !== "function") {
    return { body: null };
  }
  const res = response as { status?: number; text: () => Promise<string> };
  const status = typeof res.status === "number" ? res.status : undefined;

  let rawText: string | undefined;
  try {
    rawText = await res.text();
  } catch {
    // 既に読み取り済み・ネットワーク切断等。ステータスだけは分かっているので残す。
    return { status, body: null };
  }

  let body: EdgeErrorBody | null = null;
  if (rawText) {
    try {
      body = JSON.parse(rawText) as EdgeErrorBody;
    } catch {
      body = null; // JSONでない本文（HTMLエラーページ・プレーンテキスト等）
    }
  }
  return { status, body, rawText };
}

/**
 * EdgeErrorBody（JSONで読めた場合）・HTTPステータス・生テキストから、ユーザー向けの
 * エラーメッセージを組み立てる（純粋関数。I/Oを持たないためテスト容易）。
 *
 * 「汎用文言だけで終わらせない」（CLAUDE.md Section 15）方針のため、body が
 * null（非JSON・空）でも、少なくともステータスコードと生テキストの断片だけは
 * 必ずメッセージに含める。
 */
export function extractEdgeError(input: {
  body: EdgeErrorBody | null;
  fallback: string;
  status?: number;
  rawText?: string;
}): string {
  const { body: d, fallback, status, rawText } = input;
  const statusSuffix = status ? ` (${status})` : "";

  if (d?.error === "ANTHROPIC_ERROR") {
    let msg = d.detail ?? "";
    try { msg = JSON.parse(d.detail ?? "")?.error?.message ?? d.detail ?? ""; } catch { /* ignore */ }
    // d.status は Anthropic 自身が返したステータス（Edge Function が転記したもの）。
    // 無ければ Edge Function自体のHTTPステータス（statusSuffix）にフォールバックする。
    const anthropicStatusSuffix = d.status ? ` (${d.status})` : statusSuffix;
    return `Anthropic APIエラー${anthropicStatusSuffix}: ${msg}`;
  }
  // Edge Function 側のユーザーごとのレート制限（apiClient.ts と同じ扱い。CLAUDE.md Section 18）
  if (d?.error === "RATE_LIMIT_EXCEEDED") {
    return d.message ?? "1分あたりの利用上限に達しました。しばらくお待ちください。";
  }
  // ゲスト（サンプル閲覧）のAI利用回数制限（Phase 3・CLAUDE.md Section 23）。
  // 個人（ブラウザ）別上限と全体（コストの天井）上限を区別して案内する。
  if (d?.error === "GUEST_DAILY_LIMIT_EXCEEDED" || d?.error === "GUEST_GLOBAL_LIMIT_EXCEEDED") {
    return d.message ?? fallback;
  }
  if (d?.error === "GUEST_QUOTA_UNAVAILABLE") {
    return d.message ?? "サンプルのAI利用を確認できませんでした。しばらくしてから再度お試しください。";
  }
  if (d?.error === "API key not configured") return "Edge FunctionにAPIキーが設定されていません。Supabaseの環境変数を確認してください。";
  if (d?.error === "Unauthorized") return "認証エラー：ログインし直してください。";
  if (d?.error) return `${d.error}${statusSuffix}`;

  // ここまでで「JSON本文はあったが既知の error 値に一致しない／error フィールド自体が無い」
  // ケースも含めて拾えなかった場合の続き。添付ファイルが大きすぎてゲートウェイ等が
  // 弾いたときは413（または準ずるステータス）でJSONでない本文が返ることが多い。
  if (status === 413) {
    return `添付ファイルが大きすぎます${statusSuffix}。ページ数を絞るか、テキストを貼り付けてお試しください。`;
  }

  if (rawText && rawText.trim()) {
    const snippet = rawText.trim().slice(0, RAW_TEXT_SNIPPET_LEN);
    return `${fallback}${statusSuffix}: ${snippet}`;
  }

  if (statusSuffix) {
    return `${fallback}${statusSuffix}`;
  }

  return fallback;
}

/**
 * invokeAI.ts / apiClient.ts から呼ぶ結合ヘルパー。
 * data が既にある（＝呼び出し元がテスト等で直接本文を渡した後方互換ケース）ときは
 * それを body として使い、無いときだけ response の本文を実際に読みに行く
 * （supabase-js の実挙動では非2xx時に data は常に null。response から読むのが本経路）。
 */
export async function buildInvokeErrorMessage(
  data: unknown,
  error: { message?: string } | null | undefined,
  response: unknown,
): Promise<string> {
  const fallback = error?.message ?? "AI呼び出しに失敗しました。";
  if (data) {
    return extractEdgeError({ body: data as EdgeErrorBody, fallback });
  }
  const { status, body, rawText } = await readEdgeErrorPayload(response);
  return extractEdgeError({ body, fallback, status, rawText });
}
