## 19. グランドルール：ダウンロード量の最小化（必須・v3.19、v3.20で②の実例追加）

**使用者が限られる重量級機能は `React.lazy` で分割し、閾値超えチャンクは確認ダイアログを通す。**
「全員が毎回使うわけではない機能を、全員に黙って毎回ダウンロードさせない」がこのルールの目的。

### ① まず `React.lazy` で分割する

新しい重量級ビュー・ラボ機能・管理画面タブを追加するときは、`MainLayout.tsx` の
既存パターン（`lazyWithRetry(factory, name)`）に必ず乗せる。切替頻度の低い機能を
初回バンドルに混ぜない。

### ② 言語辞書のように「使う人が限られるデータ」は静的importにしない

日本語（既定言語）は静的import・英語は動的import（`src/lib/i18n.ts` の `loadEnDict()` パターン）。
「全員が使うとは限らないデータ」を静的importで束ねると、使わない人にも必ずダウンロードさせて
しまう。en辞書のようにモジュールを `<name>.ja.ts` / `<name>.en.ts` に分割し、`import type` で
型だけを参照させることで、使わない側の実行時コードを一切バンドルに含めない設計にする。

### ③ 閾値を超えるチャンクは「承認して記憶」で確認する

`src/lib/chunkSizeGate.ts` の `CHUNK_DL_CONFIRM_THRESHOLD_GZIP_BYTES`（暫定200KB・gzip後）を
超えるチャンクを初めて要求するときは、`src/components/common/ChunkDownloadGate.tsx` の
`withChunkDownloadGate()` でラップし「◯KBのデータをダウンロードします。よろしいですか」の
確認を挟む。一度承認したら `localStorage` にチャンク名ごとの真偽フラグのみを記録し、次回から
聞かない（Human in the loop パターン③「承認して記憶」。`ClaudeCodeForWork/CLAUDE.md` 参照）。
**localStorageにはフラグだけを保存し、データ本体を保存しない。**

### ④ チャンクサイズは必ずビルド出力から実測する（ハードコード禁止）

`vite.config.ts` の `chunk-size-manifest` プラグインが `generateBundle` フックで実際の
チャンクコードからraw/gzipサイズを実測し `dist/chunk-sizes.json` を書き出す。閾値判定は
必ずこの実測値を使うこと。コード中にサイズをハードコードすると、ビルド内容とズレて嘘の
数字になる（＝「ビルドすれば自動で正しい数字になる」ことを満たす設計にする）。

### このルールは新機能を実装するとき必ず確認する

- [ ] 全員が毎回使うわけではない画面・パネルか？ → `lazyWithRetry` + `withChunkDownloadGate` に乗せる
- [ ] 使う人が限られるデータ（言語辞書・大きな静的データ等）を静的importしていないか？
- [ ] サイズ判定はハードコードでなく `dist/chunk-sizes.json`（ビルド実測）から取っているか？

### ⑤ チャンク名だけを見て「異常に大きい」と誤診しない（v3.20 追記）

`dist/chunk-sizes.json` のチャンク名は、Rollupが**代表として選んだファイル名**であり、
中身がそのファイル自身のコードだけとは限らない。以下は調査済みで、削減不可能な必須コスト
と確定している。次に大きいチャンクを見た人が同じ勘違いで調査時間を使わないための記録。

- **`CustomSelect` チャンク（gzip 約46KB）**：中身の97.5%は `react-dom` 本体。
  `CustomSelect.tsx` 自身は10KB・327行の普通のコンポーネントにすぎない。
  `createPortal` を `"react-dom"` から直接importするファイルが、常時ロード経路（静的import）
  と遅延ロード経路（動的import）の両方から参照されているため、Rollupが `react-dom` を
  共有チャンクとして切り出し、その代表名にたまたま `CustomSelect` が選ばれただけ。
- **`appStore` チャンク（gzip 約60KB）**：大半は Supabase 公式SDK本体。起動時に必ず要る
  ため（zustandストアがSupabaseクライアントに依存）削減しにくい。

チャンクが大きいこと自体が問題なのではなく、「使う人が限られる機能が常時ロード経路に
混ざっていないか」が本ルールの本質。上記2つはどちらも起動時必須の依存であり対象外。

### ⑥ モード単位の初回ゲート（v3.39・チャンク単位のゲートとの違い）

