// supabase/functions/_shared/webPushCore.ts
//
// Web Push の送信結果の扱い（純粋関数）。webPush.ts（npm:web-push を使う側）と
// vitest（src/lib/reminder/__tests__）の両方から import する。

export type PushOutcome =
  | { kind: "ok"; status: number }
  | { kind: "gone"; status: number }
  | { kind: "failed"; status: number | null; reason: string };

/**
 * 201/200/202 は成功、410/404 は購読が失効している（行を消す）、それ以外は失敗（行は残す）。
 * 429・5xx・例外は一時的な失敗かもしれないため消さない（設計書 §7.3）。
 */
export function classifyPushStatus(status: number | null | undefined, reason = ""): PushOutcome {
  if (status === 200 || status === 201 || status === 202) return { kind: "ok", status };
  if (status === 404 || status === 410) return { kind: "gone", status };
  return { kind: "failed", status: typeof status === "number" ? status : null, reason };
}

/** 失敗の要約（ステータス別件数）。本文・endpoint は載せない */
export function summarizeFailures(outcomes: PushOutcome[]): string | null {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    if (o.kind !== "failed") continue;
    const key = o.status === null ? "例外" : String(o.status);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k}:${n}件`)
    .join(" / ");
}
