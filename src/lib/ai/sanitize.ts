// src/lib/ai/sanitize.ts
//
// 【設計意図】
// AIに渡す前にコメント・テキストから機密情報を除去するサニタイズ関数。
// この関数を経由せずにコメントデータをAIに渡してはいけない（CLAUDE.md Section 6-4）。
//
// 除去対象：
//   - Windowsネットワークパス（\\server\share 形式）
//   - UNCパス（//server/share 形式）
//   - メールアドレス
//   - ローカルファイルパス（C:\... 形式）

/**
 * AIに渡すコメント文字列をサニタイズする。
 * 社内機密情報（ネットワークパス・メールアドレス等）を除去する。
 *
 * @example
 * sanitizeComment("\\\\server\\share\\file.xlsx を確認") // → "[ファイルパス省略] を確認"
 * sanitizeComment("tanaka@example.com に送付")          // → "[メールアドレス省略] に送付"
 */
export function sanitizeComment(comment: string): string {
  if (!comment) return "";

  return comment
    // Windowsネットワークパス（\\server\share 形式）
    .replace(/\\\\[^\s]*/g, "[ファイルパス省略]")
    // UNCパス（//server/path 形式）
    .replace(/\/\/[a-zA-Z0-9._-]+\/[^\s]*/g, "[ファイルパス省略]")
    // Windowsローカルパス（C:\... 形式）
    .replace(/[A-Za-z]:\\[^\s]*/g, "[ファイルパス省略]")
    // メールアドレス
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[メールアドレス省略]")
    .trim();
}

/**
 * 複数フィールドをまとめてサニタイズする。
 * タスクオブジェクトのcommentフィールド適用時に使用。
 */
export function sanitizeTaskComment<T extends { comment: string }>(task: T): T {
  return { ...task, comment: sanitizeComment(task.comment) };
}
