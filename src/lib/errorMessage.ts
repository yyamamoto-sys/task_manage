// src/lib/errorMessage.ts
// エラーオブジェクトからメッセージ文字列を安全に取り出すユーティリティ。
//
// 【グランドルール（CLAUDE.md Section 15）】
// ユーザーに見せるエラーは「何が起きたか」が分かるようにエラーコード・詳細
// を必ず含める。`formatErrorForUser()` を経由して表示すること。
// `getErrorMessage()` はメッセージだけが欲しい内部用途で使う。

/** unknown 型のエラーから人が読めるメッセージを返す（内部用途） */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e != null && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.details === "string") return obj.details;
  }
  return String(e);
}

/**
 * ユーザー向けにエラーをフォーマットする。
 * Supabase の PostgrestError（code/details/hint）を含めて
 * 「何が起きたか」「次に何をすればよいか」が判別できる文字列を返す。
 *
 * 表示例：
 *   "保存に失敗しました [42703] column "summary" does not exist"
 *   "保存に失敗しました [23514] new row violates check constraint ..."
 */
export function formatErrorForUser(prefix: string, e: unknown): string {
  const parts: string[] = [];
  if (prefix) parts.push(prefix);

  let code: string | undefined;
  let message: string | undefined;
  let details: string | undefined;
  let hint: string | undefined;

  if (e instanceof Error) {
    message = e.message;
    // Supabase の PostgrestError は Error を継承して code/details/hint を持つ
    const obj = e as unknown as Record<string, unknown>;
    if (typeof obj.code === "string") code = obj.code;
    if (typeof obj.details === "string") details = obj.details;
    if (typeof obj.hint === "string") hint = obj.hint;
  } else if (e != null && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.code === "string") code = obj.code;
    if (typeof obj.message === "string") message = obj.message;
    if (typeof obj.details === "string") details = obj.details;
    if (typeof obj.hint === "string") hint = obj.hint;
  } else {
    message = String(e);
  }

  if (code) parts.push(`[${code}]`);
  if (message) parts.push(message);
  if (details && details !== message) parts.push(`(${details})`);
  if (hint) parts.push(`ヒント: ${hint}`);

  return parts.join(" ");
}
