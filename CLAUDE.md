# CLAUDE.md — グループ計画管理アプリ 設計ドキュメント v2.2
#
# 変更履歴：
# v1.0 Phase 1〜3の設計を反映（データモデル・削除設計・競合制御・画面一覧）
# v2.0 Phase 4の設計を反映（AI連携・システムプロンプト・APIコール・画面反映）
#      追加：Section 6-6〜6-22（AI連携設計の全仕様）
#      追加：Section 13（ファイル構成）
#      更新：Section 10（未解決論点からPhase 4解決済み分を削除）
# v2.1 ToDo層追加・Task設計変更・GraphView追加（2026年3月）
#      追加：3-2b（ToDoデータモデル）
#      更新：2（6層構造に変更）・3-3（Task.project_id NULL許可・todo_id追加）
#      更新：13（ファイル構成にGraphView追加）
# v2.2 UI/UX大幅改善・機能追加・ホスティング確定（2026年4月）
#      更新：1（ホスティングをVercelに確定）
#      更新：3-1（TaskForce.tf_numberをドロップダウン選択に変更）
#      更新：8（画面一覧を現状に合わせて更新）
#      更新：13（ファイル構成にMainLayout.tsx追加）
#
# 最終更新：2026年4月（v2.2）

> このファイルはAIエージェント（Claude Code / Cursor等）がコードを読み書きする際に
> 設計意図・制約・禁止事項を正確に把握するための最重要ドキュメントです。
> コードを変更する前に必ずこのファイルを読んでください。

---

## 0. プロジェクト概要

**アプリ名**：グループ計画管理アプリ（仮）
**開発者**：チームメンバー
**開発手法**：バイブコーディング（Claude Code / Cursor等によるAI支援開発）
**目的**：チーム全員がプロジェクト・タスクの進捗を一元管理し、変更コストの削減とチーム全体の可視性向上を実現する
**利用者**：チームメンバー全員（10名弱）
**利用環境**：PCブラウザ / Microsoft Teams埋め込み

---

## 1. 技術スタック

| 項目 | 選定 | 理由 |
|---|---|---|
| フロントエンド | TypeScript + React | 型安全・AI補助開発との相性 |
| データベース | Supabase（PostgreSQL） | 無料枠で十分・多対多リレーション対応・RLS設定可 |
| AI連携 | Anthropic Claude API（claude-sonnet-4-6） | プロジェクト・タスク層のみに使用 |
| AI中継 | Supabase Edge Function（ai-consult） | APIキーをサーバーサイドにのみ保持するため |
| 通知連携 | Microsoft Teams Webhook | タスク完了・期限通知 |
| ホスティング | Vercel | GitHubへのpushで自動デプロイ（main branch） |

**⚠ 確認が必要な事項（未解決）**
- Supabaseへのデータ保存について社内情報セキュリティポリシーの確認が必要
- Claude APIへのデータ送信について社内ポリシーとの整合性確認が必要
- Teams埋め込みアプリとしての申請手続き確認が必要

---

## 2. 情報の6層構造（最重要）

このアプリの設計原則の核心。コードのどこを触るときも必ずこの構造を意識すること。

### OKR系統（Object > KR > TF > ToDo > Task）

```
Layer 1: Objective（O）          ← ラベル管理・AIに渡さない・削除不可
Layer 2: Key Result（KR）        ← ラベル管理・AIに渡さない
Layer 3: Task Force（TF）        ← ラベル管理・AIに渡さない
Layer 4: ToDo                    ← ラベル管理・AIに渡さない（タイトルのみAIに渡す）
─────────────────────────────── ← AIの境界線（絶対に越えない）
Layer 5: Task                    ← AI管理・AIに渡す
```

### プロジェクト系統（独立・OKRと無関係に存在可）

```
Project（PJ）                    ← AI管理・AIに渡す
  └── Task                       ← AI管理・AIに渡す
```

### Taskの紐づきパターン（いずれか、または両方）

```
① Project only:  Task.project_id = "uuid", Task.todo_id = null
② ToDo only:     Task.project_id = null,   Task.todo_id = "uuid"
③ 両方:          Task.project_id = "uuid", Task.todo_id = "uuid"
```

### AI境界ルール

- O / KR / TF は一切AIに渡さない
- ToDo は「タイトルのみ」をAIに渡す（TF/KR/O情報は含めない）
- AIペイロード内では ToDo 単位のタスクグループを仮想プロジェクトとして表現する（payloadBuilder.ts参照）

