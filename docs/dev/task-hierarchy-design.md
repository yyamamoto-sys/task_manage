# タスク階層化（PJ ＞ 大タスク ＞ 小タスク）設計仕様

> タスクを2階層（大タスク＝親 / 小タスク＝子）で管理できるようにする機能の設計。
> 実装前の合意ドキュメント。実装は段階的に行う。
>
> 確定日：2026-05-27（深さ=2階層固定 / 親は子から自動算出 / DnD=dnd-kit / ListからMVP、で合意）

## 0. 確定した方針

| 項目 | 決定 |
|---|---|
| 階層の深さ | **2階層固定**（大>小）。小タスクはさらに子を持てない。 |
| 大タスクの進捗・完了 | **子から自動算出**（全子done→done、混在→in_progress、全todo→todo。進捗%は葉タスク基準）。 |
| 並べ替え | **dnd-kit** を導入し、ネスト並べ替え・親子移動に対応。 |
| 初期スコープ | **List＋作成/編集でMVP** → 順次 並べ替え→Gantt→Kanban/AI。 |

「大タスク」は専用エンティティを作らず、**子を持つ Task** というだけ（既存タスクにぶら下げる＝親を指定する、が自然に実現）。

---

## 1. データモデル

### tasks への追加列
- `parent_task_id text NULL REFERENCES tasks(id)`：null=大タスク（最上位）/ 値あり=小タスク。
- `display_order integer NOT NULL DEFAULT 0`：同じ親（またはPJ直下の最上位）内での手動並び順。DnD・上下移動で更新。

### 制約・ルール（2階層固定）
- 自己参照禁止：`parent_task_id != id`（アプリ側で担保）。
- **孫を作らない**：`parent_task_id` を持つタスク（=小タスク）は親になれない。
  - 親候補に出すのは「同一PJ内の最上位タスク（parent_task_id IS NULL かつ子を持てる）」のみ。
  - DnD/AIでも、子を持つタスクを他タスク配下へ入れる・小タスクの配下に入れる操作は不可。
- 親子は**同一 project_id 内**に限定（PJ跨ぎの親子は作らない）。

