## 6. AI連携設計（確定）

### 6-1. 絶対的な禁止事項（2026-05-13 改定）

```typescript
// ❌ 絶対禁止：APIキーをクライアントに露出させる
const response = await fetch("https://api.anthropic.com/v1/messages", {
  headers: { "x-api-key": "sk-ant-..." } // ブラウザに露出する
});

// ✅ 正しい経路（AI呼び出しは必ず invokeAI() を経由）
// クライアント → Supabase Edge Function（ai-consult） → Anthropic API
```

> **【変更】OKR関連情報（O/KR/TF/ToDo）や `contribution_memo` を AI に渡すことは禁止ではなくなった**
> （社内確認の結果。Section 2「AI境界ルール」参照）。残る絶対禁止事項は「APIキーのクライアント露出」と
> 「`invokeAI()` を経由しない直叩き」のみ。

### 6-1b. AIIntent 型ガード（呼び出し目的のラベル＋使用量計測）

`src/lib/ai/invokeAI.ts` の `invokeAI()` は **`intent: AIIntent` パラメータ必須**。
かつては「OKRデータが誤った経路で送られないようコード上で表明させる」目的だったが、現在は
**「この呼び出しは何の機能で、どんなデータを渡しているか」のラベル**として機能する
（そのまま `ai_usage_logs.consultation_type` に保存され、AI使用量タブで機能別集計に使われる）。

```typescript
export type AIIntent =
  | "task-management"      // payloadBuilder 経由・通常のタスク管理相談
  | "kr-report"            // KR レポート生成
  | "kr-quarter-plan"      // クォーター計画
  | "kr-session-extract"   // セッション議事録抽出
  | "kr-why"               // なぜなぜ分析
  | "okr-analysis"         // KR単位のAI分析（会議ノート＋KRセッション・宣言＋TFタスク）
  | "meeting-extract"      // 会議文字起こしからタスク抽出
  | "project-plan"         // AI で PJ 設計
  | "project-analysis"     // 単一PJの健全性分析
  | "all-projects-analysis" // 全PJ横断ポートフォリオ分析
  | "todo-decompose"       // ToDo 分解
  | "okr-import"           // Kintone OKR(PDF/テキスト)からObjective/KR/TF構造を抽出
  | "okr-personal-import"  // Kintone個人OKR(PDF/テキスト)から個人KR/月次計画/振り返りを抽出
  | "okr-personal-outlook" // 個人OKR「これから」の見立て・週ごとの一手・バンドのAI判定（自動トリガー・キャッシュあり）
  | "okr-personal-chat";   // 個人OKR用AIパネルの対話形式の相談（明示操作・ターンごとに発生）
```

新しい AI 機能を追加するときは、この型に新タグを追加し、当該 prompt builder に
「何のデータを渡しているか」をコメントで明示すること（漏洩防止というより可読性・記録のため）。
タグなしの呼び出しはコンパイルエラー。

### 6-1c. max_tokensの目安（v3.45・2026-08-10）

JSON構造の抽出（OKR取込・会議抽出等）は **8192で足りる**（`okrImportExtractor.ts`・
`personalOkrImportExtractor.ts`が実績値）。**16000（や16384のCap近辺）に上げると、PDF等の
大きな添付を併用した際にEdge Functionのワーカーがリソース上限で落ちる
（546 WORKER_RESOURCE_LIMIT。2026-08-10の実例。Section 19 ⑦参照）。** 出力が長くなりがちな
複数タスクの構造化提案（`apiClient.ts`のメイン相談）のように添付ファイルを伴わない用途は
16384（Edge Function側`MAX_TOKENS_CAP`）まで上げてよいが、**添付ファイルを伴うAI機能は
8192を既定にする**こと。安易にmax_tokensだけを上げて出力切れを解消しようとしない
（`stop_reason==="max_tokens"`を検知して分かりやすいエラーにする方が安全。
`personalOkrImportExtractor.ts`の実装・`consultationRunner.ts`の先例参照）。

### 6-2. APIキーの管理

- APIキーは Supabase の環境変数（ANTHROPIC_API_KEY）にのみ保持する
- .env ファイルを Git にコミットしない（.gitignore に必ず追加）
- クライアントは Supabase Auth トークンで Edge Function に認証する

### 6-3. AIに渡すデータ構造

