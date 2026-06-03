# 共通基盤：AI基盤 ＋ AI相談ロジック（lib/ai）

> AI呼び出しの共通ゲートと、各AI機能のクライアント／プロンプト／パーサ。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)（AI基盤＋各機能）。

## 2つの層が同居している
1. **AI基盤（横断）**：すべてのAI機能が通る共通部分。
   - `invokeAI.ts` … **AI呼び出しの唯一のゲート**。`intent: AIIntent` 必須＝使用量を自動計上。
   - `apiClient.ts` … 通常のタスク管理相談だけ歴史的経緯で `supabase.functions.invoke("ai-consult")` を直叩き（使用量は `useAIConsultation` 側で計上）。
   - `usageLog.ts` / `sanitize.ts`（ネットワークパス等の除去）/ `types.ts`（`AIIntent`/エラー型）。
   - APIキーは **Edge Function `supabase/functions/ai-consult`** にのみ存在（クライアント露出禁止）。
2. **機能別ロジック**：どのモジュールに属するかは下表。

| ファイル群 | 属するモジュール |
|---|---|
| `payloadBuilder` `systemPrompt` `responseParser` `proposalMapper` `applyProposal` `inferConsultationType` `sessionManager` `undoApply` `chatHistoryStorage` | B AI相談 |
| `meetingExtractor` | C 会議読み込み |
| `krSessionExtractor` `krReportClient/Prompt` `krWhyClient` `krQuarterPlanClient/Prompt` `okrKrAnalysisClient` `okrObjectiveAnalysisClient` | D OKR |
| `projectAnalysisClient` | E PJ別AI分析 |
| `todoDecomposeClient` | F 管理 |

## 改修・バグ探しの注意点
- **新しいAI機能は必ず `invokeAI` 経由**で実装し、`AIIntent` にタグを追加する（使用量タブに出る）。
- `systemPrompt.ts` を変えると全相談の挙動が変わる。変更時は `__tests__/systemPrompt.test.ts` を確認。
- AIに渡す前のサニタイズ（`sanitize.ts`）と shortId↔UUID 変換（`payloadBuilder.ts`）を壊さない。
- 詳細ルールは `CLAUDE.md` の Section 6（AI連携）/ 16（使用量計測）。
