import { describe, it, expect } from "vitest";
import {
  createDefaultLayout,
  addWidget,
  removeWidget,
  moveWidget,
  setWidgetSize,
  setWidgetConfig,
  normalizeLayout,
} from "../layout";
import type { MyPageLayout, WidgetInstance } from "../types";

function idGen(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function makeLayout(widgets: WidgetInstance[]): MyPageLayout {
  return { version: 1, widgets };
}

describe("createDefaultLayout", () => {
  it("既定の5ウィジェットをこの順で作る", () => {
    const layout = createDefaultLayout(idGen());
    expect(layout.version).toBe(1);
    expect(layout.widgets.map(w => w.widget_id)).toEqual([
      "my-week-tasks",
      "alert-tasks",
      "my-workload",
      "due-forecast",
      "velocity",
    ]);
  });

  it("採番関数を注入でき、決定的なinstance_idが振られる", () => {
    const layout = createDefaultLayout(idGen("x"));
    expect(layout.widgets.map(w => w.instance_id)).toEqual(["x-1", "x-2", "x-3", "x-4", "x-5"]);
  });

  it("各ウィジェットのconfigは空オブジェクト", () => {
    const layout = createDefaultLayout(idGen());
    for (const w of layout.widgets) expect(w.config).toEqual({});
  });

  it("既定の呼び出し（引数省略）でも例外を投げず動作する", () => {
    expect(() => createDefaultLayout()).not.toThrow();
  });
});

describe("addWidget", () => {
  it("末尾に追加する", () => {
    const base = makeLayout([{ instance_id: "a", widget_id: "memo", size: "s", config: {} }]);
    const next = addWidget(base, "pinned-projects", "m", "b");
    expect(next.widgets.map(w => w.instance_id)).toEqual(["a", "b"]);
    expect(next.widgets[1]).toEqual({ instance_id: "b", widget_id: "pinned-projects", size: "m", config: {} });
  });

  it("元のlayoutを変更しない（イミュータブル）", () => {
    const base = makeLayout([]);
    const next = addWidget(base, "memo", "s", "a");
    expect(base.widgets).toEqual([]);
    expect(next.widgets.length).toBe(1);
    expect(base).not.toBe(next);
  });
});

describe("removeWidget", () => {
  it("対象インスタンスを取り除く", () => {
    const base = makeLayout([
      { instance_id: "a", widget_id: "memo", size: "s", config: {} },
      { instance_id: "b", widget_id: "memo", size: "s", config: {} },
    ]);
    const next = removeWidget(base, "a");
    expect(next.widgets.map(w => w.instance_id)).toEqual(["b"]);
  });

  it("見つからないIDを渡しても例外にならず、中身は変わらない", () => {
    const base = makeLayout([{ instance_id: "a", widget_id: "memo", size: "s", config: {} }]);
    const next = removeWidget(base, "nope");
    expect(next.widgets).toEqual(base.widgets);
  });

  it("元のlayoutを変更しない（イミュータブル）", () => {
    const base = makeLayout([{ instance_id: "a", widget_id: "memo", size: "s", config: {} }]);
    removeWidget(base, "a");
    expect(base.widgets.length).toBe(1);
  });
});

describe("moveWidget", () => {
  const base = () =>
    makeLayout([
      { instance_id: "a", widget_id: "memo", size: "s", config: {} },
      { instance_id: "b", widget_id: "memo", size: "s", config: {} },
      { instance_id: "c", widget_id: "memo", size: "s", config: {} },
    ]);

  it("先頭へ移動する", () => {
    const next = moveWidget(base(), "c", 0);
    expect(next.widgets.map(w => w.instance_id)).toEqual(["c", "a", "b"]);
  });

  it("末尾へ移動する", () => {
    const next = moveWidget(base(), "a", 2);
    expect(next.widgets.map(w => w.instance_id)).toEqual(["b", "c", "a"]);
  });

  it("同じ位置へ移動しても順序は変わらない", () => {
    const next = moveWidget(base(), "b", 1);
    expect(next.widgets.map(w => w.instance_id)).toEqual(["a", "b", "c"]);
  });

  it("範囲外のindexはクランプされる", () => {
    const next = moveWidget(base(), "a", 999);
    expect(next.widgets.map(w => w.instance_id)).toEqual(["b", "c", "a"]);
    const next2 = moveWidget(base(), "c", -5);
    expect(next2.widgets.map(w => w.instance_id)).toEqual(["c", "a", "b"]);
  });

  it("見つからないIDを渡すと無変更", () => {
    const next = moveWidget(base(), "nope", 0);
    expect(next.widgets.map(w => w.instance_id)).toEqual(["a", "b", "c"]);
  });

  it("元のlayoutを変更しない（イミュータブル）", () => {
    const b = base();
    moveWidget(b, "c", 0);
    expect(b.widgets.map(w => w.instance_id)).toEqual(["a", "b", "c"]);
  });
});

describe("setWidgetSize", () => {
  it("対象インスタンスのサイズだけを変更する", () => {
    const base = makeLayout([
      { instance_id: "a", widget_id: "memo", size: "s", config: {} },
      { instance_id: "b", widget_id: "memo", size: "s", config: {} },
    ]);
    const next = setWidgetSize(base, "a", "l");
    expect(next.widgets[0].size).toBe("l");
    expect(next.widgets[1].size).toBe("s");
  });

  it("元のlayoutを変更しない（イミュータブル）", () => {
    const base = makeLayout([{ instance_id: "a", widget_id: "memo", size: "s", config: {} }]);
    setWidgetSize(base, "a", "l");
    expect(base.widgets[0].size).toBe("s");
  });
});

describe("setWidgetConfig", () => {
  it("対象インスタンスのconfigだけを丸ごと差し替える", () => {
    const base = makeLayout([
      { instance_id: "a", widget_id: "memo", size: "s", config: { text: "old" } },
      { instance_id: "b", widget_id: "memo", size: "s", config: { text: "keep" } },
    ]);
    const next = setWidgetConfig(base, "a", { text: "new" });
    expect(next.widgets[0].config).toEqual({ text: "new" });
    expect(next.widgets[1].config).toEqual({ text: "keep" });
  });

  it("元のlayoutを変更しない（イミュータブル）", () => {
    const base = makeLayout([{ instance_id: "a", widget_id: "memo", size: "s", config: { text: "old" } }]);
    setWidgetConfig(base, "a", { text: "new" });
    expect(base.widgets[0].config).toEqual({ text: "old" });
  });
});

describe("normalizeLayout", () => {
  it("正常なレイアウトはそのまま（同じ内容で）返す", () => {
    const raw = { version: 1, widgets: [{ instance_id: "a", widget_id: "memo", size: "m", config: { text: "hi" } }] };
    const result = normalizeLayout(raw);
    expect(result).toEqual(raw);
  });

  it("JSONとして壊れている（objectでない）場合は既定レイアウトにフォールバックする", () => {
    expect(normalizeLayout("not an object").widgets.length).toBe(5);
    expect(normalizeLayout(123).widgets.length).toBe(5);
    expect(normalizeLayout(null).widgets.length).toBe(5);
    expect(normalizeLayout(undefined).widgets.length).toBe(5);
  });

  it("versionが一致しない場合は既定レイアウトにフォールバックする", () => {
    const result = normalizeLayout({ version: 2, widgets: [] });
    expect(result.version).toBe(1);
    expect(result.widgets.map(w => w.widget_id)).toEqual([
      "my-week-tasks", "alert-tasks", "my-workload", "due-forecast", "velocity",
    ]);
  });

  it("widgetsが配列でない場合は既定レイアウトにフォールバックする", () => {
    const result = normalizeLayout({ version: 1, widgets: "not-an-array" });
    expect(result.widgets.length).toBe(5);
  });

  it("壊れたエントリ（instance_idが文字列でない）はその要素だけ捨てる", () => {
    const raw = {
      version: 1,
      widgets: [
        { instance_id: 123, widget_id: "memo", size: "m", config: {} },
        { instance_id: "ok", widget_id: "memo", size: "m", config: {} },
      ],
    };
    const result = normalizeLayout(raw);
    expect(result.widgets.map(w => w.instance_id)).toEqual(["ok"]);
  });

  it("壊れたエントリ（widget_idが文字列でない）はその要素だけ捨てる", () => {
    const raw = {
      version: 1,
      widgets: [
        { instance_id: "a", widget_id: null, size: "m", config: {} },
        { instance_id: "b", widget_id: "memo", size: "m", config: {} },
      ],
    };
    const result = normalizeLayout(raw);
    expect(result.widgets.map(w => w.instance_id)).toEqual(["b"]);
  });

  it("壊れたエントリ（空文字のid）はその要素だけ捨てる", () => {
    const raw = {
      version: 1,
      widgets: [
        { instance_id: "", widget_id: "memo", size: "m", config: {} },
        { instance_id: "a", widget_id: "", size: "m", config: {} },
        { instance_id: "b", widget_id: "memo", size: "m", config: {} },
      ],
    };
    const result = normalizeLayout(raw);
    expect(result.widgets.map(w => w.instance_id)).toEqual(["b"]);
  });

  it("エントリ自体がオブジェクトでない場合はその要素だけ捨てる", () => {
    const raw = { version: 1, widgets: [null, "string", 42, { instance_id: "a", widget_id: "memo", size: "m", config: {} }] };
    const result = normalizeLayout(raw);
    expect(result.widgets.map(w => w.instance_id)).toEqual(["a"]);
  });

  it("不正なsizeは既定値mにフォールバックする", () => {
    const raw = { version: 1, widgets: [{ instance_id: "a", widget_id: "memo", size: "huge", config: {} }] };
    const result = normalizeLayout(raw);
    expect(result.widgets[0].size).toBe("m");
  });

  it("configが欠落・不正な場合は空オブジェクトにフォールバックする", () => {
    const raw = {
      version: 1,
      widgets: [
        { instance_id: "a", widget_id: "memo", size: "m" },
        { instance_id: "b", widget_id: "memo", size: "m", config: null },
        { instance_id: "c", widget_id: "memo", size: "m", config: [1, 2] },
      ],
    };
    const result = normalizeLayout(raw);
    expect(result.widgets.map(w => w.config)).toEqual([{}, {}, {}]);
  });

  it("未知のwidget_idは捨てずに残す（プレースホルダ表示のため）", () => {
    const raw = { version: 1, widgets: [{ instance_id: "a", widget_id: "no-longer-exists", size: "m", config: {} }] };
    const result = normalizeLayout(raw);
    expect(result.widgets).toEqual([{ instance_id: "a", widget_id: "no-longer-exists", size: "m", config: {} }]);
  });

  it("未知の設定キーが混ざっていてもエラーにならない（無視される）", () => {
    const raw = { version: 1, widgets: [], someFutureField: "ignored" };
    const result = normalizeLayout(raw);
    expect(result.widgets).toEqual([]);
  });
});
