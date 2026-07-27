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
import type { Member, Project, Task, ViewMode } from "../localData/types";

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
    // OKR系は必要になった段階で足す（最初から全部渡さない）
  };
  /** 副作用はここに列挙したものだけ。ウィジェットが直接DBを触ることはない（choke point迂回防止） */
  actions: {
    openTask: (taskId: string) => void;
    navigateTo: (view: ViewMode) => void;
  };
  /** このインスタンス固有の設定（configSchema で編集される） */
  config: Record<string, unknown>;
  /** 自分の設定を書き換える（メモウィジェット等） */
  setConfig: (next: Record<string, unknown>) => void;
}

/** 設定フォームの1項目（Phase 2 の configSchema 駆動フォームで使用。Phase 1 は未使用） */
export interface WidgetConfigField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "boolean" | "projectMultiSelect";
  options?: { label: string; value: string }[];
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
  dataNeeds: Array<"tasks" | "projects" | "members" | "okr">;
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
