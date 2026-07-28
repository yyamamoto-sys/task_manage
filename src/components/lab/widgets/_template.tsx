// src/components/lab/widgets/_template.tsx
//
// 【これは何か】
// マイページ用ウィジェットの雛形。このファイルはコピーして新しいウィジェットを作るための
// テンプレートで、それ自体はレジストリ（registry.ts）に登録していないため画面には出ない
// （ビルド対象には入るので tsc/eslint の対象にはなる＝このファイル自身が壊れていないことは
// 常に保証される）。
//
// 作り方の手順は docs/dev/widget-authoring.md を読むこと（このコメントは最小限）。
// 「👉 ここを変える：」と書かれた場所を実際の中身に差し替え、ファイル名・コンポーネント名を
// リネームしてから、ファイル末尾のコメントを参考に registry.ts へ1行登録する。

import { useMemo } from "react";
import type { WidgetConfigField, WidgetContext } from "../../../lib/widgets/types";
import { resolveConfig } from "../../../lib/widgets/config";
import { isAssignedTo, suppressOverdue } from "../../../lib/taskMeta";
import { formatMD } from "../../../lib/date";

// 👉 ここを変える：設定項目が要らないウィジェットなら、この配列ごと・
// WidgetDefinition.configSchema の指定ごと削除してよい（Phase 1 のウィジェット群がその例）。
// 設定を持たせる場合は、この配列がそのままフォームとして自動生成される（詳しくは
// docs/dev/widget-authoring.md の「configSchema の全type一覧」参照）。
export const TEMPLATE_WIDGET_CONFIG_SCHEMA: WidgetConfigField[] = [
  { key: "limit", label: "表示件数", type: "number", defaultValue: 5, min: 1, max: 30 },
];

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "8px", width: "100%",
  padding: "5px 8px", borderRadius: "var(--radius-md)",
  border: "none", background: "var(--color-bg-secondary)",
  cursor: "pointer", textAlign: "left",
};

const nameStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, fontSize: "12px", color: "var(--color-text-primary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};

const emptyStyle: React.CSSProperties = {
  fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "10px 0",
};

// 👉 ここを変える：コンポーネント名（実装したいウィジェットの名前に。例：MyNewWidget）
export function TemplateWidget({ currentUser, data, config, actions }: WidgetContext) {
  // 👉 ここを変える：configSchema を持たせない場合はこの2行ごと削除し、
  // limit は固定値（例：5）に置き換える
  const resolved = resolveConfig(TEMPLATE_WIDGET_CONFIG_SCHEMA, config);
  const limit = resolved.limit as number;

  // 👉 ここを変える：表示したいデータの絞り込み条件。ここでは「自分が担当している、
  // まだ終わっていないタスク」を例にしている。新しい集計ロジックを自分で書く前に、まず
  // src/lib/taskMeta.ts・src/lib/taskHierarchy.ts・既存の他ウィジェット（PinnedProjectsWidget・
  // RecentlyUpdatedWidget 等）に同じ絞り込みが無いか確認すること（真実の源の二重化を避ける）。
  const tasks = useMemo(() => {
    return data.tasks
      .filter(t => isAssignedTo(t, currentUser.id) && !suppressOverdue(t.status))
      .slice()
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
      .slice(0, limit);
  }, [data.tasks, currentUser.id, limit]);

  // 👉 ここを変える：データが0件のときの文言
  if (tasks.length === 0) {
    return <div style={emptyStyle}>表示できるタスクはありません</div>;
  }

  // 👉 ここを変える：一覧の描画。行クリックは actions.openTask を呼ぶだけにする
  // （saveTask 等を直接呼ばない。書き込みが必要な場合は docs/dev/widget-authoring.md
  // 「副作用（書き込み）を増やしたいとき」を読むこと）
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {tasks.map(t => (
        <button key={t.id} onClick={() => actions.openTask(t.id)} style={rowStyle}>
          <span style={nameStyle}>{t.name}</span>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
            {t.due_date ? formatMD(t.due_date) : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

// 👉 ここを変える：ファイルをリネームしたら、registry.ts に以下のような1行を追記する
// （実際に貼るときは import 文も忘れずに。詳しくは docs/dev/widget-authoring.md 「5分で1個作る手順」）。
//
// import { TemplateWidget, TEMPLATE_WIDGET_CONFIG_SCHEMA } from "./MyNewWidget";
//
// export const WIDGET_REGISTRY: WidgetDefinition[] = [
//   // ...既存のウィジェット定義...
//   {
//     id: "my-new-widget",              // 安定ID。公開後は絶対に変えない
//     title: "新しいウィジェット",
//     description: "何を表示するウィジェットか一言で",
//     icon: "🆕",                        // 絵文字1個
//     defaultSize: "m",
//     allowedSizes: ["s", "m", "l"],     // 必ず defaultSize を含める
//     dataNeeds: ["tasks"],              // 実際に使うデータだけを正直に書く
//     configSchema: TEMPLATE_WIDGET_CONFIG_SCHEMA, // 設定不要なら削除
//     render: TemplateWidget,
//   },
// ];