### 絶対に破ってはいけないルール

```typescript
// ❌ 絶対禁止：O・KR・TFをAIに渡す
const payload = { okr: objective, krs: keyResults, tfs: taskForces };

// ✅ 正しい：PJ・Task層のみ渡す
const payload = { projects: projectsWithTasks };

// ❌ 絶対禁止：contribution_memoをそのままAIに渡す（KR情報を含む）
pj_contribution_memo: pj.contribution_memo

// ✅ 正しい：pj_purposeのみ渡す
pj_purpose: pj.purpose
```

---

## 3. データモデル（確定版）

### 3-1. OKR層（ラベル管理）

```typescript
interface Objective {
  id: string;
  title: string;
  period: string;          // 例："2026年度"
  is_current: boolean;     // true=現行、false=アーカイブ
  archived_at?: Date;
  created_at: Date;
  updated_at: Date;
  updated_by: string;      // member_id
}

interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  description?: string;
  due_date?: Date;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}

interface TaskForce {
  id: string;
  kr_id: string;
  tf_number: string;       // "1"〜"9" の数値文字列。UI上は1〜9のドロップダウン選択（手動入力廃止）
  name: string;
  description?: string;
  leader_member_id?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}
```

### 3-2b. ToDo層（OKR管理）

ToDoは TF の下に存在する「中タスク」。複数の Task（小タスク）で構成される。
**AIには渡さない。タイトルのみ仮想プロジェクト名としてAIペイロードに含める。**

```typescript
interface ToDo {
  id: string;
  tf_id: string;           // 所属するTaskForceのID
  title: string;           // 複数行入力可（説明的なテキストになることが多い）
  due_date: string | null; // 任意。YYYY-MM-DD形式
  memo: string;            // 任意の備考（デフォルト: ""）
  is_deleted: boolean;
  deleted_at?: string;
  deleted_by?: string;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
}
```

### 3-2. PJ層（AI管理）

```typescript
interface Project {
  id: string;
  name: string;
  purpose: string;          // 必須：何のためのPJか一行で
  contribution_memo?: string; // AIには渡さない（KR情報を含む可能性）
  owner_member_id: string;
  start_date?: Date;
  end_date?: Date;
  status: 'active' | 'completed' | 'archived';
  color_tag?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;         // 競合検知に使用
  updated_by: string;
}

// PJ ↔ TF 多対多
interface ProjectTaskForce {
  project_id: string;
  tf_id: string;
  created_at: Date;
}

// PJ ↔ Member 多対多
interface ProjectMember {
  project_id: string;
  member_id: string;
  created_at: Date;
}
```

### 3-3. Task層（AI管理）

```typescript
interface Task {
  id: string;
  name: string;
  project_id: string | null; // ← NULL許可（ToDo単独紐づけの場合はnull）
  todo_id: string | null;    // ← ToDoへの紐づき（任意）。project_idと併用可
  assignee_member_id: string;
  status: 'todo' | 'in_progress' | 'done';
  priority?: 'high' | 'mid' | 'low';
  start_date?: Date;
  due_date?: Date;
  estimated_hours?: number;
  comment?: string;         // URL・ネットワークパスを含む可能性あり
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;         // 競合検知に使用
  updated_by: string;
}
```

### 3-5. マイルストーン（未実装・設計済み）

PJに紐づく期日マーカー。GanttViewで◆表示する。

```typescript
interface Milestone {
  id: string;
  project_id: string;   // 必須。所属するPJのID
  name: string;         // マイルストーン名（例："設計完了"）
  date: string;         // YYYY-MM-DD形式
  is_deleted: boolean;
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}
```

#### Supabase テーブル定義

```sql
CREATE TABLE milestones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  date        DATE NOT NULL,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT,
  deleted_at  TIMESTAMPTZ,
  deleted_by  TEXT
);
-- RLS: authenticated ユーザーのみ read/write
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all" ON milestones
  FOR ALL USING (auth.role() = 'authenticated');
```

#### 実装手順（帰宅後に実施）

1. **Supabase** でテーブル作成（上記SQL）
2. **types.ts** に `Milestone` 型を追加
3. **AppDataContext.tsx** に `milestones` データ・`saveMilestone`・`deleteMilestone` を追加
4. **store.ts** に `fetchMilestones`・`upsertMilestone`・`softDeleteMilestone` を追加
5. **GanttView.tsx** でマイルストーンを◆として描画（PJバー行の上に重ねる）
6. **AdminView.tsx** にマイルストーン管理UI（PJごとにリスト＋追加フォーム）
7. **applyProposal.ts** の milestone ケースを `needs_confirmation` に変更

