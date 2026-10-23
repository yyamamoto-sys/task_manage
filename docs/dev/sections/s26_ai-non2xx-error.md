## 26. AI呼び出しの非2xxエラーの原因が捨てられていたバグの修正（v3.43・2026-08-10）

**症状**：OKRモード「Kintoneから取込」でPDFを解析しようとすると「AI解析に失敗しました Edge Function returned a non-2xx status code」しか出ず、Anthropic側の実際の理由（レート制限・過負荷・ゲートウェイのサイズ超過等）が一切見えなかった。

**原因（Section 15末尾に要点を明記済み）**：`supabase.functions.invoke()` は非2xx時に `data` を必ず `null` にし、Edge Functionが返した本文（`{error, message, detail, status}`）は戻り値の `response`（`Response`オブジェクト）にしか入らない。`invokeAI.ts`/`apiClient.ts`はどちらも`data`だけを見ていたため、`ANTHROPIC_ERROR`/`RATE_LIMIT_EXCEEDED`/ゲスト回数制限等の丁寧な分岐が実際には一度も実行されず、常に汎用フォールバック文言に落ちていた。

- **共通ロジックを`src/lib/ai/edgeFunctionError.ts`に集約**：`readEdgeErrorPayload()`（`response`から本文を読む。JSON化できなければ生テキストのまま保持。読み取り自体の失敗も例外を投げない）・`extractEdgeError()`（body/status/rawTextからユーザー向けメッセージを組み立てる純粋関数）・`buildInvokeErrorMessage()`（`invokeAI.ts`用の結合ヘルパー。`data`が既にある後方互換ケースはそれを使い、無いときだけ`response`を読む）。`apiClient.ts`（`callAIConsultation`）は`AIError`のコード分岐を保つため`readEdgeErrorPayload()`を直接使う形に揃えた（Section 16の例外経路だがこのバグは共通していたため同じ直し方にした）。
- **HTTPステータスコードをメッセージに含める**（例「Anthropic APIエラー (529): overloaded_error」「(502): upstream connect error」）。原因の切り分けに直結する。
- **本文がJSONでない・空でも汎用文言だけで終わらせない**：ステータスコードと生テキストの先頭300文字を必ず添える（Section 15の趣旨）。
- **413（添付が大きすぎる）は専用の案内文**：「添付ファイルが大きすぎます (413)。ページ数を絞るか、テキストを貼り付けてお試しください。」
- **送信前のサイズチェックは入れなかった**：Supabase Edge Functionsのリクエストボディサイズ上限は2026-08-10時点で公式ドキュメントに明記されておらず（`supabase.com/docs/guides/functions/limits`はメモリ・実行時間・関数バンドルサイズ等のみを記載）、GitHub上のSupabase側回答も「10MB」は関数バンドル自体の上限であり受信ペイロードの上限ではないことを確認した。根拠のある数値が調べきれなかったため、推測の厳しい閾値で機能を狭めることはせず、エラー時のメッセージ改善（413対応）のみに留めた。将来413が実際に観測されたら、その時点のステータスコード・レスポンス本文を根拠に閾値を検討する。
- **`personalOkrImportExtractor.ts`の`max_tokens=16000`は確認のみ**：Edge Function側の`MAX_TOKENS_CAP`（16384）の範囲内であり原因ではないと判断し、変更していない。
- **テスト**：`src/lib/ai/__tests__/edgeFunctionError.test.ts`（新規・23件）に加え、`invokeAI.test.ts`/`apiClient.test.ts`に実際のsupabase-js非2xx挙動（`data=null`＋`response`から読む経路）のテストを追加。既存テスト（`data`を直接モックする後方互換ケース）は変更せず全通過。

---
