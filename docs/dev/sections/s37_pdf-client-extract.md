## 37. PDF取込をクライアント側テキスト抽出に統一（v3.79・2026-08-19）

Section 19 ⑦・27で「既知の未解消リスク」として記録していた、PDFをbase64のdocumentブロックとして直接Edge Functionへ送る経路を、実際に調査して確定させ、他の画面と同じ「クライアント側でテキスト抽出→テキストを送る」方式に統一した。

### 調査結果：実際にbase64直送のまま残っていた経路は2画面（診断どおり）

- `src/components/admin/OkrImportModal.tsx`（グループOKR取込。「📄 PDFから取込」）
- `src/components/meeting/MeetingImportPanel.tsx`（会議文字起こし取込）

どちらも`handleFile()`内でPDF判定時に`FileReader.readAsDataURL()`→`{ mediaType: "application/pdf", isText: false }`を直接組み立てており、`FileAttachButton.tsx`の共通経路を使っていなかった（診断の「2画面」と一致。他に該当する画面は無いことをコードベース全体で`application/pdf`を検索して確認済み）。

### 既に移行済みだった経路：`FileAttachButton.tsx`（v3.45時点）

`src/components/common/FileAttachButton.tsx`は`isPdfFile(file)`判定後、`lib/pdfText.ts`の`extractPdfText()`を動的importして呼び、抽出したテキストを`{ mediaType: "text/plain", isText: true }`として渡す設計に既になっていた（v3.45）。この経路は`src/components/lab/KrJointSessionFlow.tsx`・`KrQuarterPlanPanel.tsx`・`KrReportPanel.tsx`・`KrWhyPanel.tsx`・`src/components/okr/personal/PersonalOkrImportModal.tsx`（Kintone個人OKR取込・Section 24 Step F）から共有されている。

**横展開できるか＝できる。ただし1点だけ既存の`extractPdfText()`呼び出しをそのまま踏襲すると設計判断2（フォールバック必須）を満たせなかった**：v3.45時点の`FileAttachButton.tsx`は、`extractPdfText()`が抽出結果空（`PDF_EMPTY_TEXT_MESSAGE`）や解析失敗で例外を投げた場合、`.catch(alert(...))`で利用者にアラートを出すだけで**添付なしのまま終わっていた**（フォールバックしていなかった）。今回の依頼の設計判断2（抽出結果が空ならbase64直送へ自動フォールバック）を満たすには、この失敗時の挙動自体を変える必要があった。そのため「そのまま横展開」ではなく、フォールバック判定を挟む共通ラッパーを新設し、**`FileAttachButton.tsx`自身もこのラッパー経由に更新した**（既存の移行済み画面の挙動も、今回のフォールバック方針に合わせて底上げされる）。

### 実装

- **`src/lib/pdfTextFormat.ts`に純粋関数`resolvePdfFallbackSource(extractedText: string | null, fileSizeBytes: number): "text" | "base64" | "too-large"`を追加**（pdfjs-dist非依存・既存の`isBlankExtractedText`をそのまま再利用）。抽出成功（非blank）ならサイズを問わず`"text"`。抽出失敗（`null`＝例外／空文字／空白・改行のみ）の場合のみサイズを見て、`PDF_BASE64_FALLBACK_MAX_BYTES`（200KB＝204800バイト）以下なら`"base64"`、超えたら`"too-large"`を返す。テストは`src/lib/__tests__/pdfTextFormat.test.ts`に7ケース（通常のテキスト×大小2件／空文字・小／空白改行のみ・小／null・小／閾値ちょうど＝base64／閾値超過×2件＝too-large）。
  - 🔴 **base64フォールバックそのものにもサイズの歯止めが必要（統括レビューで追加）**：抽出失敗をきっかけにbase64直送へフォールバックする設計は、テキスト層の無い大きなPDFに対して「546を分かりにくい失敗として再発させるだけ」になりかねない（base64直送自体が546の原因だった実績＝Section 19 ⑦）。**閾値は「実際に落ちた670KBという値」そのものではなく、その値から十分な安全マージンを取った200KB**（670KBの実に3割弱）にした。閾値を超える場合は`PDF_TOO_LARGE_MESSAGE`（「このPDFは文字を読み取れず、かつサイズが大きいため読み込めませんでした。文字を選択できる状態で保存し直すか、内容をコピーしてテキスト欄に貼り付けてお試しください。」）を例外として投げ、base64は一切送らない。
