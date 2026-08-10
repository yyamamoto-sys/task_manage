// src/lib/docs/types.ts
//
// 【設計意図】
// docs/guides/**/*.md の frontmatter を表す型。詳細は docs/guides/_meta/conventions.md を参照。

export type DocAudience =
  | "all"
  | "member"
  | "kr-rep"
  | "facilitator"
  | "admin"
  | "maintainer";

export interface DocFrontmatter {
  title: string;
  audience: DocAudience[];
  /** アプリ側の `?` ボタンと紐づく一意キー（例: "okr.note"）。任意。 */
  mode?: string;
  /** 同階層内の並び順（小さいほど上）。任意。 */
  order?: number;
  /** ISO日付。 */
  last_updated: string;
  owner: string;
  /** 関連ページの mode キー配列。 */
  related?: string[];
  /** 旧仕様の場合 true（一覧には出るが「⚠ 旧仕様」タグが付く）。 */
  deprecated?: boolean;
  /**
   * true の場合、ガイドの目次・`?`ボタン（getDocByMode）・slug直参照（getDocBySlug）の
   * どこからも到達できなくなる（deprecated と違い、一覧に出ることすらない）。
   * ファイル自体は削除しない（2026-08-10・OKRモードのグループ側アーカイブで導入。
   * docs/guides/_meta/conventions.md Section 5参照）。
   */
  archived?: boolean;
}

export interface DocEntry extends DocFrontmatter {
  /** ファイル相対パス（docs/guides からの相対）。例: "02_modes/okr/01_meeting-note.md" */
  path: string;
  /** ナビ・ルーティング用 slug。path から `.md` を除いたもの。 */
  slug: string;
  /** frontmatter を除いた本文。 */
  body: string;
  /** ディレクトリ階層（path をスラッシュで分割した先頭〜末尾の手前）。 */
  section: string[];
}
