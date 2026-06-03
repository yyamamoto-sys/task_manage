# モジュール A：計画ビュー（dashboard ほか）

> PJ・タスク・マイルストーンを**見る/編集する**画面群（計画モード）。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「A 計画ビュー」。

## このモジュールに含まれる画面（複数フォルダ）
| 場所 | 役割 |
|---|---|
| `components/dashboard/DashboardView.tsx` | 計画モードのトップ。今週の自分のタスク・期限アラート・PJ進捗 |
| `components/dashboard/ProjectKarte.tsx` | PJ選択時のカルテ＋**E PJ別AI分析**の起動口 |
| `components/dashboard/OnboardingHome.tsx` | 初回向けホーム |
| `components/gantt/GanttView.tsx` | ガント（PJ別/人別）。タスクバー・◆マイルストーン（クリックで編集） |
| `components/kanban/KanbanView.tsx` | カンバン（D&Dでステータス変更） |
| `components/list/ListView.tsx` | リスト（絞込・CSV・子タスクツリー・一括操作） |
| `components/task/*` | タスク編集モーダル類（→ `task/README.md`） |
| `components/milestone/*` | マイルストーン（→ `milestone/README.md`） |

## 改修・バグ探しの注意点
- 表示は**すべて `appStore` から読む**（`useAppStore(s => s.tasks)` 等）。データがおかしい時はまずデータ基盤を疑う。
- フィルタの罠：サイドバーで**PJ選択中はそのPJにスコープ**される（孤児タスク〔project_id=null〕はPJ別ガントに出ない／リストは「プロジェクト未設定」に出る）。
- 追加導線は **FAB（右下＋）**＝`MainLayout` 管理（タスク追加/マイルストーン追加/AI相談）。
- ガントの◆はクリックで `MilestoneEditModal`、ホバーでメモ表示。