#### applyProposal の milestone 実装方針

```typescript
// milestone → needs_confirmation を返す（date_changeと同じ確認フロー）
// ConfirmationDialog.action_type に "milestone" を追加する
// confirmedValues: key = milestone.id（新規の場合は仮UUID）, value = 確定した日付
```

---

### 3-4. メンバーマスタ

```typescript
interface Member {
  id: string;
  display_name: string;
  short_name: string;
  initials: string;
  teams_account?: string;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: string;
  created_at: Date;
  updated_at: Date;
  updated_by: string;
}
```

---

## 4. 削除・アーカイブ設計（確定）

### 基本方針：全層論理削除（is_deleted フラグ）

物理削除は絶対に行わない。

```typescript
// ❌ 物理削除は絶対禁止
await supabase.from('tasks').delete().eq('id', taskId);

// ✅ 論理削除
await supabase.from('tasks')
  .update({ is_deleted: true, deleted_at: new Date(), deleted_by: currentUserId })
  .eq('id', taskId);
```

### 層ごとの挙動

| 層 | 操作 | 挙動 | ダイアログ | 復元 |
|---|---|---|---|---|
| O | 削除不可・期切替 | is_current=false + archived_at記録。新Oを作成してis_current=true | なし | 参照のみ |
| KR | 論理削除 | 非表示。TFはKR欠番で残る | あり | 変更履歴から可 |
| TF | 論理削除 | 非表示。PJの紐づきのみ解除 | あり | 変更履歴から可 |
| PJ | 論理削除 | PJ＋紐づく全タスクを一括論理削除 | あり（件数表示） | 変更履歴からPJ＋タスク一括復元可 |
| Task | 論理削除 | 一覧から非表示 | あり | 変更履歴から可 |
| Member | 論理削除 | 非表示。担当タスクの assignee_member_id を null に変更 | あり（件数表示） | 変更履歴から可 |

### Objectiveの期切替フロー

```
1. 管理画面 > OKR管理 > 「新しい期に切り替える」ボタン
2. 現行のO・KR・TF全体をアーカイブ（is_current=false, archived_at=now）
3. 新しいOのタイトルと期ラベルを入力して作成（is_current=true）
4. 過去の期は管理画面「過去の期を見る」から参照のみ可能
```

---

## 5. 同時編集の競合制御（確定）

### 方針：updated_at による競合検知

対象画面：タスク編集・PJ編集・管理画面（OKR/TF/PJ/Member）・カンバンのステータス変更

```typescript
// 保存時のSQL（Supabase）
const { data, error } = await supabase
  .from('tasks')
  .update({ ...updateData, updated_at: new Date(), updated_by: currentUserId })
  .eq('id', taskId)
  .eq('updated_at', originalUpdatedAt); // 開いた時点のupdated_atと一致する場合のみ更新

// 0件更新 = 競合発生 → 警告を表示
```

### 警告メッセージ

```
⚠ このタスクは保存できません

[更新者名]が[相対時間]前に「[フィールド名]」を変更しました。
最新の内容を確認してから再度編集してください。

[最新の内容を見る]　[それでも上書きする]
```

「それでも上書きする」を選択した場合は updated_at チェックなしで強制保存し、変更履歴に「競合上書き」フラグを残す。

---

## 6. AI連携設計（確定）

### 6-1. 絶対的な禁止事項

