// src/lib/widgets/types.ts
//
// 【設計意図】
// マイページ（ウィジェット機能）の型定義。DOM・zustand store・コンポーネント層に一切依存しない
// 純粋な型のみを置く（このファイルはコンポーネントを import しない層構造を守る。詳細は
// docs/dev/mypage-widgets-design.md）。
//
// 最重要の契約：ウィジェットは WidgetContext だけを唯一の入口としてデータ・副作用を得る。
// useAppStore を直接呼んだり saveTask を直接叩いたりしてはいけない（ホスト＝MyPageViewが
// 部署スコープの担保・書き込みの choke point 迂回防止を1箇所に集約する責任を持つため）。

import type { ComponentType } from "react";
import type { Member, Project, Task, TaskDependency, ViewMode } from "../localData/types";

/** ウィジェットの表示サイズ。1/2/3 カラム分 */
export type WidgetSize = "s" | "m" | "l";

/**
 * ウィジェットに渡される唯一の入口。
 * ウィジェットはこれ以外の経路（useAppStore・supabase クライアント等）でデータ・書き込み手段を
 * 得てはならない。
 */
export interface WidgetContext {
  currentUser: Member;
  /** 部署スコープ済み・論理削除除外済み。読み取り専用（ホストが1回だけ購読して渡す） */
  data: {
    tasks: readonly Task[];
    projects: readonly Project[];
    members: readonly Member[];
    /** B1依存ゲートと同じ getIncompletePredecessors を使うウィジェット向け（Phase 2で追加） */
    taskDependencies: readonly TaskDependency[];
    // OKR系は必要になった段階で足す（最初から全部渡さない）
  };
  /**
   * 副作用はここに列挙したものだけ。ウィジェットが直接DBを触ることはない（choke point迂回防止）。
   * 新しい副作用を足すときは、必ずホスト（MyPageView）側で appStore の choke point
   * （saveTask 等）を経由して実装すること。ウィジェット側に store・supabase を直接触らせる
   * 例外は作らない（docs/dev/mypage-widgets-design.md §2「actions の拡張ポリシー」参照）。
   */
  actions: {
    openTask: (taskId: string) => void;
    navigateTo: (view: ViewMode) => void;
    /**
     * タスクを1件作成する（Phase 2・QuickAddTaskWidget向け）。ウィジェットは saveTask を
     * 直接呼ばない。ホスト（MyPageView経由でMainLayout）が appStore.saveTask を呼ぶことで
     * B1依存ゲート・B4ベースライン・v2.75親自動完了などの choke point を必ず通す。
     */
    createTask: (draft: { name: string; projectId?: string | null; dueDate?: string | null }) => Promise<void>;
  };
  /** このインスタンス固有の設定（configSchema で編集される） */
  config: Record<string, unknown>;
  /** 自分の設定を書き換える（メモウィジェット等） */
  setConfig: (next: Record<string, unknown>) => void;
}

/**
 * 設定フォームの1項目（Phase 2 の configSchema 駆動フォームで使用）。
 * WidgetConfigModal（src/components/lab/widgets/WidgetConfigModal.tsx）がこの配列から
 * フォームを自動生成する。個別ウィジェット用の分岐は持たせない（型で表現しきる）。
 */
export interface WidgetConfigField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "boolean" | "projectMultiSelect" | "memberMultiSelect" | "number";
  /**
   * type="select" の選択肢。省略（未指定）時は WidgetContext.data.projects から動的に
   * 選択肢を組み立てる（PJ選択の唯一の実例＝QuickAddTaskWidget.projectId向け。
   * 静的な選択肢が必要な select フィールドは必ず options を明示すること）。
   * type="projectMultiSelect"/"memberMultiSelect" ではこのフィールドは使わない
   * （常に WidgetContext.data.projects/members から組み立てる）。
   */
  options?: { label: string; value: string }[];
  /** 項目の補足説明（ラベルの下に小さく表示） */
  description?: string;
  /** text/textarea/number 用のプレースホルダ */
  placeholder?: string;
  /** 値が無い・型が違う場合に resolveConfig が使う既定値 */
  defaultValue?: unknown;
  /** type="number" の最小値（resolveConfig がクランプする） */
  min?: number;
  /** type="number" の最大値（resolveConfig がクランプする） */
  max?: number;
}

export interface WidgetDefinition {
  /** 安定ID。レイアウトはこれで参照するので、公開後は絶対に変えない */
  id: string;
  title: string;
  description: string;
  /** 絵文字1個（tour-guidelines.md の作法に合わせる） */
  icon: string;
  defaultSize: WidgetSize;
  allowedSizes: WidgetSize[];
  /**
   * 何を読むかの宣言。Phase 1 では表示に使わないが、必ず書かせる。
   * Phase 4 で外部ウィジェットを受け入れるとき「これは tasks しか読まない」を機械的に
   * 提示・強制するための土台。後から全ウィジェットに遡って足すのは苦痛なので最初から
   * 全ウィジェットに書かせる（docs/dev/mypage-widgets-design.md §2-2）。
   */
  dataNeeds: Array<"tasks" | "projects" | "members" | "dependencies" | "okr">;
  /** 設定フォームの自動生成（Phase 2 で使用。Phase 1 は未設定でよい） */
  configSchema?: WidgetConfigField[];
  render: ComponentType<WidgetContext>;
}

export interface WidgetInstance {
  /** uuid。同じウィジェットを複数置ける（PJ別に3枚など） */
  instance_id: string;
  /** WidgetDefinition.id */
  widget_id: string;
  size: WidgetSize;
  config: Record<string, unknown>;
}

export interface MyPageLayout {
  /** 将来の形式変更に備える */
  version: 1;
  /** 配列順＝表示順 */
  widgets: WidgetInstance[];
}