```typescript
interface AIConsultationPayload {
  context: {
    today: string;                   // 例："2026-03-17"
    today_formatted: string;         // 例："2026年3月17日（火）"
    fiscal_year: { start, end, first_half_end, second_half_start, second_half_end };
    quarters: {
      definition: "1Q=1〜3月 / 2Q=4〜6月 / 3Q=7〜9月 / 4Q=10〜12月";
      current_quarter: string;       // 例："1Q"
      current_quarter_end: string;
      next_quarter: string;
      next_quarter_start: string;
      next_quarter_end: string;
    };
    target_deadline: string | null;  // deadline_checkモードのみ使用
    member_workload: MemberWorkload[]; // メンバーごとの工数状況
  };
  consultation_type: ConsultationType;
  consultation: string;
  scope: "related_pj" | "all_pj" | "member_tasks";
  projects: AIProject[];             // 現状は pj_purpose のみ（contribution_memo は未投入。投入しても可）
  retry_hint?: string;               // リトライ時のみ
}
```

### 6-4. コメントのサニタイズ（必須）

```typescript
// AIに渡す前に必ず呼び出す（payloadBuilder.tsで実装済み）
export function sanitizeComment(comment: string): string {
  return comment
    .replace(/\\\\[^\s]*/g, "[ファイルパス省略]")    // ネットワークパス
    .replace(/\/\/[a-zA-Z0-9._-]+\/[^\s]*/g, "[ファイルパス省略]") // UNCパス
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[メールアドレス省略]")
    .trim();
}
```

### 6-5. shortIdMapの管理

```typescript
// payloadBuilderはshortIdMapと一緒にpayloadを返す
interface BuildPayloadResult {
  payload: AIConsultationPayload;
  shortIdMap: Map<string, string>; // key: "task_001", value: UUID
}

// useAIConsultationのstateで保持し、applyProposalに渡す
const [shortIdMap, setShortIdMap] = useState<Map<string, string>>(new Map());

// セッションリセット時に初期化する
setShortIdMap(new Map());
```

### 6-6. consultation_typeの5種類（厳守）

| 種類 | 説明 |
|---|---|
| `change` | 変更の影響整理（デフォルト） |
| `simulate` | What-If シミュレーション |
| `diagnose` | 現状診断（変更なしでリスクを洗い出す） |
| `deadline_check` | 締め切り逆算（target_deadlineが必須） |
| `scope_change` | PJ停止・スコープ縮小 |

勝手に種類を追加しないこと。追加する場合はsystem_prompt_design_v3.mdも同時に更新する。

### 6-7. マルチターン（会話履歴）の管理

```typescript
// 会話履歴はDBに保存しない。React stateのみ。
// パネルを閉じたら消える設計を崩さないこと。
// セキュリティ上の理由：履歴にはPJ・タスクデータが含まれる。

// トークン上限の管理（ターン数ベース）
// 10ターン → warning（「新しい相談を始める」を表示）
// トークン超過 → truncateOldTurns（直近5ターンを保持して古いターンを削除）
```

### 6-8. date_certaintyの画面表示ルール

| 値 | 表示 | 「反映する」ボタン |
|---|---|---|
| `"exact"` | 特別な表示なし | 活性 |
| `"approximate"` | ⚠ 「日数は要確認」バッジ | 活性 |
| `"unknown"` | ❓ 「日数未定」バッジ | 非活性 |

**例外**：`add_task`・`add_project`（`proposalMapper.ts`の`canApply`）は、日付が未定（`"unknown"`）でも
反映ボタンを活性のままにする。新規タスク・新規PJの提案は日付が仮決めでも「確認して作成」画面で
編集できるため、date_certainty による非活性化の対象外とする意図的な設計（date_change・assignee等の
既存データ変更とは異なり、作成系は空欄のまま作ってから後で編集すればよいため）。

### 6-9. simulation_stateの画面表示ルール

```typescript
// is_simulation=true の場合：
// - 提案カードに「🔵 シミュレーション」バナーを表示
// - 「反映する」ボタンを非活性にする
// - 「この仮定で確定する」ボタンで通常フローに移行
```

### 6-10. applyProposalのDB操作ルール

