## 72. ガイドの表示部品・削除のUndo・メンション確定の共通化（v3.140・2026-10-13）

### ガイド専用のMarkdown表示（`GuideMarkdown`）
- `src/components/guide/GuideMarkdown.tsx`＋`src/lib/docs/guideMarkdown.ts`（パーサ）＋`guideAssets.ts`（SVG取り込み）。表・リンク・引用・SVG図解に対応。`MarkdownLite` は AI 返答用として据え置く（ガイドには使わない）。
- SVG は `docs/guides/**/*.svg` を `import.meta.glob` で取り込み、`sanitizeSvg` を通してから描画する（script・イベント属性・外部参照を除去）。記事の `![](相対パス.svg)` は `resolveImage` で解決する。
- 相対 `.md` リンクは `resolveLink`／`resolveRelative` で記事の slug に解決し、アプリ内遷移する（存在しない記事・外部URLは通常リンク扱い）。
- 図解の書き方は `docs/guides/conventions.md` 3.5。記事を足すときはここに従う。

### 削除のUndo
- タスク削除は `src/lib/task/deleteTaskWithUndo.ts` に集約。サイドパネルからの削除も「元に戻す」・Ctrl+Z が効く。削除経路を新設するときは必ずこれを呼ぶ。
- 機械チェック：`src/lib/task/__tests__/deleteRoutesUseUndo.test.ts`（削除経路が共通関数を経由しているか）。

### メンション確定
- `src/lib/mentions.ts` の `finalizedMentionsOf(comment)`（確定したメンション一覧）を `buildTaskUpdatePayload` に組み込み、サイドパネル（`MentionTextarea`）・新規登録でも通知が飛ぶ。新規作成から10分以内のタスクは通知ベースライン扱い。
- 機械チェック：`src/components/task/__tests__/finalizedMentionsAllPaths.test.ts`（全保存経路が確定関数を通る）。

### AIへ送るコメントのサニタイズ
- PJ単体のAI分析も `sanitizeComment` 経由。送信経路の網羅は `src/lib/ai/__tests__/sanitizeCoverage.test.ts`（新しいAI送信経路を足すとここが落ちる）。

### ガイドの資料をHTMLで保存・管理者向け記事の表示制御（v3.142）
- **`src/lib/docs/guideHtmlExport.ts` に集約**：`selectGuideSet`（収録記事の選択）・`buildGuideHtml`（文書全体）・`guideExportFileName`（`APP_VERSION` から組み立てる）・`downloadGuideHtml`（Blob をブラウザ内で作る。サーバー・`public/` には置かない）。HTML は `parseGuideMarkdown` の Block/Inline から純関数で組む（React は使わない）。システム構成のボタンは `isAdmin` のときだけ。
- **ライト配色は `LIGHT_THEME_VARS` の一か所**（ダウンロードした HTML では CSS 変数が未定義になるため値を直接持つ）。`globals.css` の最初の `:root` との一致と、図解 SVG が参照する `var(--color-*)` の網羅をテストが検査する。
- **`foo.md#見出し`**：HTML 保存では本文の見出しに id（`docAnchorId(slug)~見出しの断片`）を付けてそこへリンクする。`docAnchorId` は単射。iframe 内（Teams）ではダウンロードが塞がれることがあるため、保存ボタンの横に注記を出す（成否は検出できない）。
- **`src/lib/docs/guideAccess.ts`（閲覧可否の唯一の判定元）**：`canViewGuideDoc(doc, {isAdmin})`。audience が `admin`・`maintainer` だけの記事は管理者のみ、それ以外と未指定は全員。管理者判定は `isGuideAdmin(user)`（ゲスト除外）に一本化。適用先は目次・サイドバー・記事内リンク・内部遷移・関連チップ・？ボタン・HTML保存。？ボタン（`HelpButton`）は `appStore.guideViewerIsAdmin` を `MainLayout` が同期して使う。**表示の制御であって秘匿ではない**（記事本文は JS バンドルに入っており、開発者ツールで一般メンバーも読める。鍵・内部URL・個人情報は記事に書かない）。管理者向けの記事は frontmatter の `audience: [admin]` を付けるだけで隠れる。
- **マニュアル一式の収録条件**：一般向け記事一式（管理者専用・機能仕様・システム構成・archived を除く）。管理者が保存しても同じ。
- **`sanitizeSvg` は許可リスト方式**（`src/lib/docs/svgSanitize.ts`）：入力をトークンに分解し、許可した要素（svg・g・rect・circle・ellipse・line・polyline・polygon・path・text・tspan・title・desc・defs・marker・linearGradient・radialGradient・stop）と属性だけを自前で組み直す。`style` は許可した性質の宣言だけを残し、値は var(--color-*)・数値・色名・# 色・%・rgb()/hsl() に限る（url(・@・バックスラッシュ・expression を含む宣言は捨てる）。href は `#` で始まるものだけ。`<style>`・`<script>`・`<foreignObject>`・`<set>`・`<animate*>`・`<use>`・`<a>` は子孫ごと捨て、ルート以外の svg・`</svg>` の後ろも捨てる。DOMParser を使わないのは、テスト環境（node）に DOM が無く実装と同じ経路を検証できないため（出力は常に正規化されるので解釈差の入り込む余地も無い）。アプリ内表示（`GuideMarkdown`）と HTML 保存の両方がこの関数を使う。**図解に新しい要素・属性が要るときは `SVG_ALLOWED_*` に足す**（実在の図解11本が要素・属性を失わないことを `svgSanitize.test.ts` が検査する）。

### その他
- 初回ツアー11ステップ・OKRツアー10ステップ、`uiGuide.ts`（巡回台帳 M28 解消）。設定ページの ? は一般メンバーが `settings.member`・管理者が `admin.settings`。
- MIN_CLIENT_VERSION は上げない。マイグレーションなし。

---
