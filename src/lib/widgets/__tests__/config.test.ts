import { describe, it, expect } from "vitest";
import { resolveConfig, applyConfigChange } from "../config";
import type { WidgetConfigField } from "../types";

describe("resolveConfig", () => {
  it("schemaが未指定なら空オブジェクトを返す", () => {
    expect(resolveConfig(undefined, { a: 1 })).toEqual({});
  });

  it("schemaが空配列なら空オブジェクトを返す", () => {
    expect(resolveConfig([], { a: 1 })).toEqual({});
  });

  describe("text/textarea", () => {
    const schema: WidgetConfigField[] = [
      { key: "title", label: "見出し", type: "text" },
      { key: "body", label: "本文", type: "textarea", defaultValue: "既定本文" },
    ];

    it("文字列の値はそのまま使う", () => {
      expect(resolveConfig(schema, { title: "hi", body: "hello" })).toEqual({ title: "hi", body: "hello" });
    });

    it("値が無い場合はdefaultValue（無ければ空文字）で埋める", () => {
      expect(resolveConfig(schema, {})).toEqual({ title: "", body: "既定本文" });
    });

    it("型が違う場合は既定値に矯正する", () => {
      expect(resolveConfig(schema, { title: 123, body: null })).toEqual({ title: "", body: "既定本文" });
    });
  });

  describe("number", () => {
    const schema: WidgetConfigField[] = [
      { key: "limit", label: "件数", type: "number", defaultValue: 10, min: 1, max: 30 },
    ];

    it("有効な数値はそのまま使う", () => {
      expect(resolveConfig(schema, { limit: 5 })).toEqual({ limit: 5 });
    });

    it("値が無い場合はdefaultValue（無ければ0）で埋める", () => {
      expect(resolveConfig(schema, {})).toEqual({ limit: 10 });
      expect(resolveConfig([{ key: "n", label: "n", type: "number" }], {})).toEqual({ n: 0 });
    });

    it("型が違う場合（文字列・NaN）は既定値に矯正する", () => {
      expect(resolveConfig(schema, { limit: "abc" })).toEqual({ limit: 10 });
      expect(resolveConfig(schema, { limit: NaN })).toEqual({ limit: 10 });
    });

    it("min-maxの範囲外はクランプする", () => {
      expect(resolveConfig(schema, { limit: 0 })).toEqual({ limit: 1 });
      expect(resolveConfig(schema, { limit: 100 })).toEqual({ limit: 30 });
    });

    it("defaultValue自体がmin-maxの範囲外でもクランプする", () => {
      const s: WidgetConfigField[] = [{ key: "n", label: "n", type: "number", defaultValue: 999, min: 0, max: 5 }];
      expect(resolveConfig(s, {})).toEqual({ n: 5 });
    });
  });

  describe("boolean", () => {
    const schema: WidgetConfigField[] = [
      { key: "mineOnly", label: "自分のみ", type: "boolean", defaultValue: true },
    ];

    it("真偽値はそのまま使う", () => {
      expect(resolveConfig(schema, { mineOnly: false })).toEqual({ mineOnly: false });
    });

    it("値が無い場合はdefaultValue（無ければfalse）で埋める", () => {
      expect(resolveConfig(schema, {})).toEqual({ mineOnly: true });
      expect(resolveConfig([{ key: "b", label: "b", type: "boolean" }], {})).toEqual({ b: false });
    });

    it("型が違う場合は既定値に矯正する", () => {
      expect(resolveConfig(schema, { mineOnly: "yes" })).toEqual({ mineOnly: true });
    });
  });

  describe("select（静的options）", () => {
    const schema: WidgetConfigField[] = [
      {
        key: "priority", label: "優先度", type: "select",
        options: [{ label: "高", value: "high" }, { label: "中", value: "mid" }],
      },
    ];

    it("optionsに存在する値はそのまま使う", () => {
      expect(resolveConfig(schema, { priority: "mid" })).toEqual({ priority: "mid" });
    });

    it("optionsに無い値はoptions[0]にフォールバックする", () => {
      expect(resolveConfig(schema, { priority: "nope" })).toEqual({ priority: "high" });
    });

    it("値が無い場合、defaultValueがoptionsに存在すればそれを使う", () => {
      const s: WidgetConfigField[] = [{ ...schema[0], defaultValue: "mid" }];
      expect(resolveConfig(s, {})).toEqual({ priority: "mid" });
    });

    it("値が無く、defaultValueもoptionsに無い場合はoptions[0]を使う", () => {
      expect(resolveConfig(schema, {})).toEqual({ priority: "high" });
    });

    it("optionsが空配列の場合はoptions[0]??\"\"（=空文字）にフォールバックする", () => {
      expect(resolveConfig([{ key: "x", label: "x", type: "select", options: [] }], {})).toEqual({ x: "" });
    });
  });

  describe("select（動的options＝options未指定）", () => {
    const schema: WidgetConfigField[] = [{ key: "projectId", label: "PJ", type: "select" }];

    it("文字列ならそのまま通す（妥当性はモーダル側の実データで判定）", () => {
      expect(resolveConfig(schema, { projectId: "pj-1" })).toEqual({ projectId: "pj-1" });
    });

    it("値が無ければdefaultValue（無ければ空文字）", () => {
      expect(resolveConfig(schema, {})).toEqual({ projectId: "" });
      expect(resolveConfig([{ ...schema[0], defaultValue: "pj-default" }], {})).toEqual({ projectId: "pj-default" });
    });

    it("型が違う場合は空文字に矯正する", () => {
      expect(resolveConfig(schema, { projectId: 123 })).toEqual({ projectId: "" });
    });
  });

  describe("projectMultiSelect / memberMultiSelect", () => {
    const schema: WidgetConfigField[] = [
      { key: "projectIds", label: "PJ", type: "projectMultiSelect" },
      { key: "memberIds", label: "メンバー", type: "memberMultiSelect" },
    ];

    it("文字列配列はそのまま使う", () => {
      expect(resolveConfig(schema, { projectIds: ["a", "b"], memberIds: ["m1"] }))
        .toEqual({ projectIds: ["a", "b"], memberIds: ["m1"] });
    });

    it("配列内の非文字列要素は除外する", () => {
      expect(resolveConfig(schema, { projectIds: ["a", 1, null, "b"], memberIds: [] }))
        .toEqual({ projectIds: ["a", "b"], memberIds: [] });
    });

    it("値が無い場合は空配列（defaultValueが配列ならそれを使う）", () => {
      expect(resolveConfig(schema, {})).toEqual({ projectIds: [], memberIds: [] });
      const s: WidgetConfigField[] = [{ key: "projectIds", label: "PJ", type: "projectMultiSelect", defaultValue: ["x"] }];
      expect(resolveConfig(s, {})).toEqual({ projectIds: ["x"] });
    });

    it("配列でない値は空配列に矯正する", () => {
      expect(resolveConfig(schema, { projectIds: "not-array", memberIds: null }))
        .toEqual({ projectIds: [], memberIds: [] });
    });
  });

  it("複数フィールドを同時に解決する", () => {
    const schema: WidgetConfigField[] = [
      { key: "title", label: "見出し", type: "text" },
      { key: "limit", label: "件数", type: "number", defaultValue: 5, min: 1, max: 10 },
      { key: "mineOnly", label: "自分のみ", type: "boolean", defaultValue: true },
    ];
    expect(resolveConfig(schema, { title: "hi" })).toEqual({ title: "hi", limit: 5, mineOnly: true });
  });
});

describe("applyConfigChange", () => {
  it("指定したキーだけを更新する", () => {
    const current = { a: 1, b: 2 };
    const next = applyConfigChange(current, "a", 99);
    expect(next).toEqual({ a: 99, b: 2 });
  });

  it("新しいキーを追加できる", () => {
    const current = { a: 1 };
    const next = applyConfigChange(current, "b", 2);
    expect(next).toEqual({ a: 1, b: 2 });
  });

  it("schemaに存在しない未知のキーを保持したまま更新する（前方互換）", () => {
    const current = { a: 1, futureKey: "future-value" };
    const next = applyConfigChange(current, "a", 2);
    expect(next).toEqual({ a: 2, futureKey: "future-value" });
  });

  it("元のオブジェクトを変更しない（イミュータブル）", () => {
    const current = { a: 1 };
    applyConfigChange(current, "a", 2);
    expect(current).toEqual({ a: 1 });
  });
});
