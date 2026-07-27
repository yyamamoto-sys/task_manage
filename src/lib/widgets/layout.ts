// src/lib/widgets/layout.ts
//
// 【設計意図】
// マイページのレイアウト操作を担う純粋関数群（DOM・zustand store 非依存）。ホスト
// （MyPageView）・永続化フック（useMyPageLayout）の両方から呼ばれる単一の真実源。
// いずれの関数も引数の layout を破壊せず新しいオブジェクトを返す（イミュータブル）。
//
// 【層構造の注意】このファイルはレジストリ（src/components/lab/widgets/registry.ts。
// コンポーネント層）を import しない。既定サイズは呼び出し側（MyPageView/useMyPageLayout）が
// resolveDefaultSize（= (id) => getWidgetDefinition(id)?.defaultSize）として注入する
// （Phase 2 で registry.ts の defaultSize との二重管理を解消。旧版はこのファイルが
// DEFAULT_WIDGET_ENTRIES に size も保持していたが、サイズの真実源はレジストリ1箇所に統一した）。

import type { MyPageLayout, WidgetInstance, WidgetSize } from "./types";

export const MYPAGE_LAYOUT_VERSION = 1 as const;

/** 解決できない場合のフォールバックサイズ */
const FALLBACK_SIZE: WidgetSize = "m";

/**
 * 初回ユーザー向けの既定配置（この順で固定）。widget_id のみを保持する（安定ID。
 * レジストリの WidgetDefinition.id と一致させる。公開後に変えない）。
 */
const DEFAULT_WIDGET_ENTRIES: string[] = [
  "my-week-tasks",
  "alert-tasks",
  "my-workload",
  "due-forecast",
  "velocity",
];

function defaultGenerateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // crypto.randomUUID が使えない実行環境向けのフォールバック（実運用では通らない想定）
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 初回ユーザー向けの既定レイアウトを作る。
 * @param resolveDefaultSize widget_id からレジストリの defaultSize を引く関数。解決できない
 *   （undefined を返す）場合は "m" にフォールバックする。
 * @param generateId instance_id の採番関数（省略時は crypto.randomUUID）。テストでは
 *   決定的な採番関数を注入できるようにする（CLAUDE.md v2.83 と同じ「テストしやすくするための
 *   ID採番注入」の流儀）。
 */
export function createDefaultLayout(
  resolveDefaultSize: (widgetId: string) => WidgetSize | undefined,
  generateId: () => string = defaultGenerateId,
): MyPageLayout {
  return {
    version: MYPAGE_LAYOUT_VERSION,
    widgets: DEFAULT_WIDGET_ENTRIES.map(widgetId => ({
      instance_id: generateId(),
      widget_id: widgetId,
      size: resolveDefaultSize(widgetId) ?? FALLBACK_SIZE,
      config: {},
    })),
  };
}

/** 末尾に新しいウィジェットインスタンスを追加する */
export function addWidget(
  layout: MyPageLayout,
  widgetId: string,
  size: WidgetSize,
  instanceId: string,
): MyPageLayout {
  const instance: WidgetInstance = { instance_id: instanceId, widget_id: widgetId, size, config: {} };
  return { ...layout, widgets: [...layout.widgets, instance] };
}

/** 指定インスタンスを取り除く。見つからない場合は無変更（新しいオブジェクトは返すが中身は同じ） */
export function removeWidget(layout: MyPageLayout, instanceId: string): MyPageLayout {
  return { ...layout, widgets: layout.widgets.filter(w => w.instance_id !== instanceId) };
}

/**
 * 兄弟の並べ替え（ドラッグ用）。
 * targetIndex は「対象インスタンスを一旦取り除いた後の配列」における挿入位置
 * （0..length の範囲にクランプする）。対象インスタンスが見つからない場合は無変更。
 */
export function moveWidget(layout: MyPageLayout, instanceId: string, targetIndex: number): MyPageLayout {
  const idx = layout.widgets.findIndex(w => w.instance_id === instanceId);
  if (idx < 0) return layout;
  const widgets = [...layout.widgets];
  const [moved] = widgets.splice(idx, 1);
  const clamped = Math.max(0, Math.min(targetIndex, widgets.length));
  widgets.splice(clamped, 0, moved);
  return { ...layout, widgets };
}

/** 指定インスタンスのサイズを変更する。見つからない場合は無変更 */
export function setWidgetSize(layout: MyPageLayout, instanceId: string, size: WidgetSize): MyPageLayout {
  return {
    ...layout,
    widgets: layout.widgets.map(w => (w.instance_id === instanceId ? { ...w, size } : w)),
  };
}

/** 指定インスタンスの config を丸ごと差し替える。見つからない場合は無変更 */
export function setWidgetConfig(layout: MyPageLayout, instanceId: string, config: Record<string, unknown>): MyPageLayout {
  return {
    ...layout,
    widgets: layout.widgets.map(w => (w.instance_id === instanceId ? { ...w, config } : w)),
  };
}

const VALID_SIZES: readonly WidgetSize[] = ["s", "m", "l"];

/**
 * 前方・後方互換の要。
 * ・パース失敗（object でない）・version 不一致・widgets が配列でない → 既定レイアウトへ
 *   フォールバックする。
 * ・壊れたエントリ（instance_id/widget_id が非空文字列でない等）はその要素だけ捨てる
 *   （レイアウト全体は破棄しない）。
 * ・未知の widget_id はここでは捨てず残す（描画時にプレースホルダを出す。ウィジェットを
 *   一時的に外した／リネームした時にユーザーのレイアウトを破壊しないため。
 *   docs/dev/mypage-widgets-design.md §2-3）。
 * @param resolveDefaultSize createDefaultLayout にそのまま渡す（フォールバック時に使用）。
 */
export function normalizeLayout(
  raw: unknown,
  resolveDefaultSize: (widgetId: string) => WidgetSize | undefined,
): MyPageLayout {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createDefaultLayout(resolveDefaultSize);

  const obj = raw as Record<string, unknown>;
  if (obj.version !== MYPAGE_LAYOUT_VERSION) return createDefaultLayout(resolveDefaultSize);
  if (!Array.isArray(obj.widgets)) return createDefaultLayout(resolveDefaultSize);

  const widgets: WidgetInstance[] = [];
  for (const entry of obj.widgets) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.instance_id !== "string" || e.instance_id.length === 0) continue;
    if (typeof e.widget_id !== "string" || e.widget_id.length === 0) continue;
    const size: WidgetSize = VALID_SIZES.includes(e.size as WidgetSize) ? (e.size as WidgetSize) : "m";
    const config: Record<string, unknown> =
      e.config && typeof e.config === "object" && !Array.isArray(e.config)
        ? (e.config as Record<string, unknown>)
        : {};
    widgets.push({ instance_id: e.instance_id, widget_id: e.widget_id, size, config });
  }

  return { version: MYPAGE_LAYOUT_VERSION, widgets };
}
