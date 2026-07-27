// src/components/lab/widgets/registry.ts
//
// 【設計意図】
// 「どんなウィジェットが存在するか」の一覧を1箇所で保持する（レジストリ）。型
// （WidgetDefinition 等）は lib 側（src/lib/widgets/types.ts）に置き、レジストリ自体は
// コンポーネント層に置く（lib からコンポーネントを import しない層構造を守るため）。
// ウィジェットを1個足すときは、③に1ファイル追加＋ここに1行登録するだけで済む。
//
// defaultSize は src/lib/widgets/layout.ts の DEFAULT_WIDGET_ENTRIES（既定レイアウトが
// 使う5ウィジェット分）と値を一致させること（layout.ts 側のコメント参照）。

import type { WidgetDefinition } from "../../../lib/widgets/types";
import { MyWeekTasksWidget } from "./MyWeekTasksWidget";
import { AlertTasksWidget } from "./AlertTasksWidget";
import { MyWorkloadWidget } from "./MyWorkloadWidget";
import { DueForecastWidget } from "./DueForecastWidget";
import { VelocityWidget } from "./VelocityWidget";
import { MemoWidget, MEMO_CONFIG_SCHEMA } from "./MemoWidget";
import { PinnedProjectsWidget, PINNED_PROJECTS_CONFIG_SCHEMA } from "./PinnedProjectsWidget";
import { RecentlyUpdatedWidget, RECENTLY_UPDATED_CONFIG_SCHEMA } from "./RecentlyUpdatedWidget";
import { BlockedTasksWidget } from "./BlockedTasksWidget";
import { QuickAddTaskWidget, QUICK_ADD_TASK_CONFIG_SCHEMA } from "./QuickAddTaskWidget";

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  {
    id: "my-week-tasks",
    title: "自分の今週のタスク",
    description: "自分が担当する、今週締切のタスク一覧",
    icon: "📌",
    defaultSize: "m",
    allowedSizes: ["s", "m", "l"],
    dataNeeds: ["tasks"],
    render: MyWeekTasksWidget,
  },
  {
    id: "alert-tasks",
    title: "期限超過・滞留",
    description: "期限を過ぎた、または長く動きのないタスク",
    icon: "🔥",
    defaultSize: "m",
    allowedSizes: ["s", "m", "l"],
    dataNeeds: ["tasks"],
    render: AlertTasksWidget,
  },
  {
    id: "my-workload",
    title: "自分の負荷",
    description: "自分が抱えているタスクの件数・工数",
    icon: "👥",
    defaultSize: "s",
    allowedSizes: ["s", "m", "l"],
    dataNeeds: ["tasks", "members"],
    render: MyWorkloadWidget,
  },
  {
    id: "due-forecast",
    title: "締切の見通し",
    description: "今後2週間の締切件数の見通し（棒グラフ）",
    icon: "📊",
    defaultSize: "l",
    allowedSizes: ["m", "l"],
    dataNeeds: ["tasks"],
    render: DueForecastWidget,
  },
  {
    id: "velocity",
    title: "完了ペース",
    description: "直近8週間の完了タスク数の推移（折れ線グラフ）",
    icon: "📈",
    defaultSize: "l",
    allowedSizes: ["m", "l"],
    dataNeeds: ["tasks"],
    render: VelocityWidget,
  },
  {
    id: "memo",
    title: "メモ",
    description: "自分だけのフリーテキストメモ",
    icon: "📝",
    defaultSize: "s",
    allowedSizes: ["s", "m", "l"],
    dataNeeds: [],
    configSchema: MEMO_CONFIG_SCHEMA,
    render: MemoWidget,
  },
  {
    id: "pinned-projects",
    title: "ピン留めプロジェクト",
    description: "選んだプロジェクトの進捗バー",
    icon: "⭐",
    defaultSize: "m",
    allowedSizes: ["s", "m", "l"],
    dataNeeds: ["tasks", "projects"],
    configSchema: PINNED_PROJECTS_CONFIG_SCHEMA,
    render: PinnedProjectsWidget,
  },
  {
    id: "recently-updated",
    title: "最近更新されたタスク",
    description: "updated_at の新しい順にタスクを表示",
    icon: "🕒",
    defaultSize: "m",
    allowedSizes: ["s", "m", "l"],
    dataNeeds: ["tasks"],
    configSchema: RECENTLY_UPDATED_CONFIG_SCHEMA,
    render: RecentlyUpdatedWidget,
  },
  {
    id: "blocked-tasks",
    title: "先行待ちのタスク",
    description: "先行タスクが未完了のため完了できない、自分の担当タスク",
    icon: "⏳",
    defaultSize: "m",
    allowedSizes: ["s", "m", "l"],
    dataNeeds: ["tasks", "dependencies"],
    render: BlockedTasksWidget,
  },
  {
    id: "quick-add-task",
    title: "クイックタスク追加",
    description: "タスク名を入力してEnterで作成",
    icon: "➕",
    defaultSize: "s",
    allowedSizes: ["s", "m", "l"],
    dataNeeds: ["tasks", "projects"],
    configSchema: QUICK_ADD_TASK_CONFIG_SCHEMA,
    render: QuickAddTaskWidget,
  },
];

export function getWidgetDefinition(id: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find(d => d.id === id);
}