```typescript
// ❌ 絶対禁止
const payload = { okr: objective, krs: keyResults, tfs: taskForces };
const payload = { contribution_memo: pj.contribution_memo }; // KR情報漏洩

// ❌ APIキーをクライアントに露出させる
const response = await fetch("https://api.anthropic.com/v1/messages", {
  headers: { "x-api-key": "sk-ant-..." } // ブラウザに露出する
});

// ✅ 正しい経路
// クライアント → Supabase Edge Function（ai-consult） → Anthropic API
```

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
  projects: AIProject[];             // pj_purpose のみ。contribution_memoは含めない
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
// risk・no_tasks・deadline_risk → appendTaskComment（2ステップSELECT+UPDATE）
//   supabase.rpc()は使わない。アプリ側で追記ロジックを実装する。
//
// scope_reduce・pause → 論理削除（is_deleted=true）
//
// milestone → 現在未対応。errorを返す。
//   マイルストーンテーブルの設計完了後にneeds_confirmationに変更する。
```

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
// 以下をexportする
return { callState, session, tokenStatus, loadingMessage, shortIdMap, submit, reset };

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

## 7. 変更履歴の設計

### 管理画面の変更履歴（2週間保存）

```typescript
interface AdminChangeLog {
  id: string;
  layer: 'objective' | 'kr' | 'tf' | 'project' | 'member';
  action: 'create' | 'update' | 'delete' | 'restore' | 'period_switch';
  target_id: string;
  target_name: string;
  diff: Record<string, { before: unknown; after: unknown }>;
  performed_by: string;
  performed_at: Date;
  is_conflict_override: boolean;
}
// 保存期間：performed_at < NOW() - INTERVAL '14 days' のレコードは定期削除
```

### タスク変更履歴（最低限）

```typescript
interface TaskChangeLog {
  task_id: string;
  updated_at: Date;
  updated_by: string;
}
```

---

## 8. 画面一覧と設計済みの画面

| 画面 | 状態 | 備考 |
|---|---|---|
| セットアップウィザード | ✅ 実装済み | 初回起動時のみ表示 |
| 管理画面 | ✅ 実装済み | タブ構成：タスク / PJ / メンバー / TF / OKR・KR / AI使用量。全員が編集可 |
| ダッシュボード | ✅ 実装済み | OKR進捗・今週タスク・アラート・フィルター付き |
| カンバンビュー | ✅ 実装済み | ドラッグ&ドロップ対応。タスク追加はFABに一本化（右上ボタンは廃止） |
| ガントビュー | ✅ 実装済み | PJ別・人別の2ビューモード。PJバー・マイルストーン・今日線・トグル開閉 |
| リストビュー | ✅ 実装済み | 列カスタマイズ・サイドパネル・エクスポート |
| タスク追加FAB | ✅ 実装済み | 全画面共通・右下固定。TF・ToDo・PJ・担当者・期日を設定可 |
| PJ作成モーダル | ✅ 実装済み | 3ステップウィザード |
| タスク編集モーダル | ✅ 実装済み | ToDo紐づけフィールド含む |
| AIに変更を相談パネル | ✅ 実装済み | マルチターン・5モード・確認ダイアログ |
| ConfirmationDialogModal | ✅ 実装済み | date_change/assignee確認用 |
| ツアー機能 | ✅ 実装済み | ⚠ 位置指定をpx固定→要素基準に修正が必要（技術的負債） |
| グラフビュー（ラボ機能） | ✅ 実装済み | Canvas+カスタム物理シミュレーション。サイドバーのラボセクションから起動 |

### UI/UX仕様（2026年4月確定）

- **フォント**: M PLUS Rounded 1c（Google Fonts）+ 日本語フォールバックスタック
- **カラー**: すべて `var(--color-*)` CSS変数で管理。ハードコード禁止
- **角丸**: `--radius-sm: 6px` / `--radius-md: 10px` / `--radius-lg: 16px`
- **テキストエリア**: `field-sizing: content` で自動伸縮（Chrome 123+ / Firefox 128+ / Safari 17.4+）
- **フォントサイズ切り替え**: 管理画面に小/中/大（zoom: 0.85/1/1.15）を実装
- **TFアクションボタン**: ToDo・Q移動・編集・解除を2×2グリッドに配置
- **四半期自動判定**: 現在日付から自動的に現在のQを選択（1〜3月=1Q、4〜6月=2Q等）

---

## 9. 未解決の設計論点

| 番号 | 論点 | 優先度 | 備考 |
|---|---|---|---|
| A | KRの進捗率の計算ロジック（手動 vs 自動） | 高 | ダッシュボードのバーに影響 |
| B | ツアー吹き出しの位置指定をpx固定→要素基準に変更 | 中 | Teams埋め込みでズレる |
| D | Teamsへの埋め込みに伴うウィンドウサイズ対応 | 中 | — |
| E | マイルストーン実装（設計完了・帰宅後に実施） | 中 | 下記Section 3-5参照。4ファイル変更が必要 |
| F | PDF出力の実装方法（サーバーサイド vs Print API） | 低 | 将来検討 |

---

## 10. 開発時の注意事項

### TypeScriptの型定義を徹底すること

```typescript
// ❌ any を使わない
const task: any = getTask();