- **新規`src/lib/pdfAttachment.ts`（`buildPdfAttachment(file: File): Promise<FileAttachment>`）**：PDFをAIに添付するための唯一の入口。内部で`./pdfText`（pdfjs-dist本体を抱える）を動的importして`extractPdfText()`を呼び、失敗したら`console.warn`で1行だけログを残す（利用者への通知はしない＝設計判断3）。`resolvePdfFallbackSource(extractedText, file.size)`の判定に従い、`"text"`ならテキスト添付、`"base64"`なら`FileReader.readAsDataURL()`でbase64を読み直してbase64添付（`isText:false`）、`"too-large"`なら`PDF_TOO_LARGE_MESSAGE`を例外として投げる。base64の読み込み自体が失敗した場合（本当に読めないファイル）も例外を投げる。いずれの例外も呼び出し側の`.catch()`でユーザーに表示する——**この判定・エラーの出し方は`buildPdfAttachment`という1つの入口に集約されているため、7画面（`FileAttachButton.tsx`経由の5画面＋`OkrImportModal.tsx`／`MeetingImportPanel.tsx`）全てで同じ挙動になる**（画面ごとに文言・挙動がばらつかない）。
  - このファイル自身は`pdfText`をトップレベルでimportしていない（関数本体からの動的import）ため、呼び出し側が`buildPdfAttachment`を静的importしてもpdfjs-distのダウンロードは発生しない（Section 19の「PDFを一度も添付しない人はダウンロードしない」を維持。ビルド実測で`pdfAttachment`チャンクはgzip 0.69KBの独立チャンクになり、重量級の`pdfText`チャンク（gzip 127.38KB）とは分離されたままであることを確認済み）。
- **`FileAttachButton.tsx`を更新**：PDF判定時の処理を`import("../../lib/pdfText").then(extractPdfText)`から`import("../../lib/pdfAttachment").then(buildPdfAttachment)`に差し替えた。これにより、テキスト層の無いPDF（スキャン画像等）を添付したとき、**従来は失敗アラートで終わっていたのが、v3.79からは自動的にbase64直送へフォールバックして解析を継続できる**ようになった（この画面群のユーザー体験も今回の対応で底上げされた）。
- **`OkrImportModal.tsx`／`MeetingImportPanel.tsx`を更新**：`handleFile()`内のPDF分岐を、`FileReader.readAsDataURL()`直書きから`import("../../lib/pdfAttachment").then(({ buildPdfAttachment }) => buildPdfAttachment(file))`に差し替えた。`pdfAttachment`状態（型は変更なし・`FileAttachment`）にテキスト添付またはbase64添付のどちらかが入るようになる。UI上の添付ラベル「このPDFをそのままAIに渡します」は、実際にはテキストで送られる場合とbase64で送られる場合の両方があり得るため（設計判断3：フォールバックの発動は利用者に分かる必要はない）、「このPDFを読み込みました」という経路を問わない表現に変更した。
- **AIに渡る情報の意味は経路によって変わらない（設計判断4）**：`extractOkrImportData()`（`okrImportExtractor.ts`）・`extractMeetingData()`（`meetingExtractor.ts`）はどちらも既存の`buildMessageContent(text, attachment)`（`invokeAI.ts`）を経由しており、`attachment.isText`の真偽だけでテキスト追記／documentブロックのどちらで送るかを自動判定する。呼び出し元のプロンプト組み立てコードは一切変更していない（`attachment: pdfAttachment`をそのまま渡すだけ）。
- **max_tokensは変更していない**：`okrImportExtractor.ts`は既に8192（Section 6-1c準拠）、`meetingExtractor.ts`は4096で、どちらも添付ファイルを伴うAI機能の目安（8192）の範囲内だったため変更不要と確認した。

### 意味が変わるため実装を見送った経路：無し

調査の結果、「PDFの図表そのものをAIに見せる必要がある」ため今回のテキスト抽出化に適さない経路は見つからなかった。`OkrImportModal.tsx`・`MeetingImportPanel.tsx`はどちらもKintoneの画面をPDF化したテキスト主体の資料を読ませる用途で、既存のシステムプロンプト（角括弧表記・見出し語ベースの抽出）が前提とする入力形式と一致しており、`personalOkrImportExtractor.ts`が既に同じ前提でテキスト抽出運用されている（Section 27）こととも整合する。

### フォールバックを残す理由（再掲）

山本さんに確認済みの前提は「取り込むPDFはブラウザの印刷機能で作られるためテキスト層が残る」だが、将来キャプチャ由来のPDF（テキスト層なし）が混ざる可能性があるため、抽出結果が使えない場合は黙って従来のbase64直送に落ちる安全網を残した（Kintone取込の「決定的パーサ→AIフォールバック」＝Section 24 Step Kと同じ考え方）。

### フォールバックにサイズの歯止めを設けた理由（統括レビューで追加）

フォールバックを入れたことで、`FileAttachButton.tsx`経由の5画面がこれまで出していた明確なエラー表示（alert）が黙ってbase64直送に置き換わった。歯止めが無いままだと、テキスト層の無い大きなPDFに対して「分かりやすいエラー」を「原因の分かりにくい546」に置き換えただけになってしまう。そのため`resolvePdfFallbackSource()`にファイルサイズ判定を組み込み、閾値超過時はbase64直送をせず`PDF_TOO_LARGE_MESSAGE`で明示的に失敗させるようにした（詳細は上記「実装」参照）。

### やらないこと

- `OkrImportModal.tsx`・`MeetingImportPanel.tsx`の他の機能（Word/テキスト読み込み・登録フロー等）は変更していない。
- Edge Function側（`supabase/functions/ai-consult/index.ts`）は変更していない（クライアント側の送信データを軽くするだけで解決する設計のため。Section 19 ⑦参照）。
- `max_tokens`の見直しは行っていない（上記のとおり既に基準内）。

---
