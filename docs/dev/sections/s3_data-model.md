## 3. データモデル（確定版）

### 3-1. OKR層（ラベル管理）

```typescript
interface Objective {
  id: string;
  title: string;
  period: string;          // 例："2026年度"
  is_current: boolean;     // true=現行、false=アーカイブ（部署ごとに1件が現行。Section 1.6参照）
  group_id?: string | null; // 所属部署（v2.94・2026-07-23）
  archived_at?: Date;
  created_at: Date;
  updated_at: Date;
  updated_by: string;      // member_id
}

// 【v3.03・2026-07-24】KeyResult/TaskForce/ToDoはいずれもDB側に group_id 列を持つが、
// TypeScript型（src/lib/localData/types.ts）には意図的に含めていない。BEFORE INSERT/UPDATE
// トリガー（sync_kr_group_id/sync_tf_group_id/sync_todo_group_id）が親から常に自動注入する
// ため、フロントは一切送らない（送っても無視される）。Section 1.6参照。

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
  contribution_memo?: string; // PJがどのKRにどう貢献するかのメモ（2026-05-13以降 AIに渡してもよい）
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
  todo_ids: string[];        // ← ToDoへの紐づき（複数可・任意）。project_idと併用可
  assignee_member_id: string;        // DBの主FK（先頭1人）
  assignee_member_ids: string[];     // UI専用。複数担当者。fetchCriticalData で正規化（v2.24）
  status: 'todo' | 'in_progress' | 'done' | 'on_hold' | 'cancelled'; // 5値（v2.74で保留/中止を追加）
  priority?: 'high' | 'mid' | 'low';
  start_date?: Date;
  due_date?: Date;
  estimated_hours?: number;
  comment: string;          // NOT NULL DEFAULT ''（DB制約に合わせ必須。URL・ネットワークパスを含む可能性あり）
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

### 3-6. タスク依存関係（B1：依存ゲート／B2：ガント矢印可視化／B3：自動リスケ連鎖／B4：ベースライン差分・2026-07-17実装）

PMツール化の第二機能。任意の2タスク間の先行→後続関係（v3.197で種類 FS/SS/FF/SF とずらし日数を追加＝Section 89。以下の記述は FS を前提に書かれた原文）。親子関係（parent_task_id）
とは完全に独立の別概念で、UI上も別ブロックとして表示する（混同させないことが重要なUX要件）。
段階リリースの詳細・設計判断の経緯は project_task_manage.md「機能B」参照。

```typescript
interface TaskDependency {
  id: string;
  predecessor_task_id: string; // 先に完了すべきタスク
  successor_task_id: string;   // それを待つタスク
  dep_type?: "FS" | "SS" | "FF" | "SF"; // v3.197。未設定＝FS
  lag_days?: number;           // v3.197。暦日・負＝リード。未設定＝0
  is_deleted: boolean;
  group_id?: string | null;    // マルチテナント（新規テーブルのためDB上はNOT NULL）
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
  deleted_at?: string;
  deleted_by?: string;
}
```

**ゲートの挙動（appStore.saveTask が唯一の choke point）：**
- **完了（status→"done"）**：未完了（done以外・非削除）の先行タスクが1件でもあればハードブロック。
  トースト表示＋例外を投げ、楽観更新・DB書き込みは一切行わない。
- **着手（todo→"in_progress"）**：未完了の先行タスクがあっても非ブロッキングのソフト警告トーストのみ。
  着手自体は止めない（Human-in-the-loop：完了は硬く、着手は柔らかく）。

**🔴 v3.71より前はAI提案の反映（`src/lib/ai/applyProposal.ts`・`undoApply.ts`）だけがこの
choke pointを経由していなかった**（`supabase.from(...)`を直接呼ぶ独自実装。実ユーザーでも
ゲストでも同じ）。そのためB1（本節）・B3（自動リスケ連鎖）・B4（ベースライン捕捉）がAI提案
経由の変更にだけ効かないという食い違いがあった。v3.71で`useAppStore.getState()`の
アクション（`saveTask`/`saveProject`/`deleteTask`/`restoreTask`/`deleteProject`/`restoreProject`）
経由に統一し、ゲスト分岐も appStore 側の既存の `isGuestMode()` 分岐にそのまま乗るようにした
（専用の `guestApplyStore.ts` は不要になり撤去）。複数タスク・複数PJを対象にする提案は
1件ずつ choke point を通すため、書き込みはトランザクションではなく、一部だけがB1ゲート等で
弾かれても他の項目は反映を続ける（成功分はUndo対象に積み、失敗分は`ApplyResult.warning`で
利用者に知らせる。全滅時のみ`type:"error"`）。日付変更でB3の自動リスケ連鎖が発生した場合は
既存のトースト（「N件のタスクの日付を自動調整しました」＋Undo）がそのまま出る（B3専用の
通知をAI提案側に追加する必要はない）。

**循環防止**：DB制約では「A→B→…→A」を表現できないため、追加操作は必ず
`lib/dependencies/cycleCheck.ts` の `canAddDependency`（DFS）を通す。自己依存・重複も同時に弾く。

**B2：ガント矢印可視化（デスクトップ GanttView のみ）**：先行バー右端→後続バー左端を直角エルボー
（逆方向はS字迂回）で結び、矢じり付きで描画する。行のY座標を数式で再計算せず、`data-task-id` 属性
付きのバー要素を `getBoundingClientRect()` で実測する設計（PJ別/ToDo別/人別×折りたたみ×フィルタの
全組合せに対してレイアウトロジックを二重化しないため）。純粋関数は
`src/components/gantt/ganttDependencyArrows.ts`（`buildDependencyElbowPoints`／`pointsToPathD`／
`computeDependencyRenders`）。依存の相手が画面外（フィルタ除外・折りたたみ・別グループ）のときは
矢印を描かず、見えている側のバーに⏱バッジ（ツールチップで相手タスク名）を出す。`hoveredTaskId`に
接続する矢印だけ強調。ツールバーの「🔗依存」トグル（既定ON・`KEYS.GANTT_SHOW_DEPS`）で表示/非表示
切替可。`GanttMobileView`とAI提案プレビュー（`isPreview`）は対象外。

**B4：ベースライン差分（当初計画 vs 実際）**：`tasks.baseline_start_date`/`baseline_due_date`
（nullable date列）。捕捉タイミングは「`start_date`・`due_date`が初めて両方揃った時点」の1回のみ。
`src/lib/baseline/baselineCapture.ts`の`resolveBaselineFields`（純粋関数）が「凍結すべきか／既存の
凍結値を維持すべきか」を判定し、`appStore.saveTask`（B1と同じ choke point）から呼ぶ。一度セットされ
たら二度と自動上書きしない（日付をクリアしても凍結値は残る）。暦日計算（土日祝を飛ばさない）。既存
タスクで両日付が既に揃っている行はマイグレ適用時点の値をバックフィル済み（＝以後の変更だけが遅延と
して計測される）。可視化は`src/components/gantt/ganttUtils.ts`の`calcGhostBar`（baseline日付を差し
込んで`calcTaskBar`を呼ぶだけ）・`computeDelayDays`（暦日差。正=遅延・負=前倒し）・
`formatDelayLabel`。ガントの`TaskBarRow`が薄い破線アウトラインのゴーストバー（実バーより下の層）と
「遅延◯日」/「◯日前倒し」ラベルを描画。ツールバーの「▤ベースライン」トグル（既定ON・
`KEYS.GANTT_SHOW_BASELINE`）で表示/非表示切替可。`GanttMobileView`は対象外。手動での再ベースラインUI
は無い（自動捕捉のみ）。

**B3：自動リスケジュール連鎖（constraint-only push）**：先行タスクの（更新後の）期日が後続タスクの
開始日を追い越した時だけ、後続を「ぶつからない位置まで」後ろ倒しする。余裕があるタスクは動かさない
（同日開始は可＝ギャップ強制なし）。押す方向のみ（先行が前倒しになっても後続を自動で引き寄せない）。
複数先行は全先行の期日の最大値で判定。純粋関数は`src/lib/dependencies/reschedule.ts`の
`computeCascadeShifts`（origin＝編集されたタスクから辿れる後続群をBFSで収集し、Kahnのアルゴリズムで
トポロジカル順に並べてから1パスで全シフトを一括計算。保存が保存を呼ぶ無限ループを避ける）。
後続に開始日・期日のどちらか無いタスクはスキップ（FS計算・作業期間保持ができないため）。
`appStore.saveTask`（B1・B4と同じ choke point）で、ローカル編集の永続化後・due_dateが実際に変化した
時だけ呼ぶ（renameなど無関係編集でのサプライズ発火を防ぐ）。シフトは`{ skipCascade: true }`付きで
saveTask経由で適用（再cascade抑止のガード。第2引数`options?: { skipCascade?: boolean }`は省略時
false＝通常のローカル編集）。動いた件数をまとめて1つのトースト「N件のタスクの日付を自動調整しました」
＋「元に戻す」で通知、Undoも`skipCascade: true`で全タスクを旧日付に復元する（Undo自体は再cascadeしない）。
**トリガはローカルユーザーの編集のみ**：realtimeで他クライアントの変更を受信したとき
（`applyRemoteChange`）はstateを直接更新する別経路のため、cascadeは一切発火しない（各クライアントが
多重cascadeすると混乱するため）。多人数競合は既存の直列化saveTask経由で逐次適用し、途中の楽観ロック
競合はskip+reloadで整合回復する（トランザクションにはしない＝割り切り）。DBマイグレ不要・新規列も
作らない（「自動調整された」ことは既存のB4ゴーストバー＋「遅延◯日」表示で可視化されるため、
B3専用の永続フラグは持たない）。

**B5：ドラッグ結線（ガント上でハンドルをドラッグして依存を直接結ぶ）**：タスクバーにホバーすると
バー端の外側（右端リサイズのヒット領域とは重ならない位置）に開始/期日の2つのハンドル（円）が出る
（🔗依存トグルON時のみ）。向きの規約はFS依存固定＝**期日(due)側の端点＝先行、開始(start)側の端点＝
後続**。どちらのハンドルから引き始めても、ドロップ先が具体的なハンドルでなくバー本体（側未確定）の
ときはドラッグ元の側から自動的に逆側を補って解決する（start同士・due同士はNG）。純粋関数は
`src/lib/dependencies/linkDirection.ts`の`resolveLinkDirection`。ドラッグ中はB4リサイズと同じ
window mousemove/mouseup流儀で追従し、`document.elementFromPoint`でドロップ候補を判定・SVGで
プレビュー線を描画（無効な組み合わせは赤色化・`canAddDependency`で先読み判定）。作成自体は既存の
`addTaskDependency`をそのまま呼ぶため、自己依存・重複・循環はB1のゲート＋トーストがそのまま効く。
ドラッグ中は他のバー操作（編集モーダル・リサイズ開始）を抑制。`GanttMobileView`は対象外。

**B1/B2/B3/B4/B5のスコープ外（次フェーズ以降）**：SS/FF/SF等の依存種別・ラグ・クリティカルパス自動計算・
営業日カレンダー（土日祝考慮）は未実装。

### 3-7. 選択したタスクを複製（v3.72）

山本さんの依頼：セミナーシリーズ企画のように「第1回の工程をそのままPJ内で複製して第2回を作る」。
investigatorの調査（7製品の公式ドキュメント）で「期間（日付範囲）で切り取って複製する」方式は
どの製品にも存在せず、束ねる単位は「階層」「明示選択」「フォルダ／PJ全体」の3つと判明。
山本さんの判断で「明示選択」方式（Primavera P6のCopy Activity Optionsに近い）を採用した。

- **起動口**：`src/hooks/useBulkTaskActions.ts`が使う既存の複数選択（ListView/KanbanView共有）
  に「📋 複製」ボタンを追加。新しい選択方式は発明していない。
- **計算ロジックの再利用**：日付移動は`src/lib/project/inheritTaskDates.ts`の純粋関数
  （`computeInheritOffsetDays`/`computeInheritedTaskDates`）をv3.57から無改修で再利用。
  依存関係の複製（先行・後続の両方が対象内の組だけ）は`src/lib/project/taskInheritance.ts`の
  `buildInheritedDependencies`をそのまま再利用（project_idを一切参照しない汎用実装のため
  変更不要だった）。タスク本体の複製は新設の`src/lib/project/duplicateSelectedTasks.ts`
  （`buildDuplicatedTasks`/`buildDuplicatedTaskForceLinks`/`buildDuplicatedTaskProjectLinks`）
  ——`taskInheritance.ts`の`buildInheritedTasks`は1つの新規PJ（newProjectId固定）への複製を
  前提にしているため使えず（この機能は**同じPJ内**で複製する＝project_idは複製元のまま保つ）、
  専用に用意した。
- **引き継ぐ／リセットする**：タスク名（名前の一括置換を任意で適用）・担当者・優先度・
  見積工数・コメント・PJ紐づけ（project_idそのまま）・TF紐づけ（`task_task_forces`）・
  追加PJ紐づけ（`task_projects`）・ToDo紐づけ（`todo_ids`）・タグは引き継ぐ。ステータスは
  `todo`にリセット・完了関連は`appStore.saveTask`の choke point が自動でクリアする。
  ベースライン（B4）・`finalized_mentions`は意図的に複製せず、複製後のタスクとして
  改めて捕捉・空の状態にする。
- **親子関係が選択範囲をまたぐ場合**：子だけ選択・親は未選択なら、複製後は親を持たない
  独立したトップレベルタスクになる（`buildInheritedTasks`と同じ既存の判断を踏襲）。
  親だけ選択・子は未選択なら、その子は複製されない（「選択していないものは増えない」を
  一貫させ、利用者が驚かない動作にした）。どちらの場合もモーダルの「複製対象の確認」に
  件数を明示する。
- **マイルストーンは複製対象にしない**：選択の起点がタスク選択のみで、マイルストーンを
  選ぶ既存UIが無いため（追加すると主要ユースケースから外れる）。一方、日付の基準
  （アンカー）の選択肢には、選択したタスクが単一PJに閉じている場合のみ、そのPJの
  マイルストーンも含める。
- **保存順序とB3対策**：`ProjectCreateModal`の「他PJから引き継ぐ」と同じ順序（親を先に
  `saveTask({skipCascade:true})`→成功したIDだけで子を保存→両端が保存成功したタスクだけを
  `addTaskDependency`→最後にTF/PJ紐づけを`addTaskTaskForce`/`addTaskProject`で追加）。
  `skipCascade:true`は、複製直後の新タスクはまだ依存関係を持たずB3は本来空振りするが、
  一括作成系（`ProjectCreateModal`・`runBulkShift`）と同じ防御的な付与として揃えた。
  トランザクションではないため個々の保存の失敗は他を止めず、成功件数・失敗件数をトーストで
  知らせる（`alertDialog`／`window.alert`は使わない）。
- **UI**：`src/components/task/DuplicateTasksModal.tsx`。Section 21の契約
  （`modalStyles.ts`）に従う。プレビュー・名前置換は任意入力欄で、確定前に必ず表示する。

---
