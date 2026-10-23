## 16. グランドルール：AI 使用量の計測（必須）

新しい AI 機能を実装する際は、**必ず ai_usage_logs に使用量が記録される経路を通す**こと。これにより管理画面の「AI使用量」タブで全機能の入出力トークン・コストが見える化される。

### 必須：`invokeAI()` を経由する

```typescript
import { invokeAI } from "../ai/invokeAI";

// ✅ 推奨：invokeAI 経由 → 内部で logAIUsage() が自動的に呼ばれる
const response = await invokeAI(systemPrompt, messages, 4096, "kr-report");
const text = response.content[0].text;
```

`invokeAI` は呼び出し成功後に `logAIUsage(intent, response.usage)` を必ず実行する。**新しい AI 機能を追加するときは何もしなくてよい**——`invokeAI` を経由しているだけで自動的に計上される。

### 禁止：Supabase Edge Function を直接叩く

```typescript
// ❌ 禁止：invokeAI を経由しないと使用量が記録されない
const { data } = await supabase.functions.invoke("ai-consult", { body: {...} });
```

新しい AI 機能で `supabase.functions.invoke("ai-consult", ...)` を直接呼んでいるコードを見つけたら、`invokeAI` 経由に直すこと。

### 例外：`callAIConsultation`（apiClient.ts）

通常のタスク管理相談だけは歴史的経緯で `callAIConsultation` が直接 `supabase.functions.invoke` を呼ぶ別経路になっている。**この経路では `useAIConsultation.submit` 側で個別に `insertAiUsageLog` を呼んで計上している**。

新しい AI 機能でこのパターンを真似ない。必ず `invokeAI` を使う。

### AIIntent タグの追加

新しい AI 機能を追加するときは `src/lib/ai/invokeAI.ts` の `AIIntent` 型に新しいタグを追加する（CLAUDE.md Section 6-1b 参照）。このタグがそのまま `ai_usage_logs.consultation_type` に保存され、AI 使用量タブで機能別の集計に使える。

```typescript
// 例：新機能「会議サマリ生成」を追加するとき
export type AIIntent =
  | "task-management"
  | "kr-report"
  // ... 既存
  | "meeting-summary";  // ← 新規追加
```

### このルールは新規 AI 機能を実装する時に必ず確認する

「AI を呼ぶ → invokeAI 経由か？」「AIIntent に新タグは追加したか？」をレビュー時にチェックする。

---

### v3.182 の追記：解析に失敗した送信の使用量も記録する

AI相談（`apiClient` 経由のレガシー経路）の使用量は `runAIConsultation` の `onUsage` で、API を1回呼ぶたびに記録する。返答の解析に失敗して例外になる送信（`max_tokens`・不正JSON・リトライ後も不正）でもトークンは消費済みのため、成功時の戻り値からだけ記録してはならない（`consultationRunnerUsage.test.ts`）。
