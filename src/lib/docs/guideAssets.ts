// src/lib/docs/guideAssets.ts
//
// docs/guides/**/*.svg を生文字列で取り込む（<img> ではテーマの CSS 変数が効かないため、
// インライン SVG として描画する。サニタイズは guideMarkdown.sanitizeSvg）。

export const GUIDE_SVGS = import.meta.glob("/docs/guides/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