③のチャンクDLゲート（`ChunkDownloadGate.tsx`）は「**コードチャンクのダウンロード**」を
対象にするのに対し、OKRモードには別の対象を持つ初回ゲートがある：`src/lib/okr/okrModeGate.ts`
（判定の純粋関数）＋`src/components/okr/OkrModeIntroModal.tsx`（紹介ポップアップ）が、
「**OKRモードで使うデータのフェッチ**」を承認対象にする。「plan」→「okr」への切替（`MainLayout.tsx`
の `handleToggleAppMode`。choke point）を初めて行うときだけ、OKRモードでできることの紹介と
「データを読み込みます」の一言を挟み、承認したら `localStorage`（`KEYS.OKR_MODE_INTRO_APPROVED`）
に真偽値だけを記録して次回から聞かない（Human in the loop パターン③）。ゲスト（サンプル閲覧）は
Supabaseに一切接続しない設計（Section 23）のため対象外——承認を求める意味が無く、常に
ポップアップを出さず直接入る（承認フラグ自体も書かない）。
新しくモード単位・画面単位でデータフェッチのボリュームが増える機能を作るときは、
「コードのダウンロード」と「データのフェッチ」のどちらが重いのかを見極め、対応するゲート
（③のチャンクゲート／このモードゲート／両方）を検討すること。

### ⑦ Edge Functionに大きな添付をbase64で送るとワーカーのリソース上限で落ちる（v3.45・2026-08-10）

OKRモード「Kintoneから取込」で670KBのPDFを解析すると、Supabase Edge Functionが
`546 WORKER_RESOURCE_LIMIT`（`Function failed due to not having enough compute resources`）で
落ちる事故が起きた。原因はPDFをbase64エンコードしてEdge Functionへ送っていたこと
（670KB→約894KB。Edge Functionが`req.json()`でパースし、Anthropicへ転送する際に
`JSON.stringify`で再構築するため、複数コピーが同時にメモリへ載る）。

**Supabaseは関数ごとにメモリ/CPUの上限を上げる設定を持たない。送る側（クライアント）を
軽くするのが唯一の解。** PDF・Word(.docx)は、Anthropic APIがdocumentブロックで直接読める
としても、クライアント側でテキスト抽出してから軽量なテキスト添付として渡す
（`src/lib/docxText.ts`・`src/lib/pdfText.ts`。`FileAttachButton.tsx`がPDF/Word/HTML判定→
専用抽出→テキスト添付、という経路に一元化している）。新しく大きなファイル種別の添付に
対応するときも、base64のdocumentブロックで送る前にこの制約を必ず思い出すこと。

✅ **既知の未解消リスクはv3.79（2026-08-19）で解消済み（旧記録）**：`src/components/admin/OkrImportModal.tsx`（グループOKR取込）と`src/components/meeting/MeetingImportPanel.tsx`（会議文字起こし取込）は、`FileAttachButton.tsx`の共通経路を使わず、PDFをbase64のdocumentブロックとして直接構築する独自実装を持っていた（`setPdfAttachment({ mediaType: "application/pdf", ..., isText: false })`）。v3.79でこの2画面も`src/lib/pdfAttachment.ts`経由のテキスト抽出に揃え、PDFを扱う全経路が統一された。詳細はSection 37参照。

**新しいAI機能で大きな添付を扱うときの`max_tokens`の目安はSection 6-1c参照。**

### ⑧ 546はペイロードのサイズだけでなく「1回の呼び出しの実行時間」でも起きる（v3.46・2026-08-10）

⑦の対応（PDFのクライアント側テキスト抽出・v3.45）でペイロードサイズの問題を解消した後も、
`personalOkrImportExtractor.ts`で同じ`546 WORKER_RESOURCE_LIMIT`が再発した（テキスト抽出自体は
成功していた）。**Supabase Edge Functionのワーカーは、送信データが軽くても、1回の呼び出しの
生成（Anthropic APIからの応答待ち＋処理）に時間がかかりすぎるとリソース上限で落ちる。**
「ペイロードを軽くすれば直る」という⑦の理解だけでは不十分で、**大きな抽出を複数回の呼び出しに
分割するのが唯一の解**（Section 28参照。個人四半期KRと月次計画・振り返りを別呼び出しにした）。
新しく大きな構造化抽出を実装するときは、添付の軽量化（⑦）と呼び出しの分割（本項）の両方を
検討すること。

---