```typescript
// date_change・assignee → needs_confirmationを返す
//   確認ダイアログでユーザーが値を確認・入力後にapplyProposalWithConfirmationを呼ぶ
//
// risk・no_tasks・deadline_risk → appStore.saveTask経由でcommentに追記
//   supabase.rpc()は使わない（v3.71より前は2ステップSELECT+UPDATEを自前実装していたが、
//   saveTaskのchoke point自体が同種の楽観ロックを持つため今は委譲している）。
//
// scope_reduce・pause → appStore.deleteTask/deleteProject経由の論理削除（is_deleted=true）
//
// milestone → 現在未対応。errorを返す。
//   マイルストーンテーブルの設計完了後にneeds_confirmationに変更する。
```

**🔴 v3.71でchoke point統一**：上記いずれも`supabase.from(...)`を直接呼ばず、
`useAppStore.getState()`のアクション経由でDBに反映する（Section 3-6参照）。読み取り
（確認ダイアログ表示用のプレビュー）も常に`useAppStore.getState()`のstateを見る
（実ユーザー・ゲストで分岐しない。以前は実ユーザーのみ`supabase.from(...).select()`で
都度フレッシュな値を取っていたが、store状態は他の画面もこれを信頼して動いているため
統一した）。

### 6-11. applyProposalWithConfirmationの引数

```typescript
// shortIdMapは引数に含めない（第3引数は不要）
// 理由：confirmedValuesのキーはDBから取得したUUIDそのものであり、逆引き不要
export async function applyProposalWithConfirmation(
  dialog: ConfirmationDialog,
  confirmedValues: Record<string, string> // key: UUID, value: 新しい日付orメンバーID
): Promise<ApplyResult>
```

### 6-12. useAIConsultationのexportルール

```typescript
// 実際のexport（2026-07-21・巡回20回目で更新。loadingMessageは2026-04-30のAIProgressLoader
// 導入でLoadingView側が固定フェーズ表示に切り替わり表示先を失っていたため削除）
return {
  callState, session, tokenStatus, shortIdMap,
  proposals, followUpSuggestions, errorMessage,       // AI応答の表示に使う派生state
  submit, reset,
  undoStack, canUndo, pushUndoSnapshot, undo, undoUntil, // Undo機能（後から追加）
};

// useFollowUpはexportしない
// 理由：FollowUpButtonsのonSelectはinputTextへの挿入のみ行う。
//       即APIコールするuseFollowUpは誤用の危険があるため削除済み。
```

### 6-13. システムプロンプトの格納場所

`/src/lib/ai/systemPrompt.ts` に定数として管理する。
直接コード内にインラインで書かない。
変更する場合は system_prompt_design_v3.md のバージョンも上げること。

### 6-14. 四半期定義

```
1Q=1〜3月 / 2Q=4〜6月 / 3Q=7〜9月 / 4Q=10〜12月
年度：1月〜12月
上半期：1〜6月 / 下半期：7〜12月
年度末：12月31日
```

### 6-15. エクスポート仕様（優先度順）

1. **CSV**（最初に実装）
2. **Excel（.xlsx）**（動くものができてから）
3. **PDF**（最後・難易度高・将来検討）

---

---

### 6-5 の追記（v3.182）：shortIdMap は会話のあいだ保つ

`buildPayload` に `prevShortIdMap` を渡すと、同じPJ・タスクには同じショートIDを使い続ける（返す map には前回までの対応も残す）。履歴の過去の提案は最新の map で引くため、毎回 001 から振り直すと別のタスクへ解決されうる。`useAIConsultation` は `shortIdMapRef` で保持し、`reset` で空に戻す。

### 6-1b の追記（v3.186）：出力切れの検知は `assertNotTruncated` に寄せる

`stop_reason === "max_tokens"`（出力上限で途中切れ）の検知は、`lib/ai/assertNotTruncated.ts` の `assertNotTruncated(res, message)` を、`invokeAI` が返った直後（JSON のパース・文章の保存より前）に1回呼ぶ。文言は機能ごとの案内（「2回に分けて」「質問を分けて」等）を `message` で渡す。**新しい AI 呼び出しを足したら必ず適用する**（検知が無いと、JSON は構文エラーの汎用文言になり、文章は途中切れのまま保存・表示される）。リトライしない方針（同じ長さの壁に当たる）は従来どおり。`invokeAI.ts` に置かないのは、各テストが invokeAI モジュールを丸ごとモックしているため。使用量の記録は `invokeAI` の中（v3.185＝記録→空の判定）で済んでおり、出力切れでも課金済みの使用量は記録される。文章を返すPJ分析2本だけは `finalizeAnalysisText`（注記を付けて途中まで残す型）を使う。テスト＝`assertNotTruncated.test.ts`。