### マイグレーション
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id text REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
-- 既存タスクの display_order を created_at 順でバックフィル（PJ単位の連番）
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at) AS rn
  FROM tasks WHERE is_deleted = false
)
UPDATE tasks t SET display_order = ordered.rn FROM ordered WHERE ordered.id = t.id;
```
（未適用でも parent_task_id=undefined＝全タスク最上位扱いで動作。読み取りは壊れない。）

### 型（types.ts）
```ts
interface Task {
  // ...既存...
  parent_task_id?: string | null;
  display_order?: number;
}
```

---

## 2. 進捗・ステータスの自動算出（ロールアップ）

共通ヘルパー（例 `src/lib/taskHierarchy.ts`）に集約：
- `childrenOf(tasks, parentId)` / `isParent(task, tasks)` / `leafTasks(tasks)`。
- **親ステータス**：子が1件以上ある親は、子から導出（全done→done / 1つでもin_progress or done混在→in_progress / 全todo→todo）。親のステータスは**手動編集不可（表示は導出値）**。子が無いタスクは従来どおり手動。
- **進捗%（Dashboard / PJカルテ / KR）**：**葉タスク（子を持たないタスク）基準**で done/total を数える。親は二重計上しない。親行には「子 n/m 完了」を表示。
- 親の `due_date`：手動のまま（グループの目安）。自動上書きはしない（将来オプション）。
- 親の completed_at：導出で done になった時点。

---

## 3. UI/UX

### 3-1. リスト（MVP の主役）
- 既存 `groupBy`（project/assignee/status）に加え、**親タスクで折りたたみ表示**（最上位タスク→その子をインデント）。トグル開閉状態は localStorage 永続化（既存パターン流用）。
- 親行：導出ステータス＋「子 n/m・◯%」バッジ＋進捗バー。子行：インデント＋通常の編集。
- 各最上位行に「**＋ 子タスク**」アクション（親を確定した状態でクイック追加）。
- 親のステータス手動変更は無効化（子から算出のため）。

### 3-2. 並べ替え（dnd-kit・後フェーズ）
- `@dnd-kit/core` + `@dnd-kit/sortable`（+ modifiers）を導入。
- 操作：(1) 同階層での並べ替え（display_order 更新）、(2) 別の大タスク配下へ移動（parent_task_id 更新）、(3) 大タスク化/解除（parent を外す/付ける）。
- 2階層制約をDnD中に強制（小タスクの配下や、子を持つタスクの中へはドロップ不可。視覚的に不可を示す）。

### 3-3. 作成・編集
- QuickAddTaskModal / TaskEditModal / TaskSidePanel に「**親タスク**」選択（検索付き CustomSelect。候補＝同一PJの最上位タスクのみ）。
- リスト行の「＋子タスク」から親を prefill。

### 3-4. ガント（後フェーズ）
- 大タスク行→子タスク行のネスト（PJの開閉に加え大タスクでも開閉）。大タスクバーは子の期間レンジを内包表示。

### 3-5. カンバン（後フェーズ）
- 子タスクもカード表示し、カードに「親タスク名」バッジ＋（親カードには子件数）。親のステータス列は導出に従い移動（手動移動は子で行う）論点は実装時に詰める。

### 3-6. AI（後フェーズ）
- `add_task`：`parent_task_id`（親タスクの shortId か名前）を受けて子として追加。
- `add_project`：`new_project_tasks` の各要素に任意の `subtasks`（1階層）を許可し、大>小のたたき台を提案。

---

## 4. 影響範囲（要改修）

| 箇所 | 内容 |
|---|---|
| types.ts / schema.sql / store | parent_task_id・display_order 追加（saveWithLock はそのまま流用可） |
| ListView | 親子ツリー表示・トグル・子タスク追加（MVP） |
| Dashboard / ProjectKarte / payloadBuilder | 進捗%を**葉タスク基準**に（親を二重計上しない） |
| GanttView | 大タスク→子のネスト描画（後） |
| KanbanView | 子カードの親バッジ・移動の扱い（後） |
| QuickAdd / TaskEdit / TaskSidePanel | 親タスク選択（MVP） |
| applyProposal / ConfirmationDialogModal | add_task の親指定・add_project の subtasks（後） |

---

## 5. 段階実装プラン

- **Phase 1（MVP）**：マイグレーション＋型＋store素通し／作成・編集での親子付け／Listの親子ツリー表示＋トグル＋「＋子タスク」／親ステータス・進捗の自動算出（List と Dashboard/PJ% を葉基準に）。
- **Phase 2**：dnd-kit 導入。Listで並べ替え・親子移動・大タスク化/解除。
- **Phase 3（子の判別表示まで完了・2026-05-29）**：ガントのネスト描画。PJ別ビューで子タスクを親直下に並べ、ラベルをインデント＋「↳」表示、親に「子N」バッジ、子バーを細く（高さ18→12）して親と区別。共通ヘルパー `orderTasksHierarchically` でラベル列とバー列の行順・行数を一致させる。人別ビュー・モバイルカードは子名に「↳」プレフィックスのみ。**未**：大タスクバーが子の期間レンジを内包表示／大タスクの開閉トグル／DnD でのネスト並べ替え。
- **Phase 4（子の判別表示まで完了・2026-05-29）**：カンバンの親バッジ。子カードに「↳ 親タスク名 の子タスク」、親カードに「子N」チップ。**未**：親ステータスの導出に従ったカード移動・AI（add_task 親指定・add_project subtasks）。

各フェーズは独立コミットで検証（tsc/test/build）。Phase 1 のマイグレーションは Supabase へ手動適用が必要（未適用でも読み取りは安全動作）。

---

## 5.5 再利用・ベストプラクティス（統合コストを下げる方針）

新規の並行構造を作らず、既存モジュール・パターンに寄せる。四半期判定の二の舞（各所で再実装→混入）を避け、**派生値は保存せず単一ヘルパーに集約**する。

1. **`src/lib/taskHierarchy.ts` を唯一の真実に**：`childrenOf(tasks, parentId)` / `isParent(task)` / `leafTasks(tasks)` / `rollupStatus(parent, children)` / `parentProgress(children)` / `eligibleParents(tasks, projectId)`（2階層制約・親候補抽出）を集約。List・Dashboard・ProjectKarte・payloadBuilder・AI・DnD は**すべてこのヘルパー**を使う（各所で再実装しない）。
2. **進捗% は `src/lib/stats.ts` の `calcProgressPct` を再利用**（新しい計算式を作らない）。
3. **親タスク選択UIは既存の検索付き `CustomSelect`**（候補＝同一PJの最上位タスク）。新しいドロップダウンを作らない。
4. **保存は既存 zustand `saveTask`→`saveWithLock`（楽観ロック）をそのまま**。Task に2列を足すだけで素通り。新CRUD経路を作らない。
5. **リストのグループ表示は既存 `groupBy`＋localStorage 永続パターンを拡張**（並行のツリー実装を別途作らない）。トグル開閉状態の保存も既存 KEYS パターンに倣う。
6. **dnd-kit は「並べ替え可能リスト」を汎用フック/コンポーネント化**し、将来 TF順・ToDo順など他の並べ替えにも再利用できる形にする（このタスクツリー専用の一回限りにしない）。既存 Kanban の HTML5 DnD は別物だが、将来 dnd-kit へ寄せれば統一可（任意）。
7. **既存共通部品を流用**：Avatar / 進捗バー / バッジ / `formatMD` / `currentQuarter` / `effectiveTfQuarter` 等。重複定義を作らない（必要なら共通化してから使う）。
8. **派生値は state に保存しない**：親のステータス・進捗は `tasks` から都度算出（`effectiveTfQuarter` と同じ「派生は関数で」方針）。DBに親ステータス列を持たせない。
9. **ToDo層（TF>ToDo>Task）との将来統合余地**：taskHierarchy ヘルパーの集計I/Fを汎用に保ち、将来 ToDo 集計も同じ関数に寄せられるようにする（当面は併存・無理に統合しない）。
10. **AI連携**：`add_task` の親指定・`add_project` の subtasks も、上記ヘルパーと既存の確認ダイアログ/Undo の流儀に統合（新フローを作らない）。

## 6. 未決・実装時に詰める点
- 親の due_date 自動算出（子の最大期日）をオプションで入れるか。
- カンバンで親カードと子カードの見せ方（集約 vs 個別）。
- 将来、OKR側の ToDo 層（TF>ToDo>Task）と parent_task の統合可否（当面は併存）。