// ✅ 必ず型を定義する
const task: Task = getTask();
```

### コンポーネントと関数に設計意図コメントを必ず書くこと

```typescript
/**
 * 【設計意図】
 * AIへの相談時にデータをサニタイズする関数。
 * ネットワークパスは社内機密情報の漏洩リスクがあるためAIに渡す前に除去する。
 * この関数を経由せずにコメントデータをAIに渡してはいけない。
 */
export function sanitizeComment(comment: string): string { ... }
```

### Supabase の RLS（行レベルセキュリティ）を必ず設定すること

全テーブルに `authenticated` ユーザーのみアクセス可能なRLSポリシーを設定する。

### 物理削除は絶対に実装しないこと（Section 4参照）

### useAIConsultation Hook経由でのみAIを呼ぶこと

```typescript
// ❌ 直接呼ばない
import { callAIConsultation } from "../lib/ai/apiClient";

// ✅ Hookを経由する
const { submit } = useAIConsultation(projectIds);
```

---

## 11. このドキュメントの更新ルール

- 設計変更があった場合は必ずこのファイルを更新すること
- Phase 5（実装）で判明した設計変更は Section 9（未解決論点）に追記してから対応する
- 未解決の論点が解決したら Section 9 から削除して該当Sectionに追記する
- 最終更新：2026年4月（v2.2）

---

## 12. 関連設計書ファイル一覧

| ファイル | 内容 | バージョン |
|---|---|---|
| `system_prompt_design_v3.md` | AIシステムプロンプト・ペイロード構造・エラー処理 | v3.0 |
| `api_call_design_v1.md` | APIコール設計・型定義・セッション管理 | v1.0 |
| `response_rendering_design_v1.ts` | レスポンス構造化・画面反映設計 | v1.0 |
| `it_dept_consultation.docx` | IT部門向けセキュリティ確認資料 | — |
| `cost_estimation.html` | AIコスト試算書 | — |

---

## 13. ファイル構成（実装時の配置先）

```
src/
├── lib/
│   ├── ai/
│   │   ├── types.ts              # AI連携の全型定義（AIErrorCode含む）
│   │   ├── systemPrompt.ts       # システムプロンプト定数
│   │   ├── apiClient.ts          # Claude API呼び出し（Edge Function経由）
│   │   ├── payloadBuilder.ts     # ペイロード構築・サニタイズ・shortIdMap生成
│   │   ├── responseParser.ts     # AIレスポンスのパース・バリデーション
│   │   ├── proposalMapper.ts     # AIResponse→UI表示用型への変換
│   │   ├── applyProposal.ts      # 提案のDB反映処理
│   │   └── sessionManager.ts     # 会話セッション管理（DBに保存しない）
│   └── supabase/
│       ├── client.ts             # Supabaseクライアント初期化
│       └── auth.ts               # セッション取得（getSupabaseSession）
├── hooks/
│   └── useAIConsultation.ts      # AI相談機能のReact Hook（唯一の呼び出し口）
└── components/
    ├── layout/
    │   └── MainLayout.tsx                 # メインレイアウト・ナビゲーション・QuickAddTaskModal（FAB）
    ├── consultation/
    │   ├── ConsultationPanel.tsx          # 相談パネル本体
    │   ├── ProposalCard.tsx               # 提案カード
    │   ├── ConfirmationDialogModal.tsx    # 日程・担当者変更の確認ダイアログ
    │   ├── ChatHistory.tsx                # 会話履歴表示
    │   ├── FollowUpButtons.tsx            # 次の相談候補ボタン
    │   ├── SimulationBanner.tsx           # シミュレーションモードの警告バナー
    │   ├── LoadingView.tsx                # ローディング表示
    │   └── ErrorView.tsx                  # エラー表示
    ├── gantt/
    │   └── GanttView.tsx                  # ガントビュー（PJ別・人別の2モード）
    ├── kanban/
    │   └── KanbanView.tsx                 # カンバンビュー（ドラッグ&ドロップ）
    ├── graph/
    │   └── GraphView.tsx                  # ラボ機能：関係性グラフビュー（Canvas+物理シミュレーション）
    ├── task/
    │   └── TaskEditModal.tsx              # タスク編集モーダル（ToDo紐づけフィールド含む）
    └── admin/
        └── AdminView.tsx                  # 管理画面（タスク/PJ/メンバー/TF/OKR・KR/AI使用量の6タブ）

supabase/
└── functions/
    └── ai-consult/
        └── index.ts              # Edge Function（APIキーはここにのみ存在）
```

---

*このドキュメントはClaudeとの設計セッションによって作成されました。*
