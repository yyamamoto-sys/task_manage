// src/lib/errorMessage.ts
// エラーオブジェクトからメッセージ文字列を安全に取り出すユーティリティ。

/** unknown 型のエラーから人が読めるメッセージを返す */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e != null && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.details === "string") return obj.details;
  }
  return String(e);
}
