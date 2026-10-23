## 15. グランドルール：ユーザー向けエラー表示（必須）

ユーザーに見せるエラーメッセージは「何が起きたか」「次に何をすればよいか」が判別できる粒度で表示する。

### 禁止

```typescript
// ❌ 禁止：何が起きたか分からないため原因究明できない
catch (e) {
  setError("エラーが発生しました");
}

// ❌ 禁止：message だけだとエラーコードが消えるので Supabase 側の原因究明ができない
catch (e) {
  setError(e instanceof Error ? e.message : "エラーが発生しました");
}
```

### 必須：`formatErrorForUser()` を経由する

```typescript
import { formatErrorForUser } from "../../lib/errorMessage";

// ✅ 推奨：エラーコード・details・hint を含めて表示
catch (e) {
  setError(formatErrorForUser("保存に失敗しました", e));
}
```

`formatErrorForUser` は Supabase の `PostgrestError`（code / details / hint）も含めて整形する。

表示例：
- `保存に失敗しました [42703] column "summary" does not exist`
- `保存に失敗しました [23514] new row violates check constraint "kr_sessions_session_type_check"`
- `保存に失敗しました [PGRST116] Cannot find a relationship ...`

### 例外：内部用途で「メッセージ文字列だけ」が必要な場合

`getErrorMessage()` を使う（ログ出力・UI 以外の場所）。

### このルールは新規コードに必ず適用する

既存コードもユーザー操作の起点（保存・削除・AI呼び出し等の catch）から順次 `formatErrorForUser` に置き換える。新規コードで `"エラーが発生しました"` 文字列を直接 setError しているのを見つけたら指摘・修正すること。

### 【要注意】`supabase.functions.invoke()` の非2xxは `data` を見るだけでは原因が全部消える（2026-08-10発覚・v3.43で修正）

`supabase.functions.invoke("ai-consult", ...)` が非2xxを返したとき、supabase-js は**`data` を必ず `null` にし**、Edge Function が返したレスポンス本文（`{ error, message, detail, status }`）は戻り値の **`response`**（`FunctionsHttpError` の場合は `Response` オブジェクト）にしか入らない。

```typescript
// ❌ 禁止：非2xx時は data が null になるため、Edge Function側の丁寧な分岐
//   （ANTHROPIC_ERROR / RATE_LIMIT_EXCEEDED 等）に一切到達せず、常に汎用フォールバック
//   文言に落ちる（実際にこれで数日ぶん原因が見えなくなった）。
const { data, error } = await supabase.functions.invoke("ai-consult", { body });
if (error) throw new Error(extractEdgeError(data, error.message)); // data は常にnull

// ✅ 必須：response（Response）の本文を読む。data はテスト等での後方互換のときだけ使う
const { data, error, response } = await supabase.functions.invoke("ai-consult", { body });
if (error) throw new Error(await buildInvokeErrorMessage(data, error, response));
```

実装は `src/lib/ai/edgeFunctionError.ts`（`readEdgeErrorPayload` / `extractEdgeError` / `buildInvokeErrorMessage`）に集約されており、`invokeAI.ts` と `callAIConsultation`（`apiClient.ts`）の両方がこれを経由する。新しく `supabase.functions.invoke()` を直接呼ぶコードを書くときは、必ずこのモジュール（または同じ判断）を経由し、`data` だけでエラー本文を組み立てないこと。

---

---

### v3.180：個人OKRの取得・保存エラーの表示（M55・M61）

- 「全体」タブの取得エラーは種類で分ける（`lib/personalOkr/periodReviewsLoadError.ts`）。テーブル・列が無い（未適用）だけ従来の案内、それ以外は`formatErrorForUser`の文言＋「再読み込み」。
- AI成功後のDB保存失敗は、結果を捨てずに画面へ残し`formatErrorForUser`のエラーを併記する（「保存し直す」で再保存）。
