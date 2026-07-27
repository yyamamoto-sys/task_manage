// src/lib/widgets/config.ts
//
// 【設計意図】
// ウィジェットの config（Record<string, unknown>）を configSchema（WidgetConfigField[]）に
// 沿って安全な値へ正規化する純粋関数群（DOM・zustand store・コンポーネント層に非依存）。
//
// resolveConfig：保存されている生の config は、スキーマ変更前の古い値・手動で壊れた値・
//   型が違う値を含みうる（normalizeLayout がレイアウト全体の形は保証するが、config の中身
//   までは検証しないため）。WidgetConfigModal の各フィールドの表示値、および各ウィジェットが
//   自分の config を読むときに、この関数を通してから使うことを想定する。
// applyConfigChange：1項目だけを更新する。未知のキー（schema から一時的に外した項目・
//   将来のバージョンで追加された項目等）を保持したまま更新する（前方互換の方針。
//   docs/dev/mypage-widgets-design.md §2-3 と同じ思想）。

import type { WidgetConfigField } from "./types";

function clampNumber(n: number, min: number | undefined, max: number | undefined): number {
  let v = n;
  if (typeof min === "number" && v < min) v = min;
  if (typeof max === "number" && v > max) v = max;
  return v;
}

function resolveField(field: WidgetConfigField, rawValue: unknown): unknown {
  switch (field.type) {
    case "text":
    case "textarea": {
      if (typeof rawValue === "string") return rawValue;
      return typeof field.defaultValue === "string" ? field.defaultValue : "";
    }
    case "number": {
      const fallback = typeof field.defaultValue === "number" ? field.defaultValue : 0;
      const n = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : fallback;
      return clampNumber(n, field.min, field.max);
    }
    case "boolean": {
      if (typeof rawValue === "boolean") return rawValue;
      return typeof field.defaultValue === "boolean" ? field.defaultValue : false;
    }
    case "select": {
      const options = field.options ?? [];
      // options が空（＝動的な選択肢。例：QuickAddTaskWidget.projectId）の場合は
      // 型（string）だけを保証し、値の妥当性判定はモーダル側（WidgetContext.data 由来の
      // 実際の選択肢）に委ねる。options が明示されている場合はここで検証する。
      if (options.length === 0) {
        if (typeof rawValue === "string") return rawValue;
        return typeof field.defaultValue === "string" ? field.defaultValue : "";
      }
      if (typeof rawValue === "string" && options.some(o => o.value === rawValue)) return rawValue;
      if (typeof field.defaultValue === "string" && options.some(o => o.value === field.defaultValue)) {
        return field.defaultValue;
      }
      return options[0]?.value ?? "";
    }
    case "projectMultiSelect":
    case "memberMultiSelect": {
      if (Array.isArray(rawValue)) return rawValue.filter((v): v is string => typeof v === "string");
      if (Array.isArray(field.defaultValue)) {
        return (field.defaultValue as unknown[]).filter((v): v is string => typeof v === "string");
      }
      return [];
    }
    default:
      return rawValue;
  }
}

/**
 * schema に沿って raw を検証し、描画用の値（すべての項目が安全な型で埋まったオブジェクト）を返す。
 * schema が無い／空の場合は空オブジェクトを返す（描画するフィールドが無いため）。
 */
export function resolveConfig(
  schema: WidgetConfigField[] | undefined,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (!schema || schema.length === 0) return {};
  const result: Record<string, unknown> = {};
  for (const field of schema) {
    result[field.key] = resolveField(field, raw[field.key]);
  }
  return result;
}

/**
 * current の1項目（key）だけを value に更新する。current にある他のキー（schema に
 * 存在しない未知のキーも含む）はそのまま保持する（イミュータブル）。
 */
export function applyConfigChange(
  current: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...current, [key]: value };
}
