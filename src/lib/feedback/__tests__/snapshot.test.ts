// src/lib/feedback/__tests__/snapshot.test.ts
//
// v3.157：ご意見のスナップショット（許可リスト方式の純関数）。守るもの：
//  ① 画面に表示された文字列（タスク名・検索語など）・許可リストにないキーが、出力のどこにも現れない
//  ② 形式に合わない値（空白・記号入りの ID・長すぎる語）は黙って落ちる
//  ③ 経路は pathname と既知の open だけ（招待コード等のクエリを含めない）
//  ④ 16KB を超えたら外す（本文は別に送る）
//  ⑤ プレビューの要約に名前・文字を載せない

import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_TOP_LEVEL_KEYS, buildFeedbackRoute, buildFeedbackSnapshot, finalizeSnapshot, serializeSnapshot, summarizeSnapshot,
  type SnapshotBuildInput,
} from "../snapshot";
import type { ClickRecord } from "../clickHistory";

const NOW = Date.parse("2026-10-15T01:00:00.000Z");
const UA_CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function click(over: Partial<ClickRecord> = {}): ClickRecord {
  return { tag: "button", role: null, tour: null, at: NOW - 1000, x: 640, y: 360, vw: 1280, vh: 720, ...over };
}

function input(over: Partial<SnapshotBuildInput> = {}): SnapshotBuildInput {
  return {
    now: NOW, screen: "list", route: "/", appVersion: "3.157", userAgent: UA_CHROME_WIN,
    viewport: { w: 1280, h: 720 }, display: { w: 1920, h: 1080 }, dpr: 1.25,
    context: {
      mode: "plan", view: "list", overlay: null, isMobile: false, theme: "light", lang: "ja",
      department: { displayGroupId: "grp-egg" },
      selection: { projectId: "11111111-2222-3333-4444-555555555555", taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", selectedCount: 3 },
      listSettings: {
        groupBy: "project", sortKey: "due_date", sortDir: "asc", density: "simple",
        filters: { status: "all", priority: "high", myOnly: true, thisWeek: false, hideDone: true, member: "all", hasSearch: true },
      },
    },
    clicks: [click({ tag: "button", tour: "fab" }), click({ tag: "tr", at: NOW - 500 })],
    ...over,
  };
}

describe("buildFeedbackSnapshot：許可リスト", () => {
  it("基本の形：画面・版・ブラウザ・ウィンドウ・拡大率・部署ID・選択ID・並び順・クリック", () => {
    const s = buildFeedbackSnapshot(input());
    expect(s.v).toBe(1);
    expect(s.takenAt).toBe("2026-10-15T01:00:00.000Z");
    expect(s.screen).toBe("list");
    expect(s.view).toBe("list");
    expect(s.mode).toBe("plan");
    expect(s.app).toEqual({ version: "3.157" });
    expect(s.env).toMatchObject({
      browser: "Chrome", browserMajor: 130, os: "Windows", isMobile: false,
      viewport: { w: 1280, h: 720 }, display: { w: 1920, h: 1080 }, dpr: 1.25, zoomPct: 125, lang: "ja", theme: "light",
    });
    expect(s.department).toEqual({ displayGroupId: "grp-egg" });
    expect(s.selection).toEqual({ projectId: "11111111-2222-3333-4444-555555555555", taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", selectedCount: 3 });
    expect(s.listSettings?.groupBy).toBe("project");
    expect(s.listSettings?.filters).toMatchObject({ priority: "high", myOnly: true, hideDone: true, member: "all", hasSearch: true });
    expect(s.clicks).toHaveLength(2);
    expect(s.clicks[0]).toMatchObject({ tag: "button", tour: "fab", agoMs: 1000, x: 640, y: 360, rx: 0.5, ry: 0.5 });
    expect(s.clicks[1]).toMatchObject({ tag: "tr", agoMs: 500 });
  });

  it("最上位のキーは許可リスト（SNAPSHOT_TOP_LEVEL_KEYS）の範囲内", () => {
    const s = buildFeedbackSnapshot(input({
      context: { ...input().context, ganttSettings: { mode: "pj", dayWidth: 28 }, kanbanSettings: { hideDone: true }, settingsPage: "notify", overlay: "settings" },
    }));
    for (const key of Object.keys(s)) expect(SNAPSHOT_TOP_LEVEL_KEYS, key).toContain(key);
  });

  it("🔴 許可リストにないキー・業務データの文字列は、出力のどこにも現れない", () => {
    const SECRET = "SECRET_TASK_NAME_顧客A";
    const s = buildFeedbackSnapshot(input({
      context: {
        ...input().context,
        taskName: SECRET, projectName: SECRET, searchText: SECRET, memberEmail: "taro@example.co.jp",
        selection: { projectId: "pj-1", taskId: "t-1", selectedCount: 1, taskTitle: SECRET },
        listSettings: { groupBy: "project", searchText: SECRET, filters: { hasSearch: true, searchText: SECRET, memberName: SECRET } },
        extra: { nested: { deep: SECRET } },
      },
    }));
    const json = JSON.stringify(s);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("taro@example.co.jp");
    expect(json).not.toContain("taskName");
    expect(json).not.toContain("extra");
  });

  it("形式に合わない値は黙って落ちる（空白・記号・長すぎる語・型違い）", () => {
    const s = buildFeedbackSnapshot(input({
      screen: "リスト 画面",
      context: {
        mode: "plan mode", view: "<script>", overlay: "x".repeat(60), isMobile: "yes", theme: 1,
        department: { displayGroupId: "grp egg" },
        selection: { projectId: "has space", taskId: "../../etc", selectedCount: -5 },
        listSettings: { groupBy: "a b", sortKey: 5, filters: { myOnly: "true", member: "someone-id" } },
      },
    }));
    expect(s.screen).toBeUndefined();
    expect(s.mode).toBeUndefined();
    expect(s.view).toBeUndefined();
    expect(s.overlay).toBeUndefined();
    expect(s.env.isMobile).toBeUndefined();
    expect(s.env.theme).toBeUndefined();
    expect(s.department).toBeUndefined();
    expect(s.selection).toBeUndefined();
    expect(s.listSettings).toBeUndefined();
  });

  it("担当者の絞り込みは「all／set」だけ（担当者のIDそのものは載せない）", () => {
    const s = buildFeedbackSnapshot(input({ context: { listSettings: { filters: { member: "set" } } } }));
    expect(s.listSettings?.filters?.member).toBe("set");
    const t = buildFeedbackSnapshot(input({ context: { listSettings: { filters: { member: "member-uuid-123" } } } }));
    expect(JSON.stringify(t)).not.toContain("member-uuid-123");
  });

  it("キーボード操作のクリック（座標なし）は x・y・比を出さない。クリックは最大5件（古いものを捨てる）", () => {
    const clicks = Array.from({ length: 8 }, (_, i) => click({ at: NOW - (8 - i) * 100, x: i === 7 ? null : 100, y: i === 7 ? null : 100 }));
    const s = buildFeedbackSnapshot(input({ clicks }));
    expect(s.clicks).toHaveLength(5);
    expect(s.clicks[4]).not.toHaveProperty("x");
    expect(s.clicks[4]).not.toHaveProperty("rx");
    expect(s.clicks[0].agoMs).toBe(500);
  });

  it("ブラウザ情報は列挙値だけ（UserAgent の全文は載せない）", () => {
    const json = JSON.stringify(buildFeedbackSnapshot(input()));
    expect(json).not.toContain("Mozilla");
    expect(json).not.toContain("AppleWebKit");
  });

  it("dpr が不正なら拡大率を出さない", () => {
    const s = buildFeedbackSnapshot(input({ dpr: Number.NaN }));
    expect(s.env.dpr).toBeUndefined();
    expect(s.env.zoomPct).toBeUndefined();
  });
});

describe("buildFeedbackRoute：pathname と既知の open だけ", () => {
  it("招待コード・任意のクエリ・ハッシュは載せない", () => {
    expect(buildFeedbackRoute("/", "?invite=ABC123SECRET&x=1")).toBe("/");
    expect(buildFeedbackRoute("/", "?open=admin-feedback&invite=SECRET")).toBe("/?open=admin-feedback");
    expect(buildFeedbackRoute("/", "?open=unknown-target")).toBe("/");
  });
  it("変な pathname は / にする", () => {
    expect(buildFeedbackRoute("/a b/<x>", "")).toBe("/");
    expect(buildFeedbackRoute("/app/view", "")).toBe("/app/view");
  });
});

describe("finalizeSnapshot：16KB の上限", () => {
  it("上限以内なら attached、超えたら null と too_large（本文は別に送る）", () => {
    const s = buildFeedbackSnapshot(input());
    const { bytes } = serializeSnapshot(s);
    expect(bytes).toBeGreaterThan(100);
    expect(bytes).toBeLessThan(16 * 1024);
    expect(finalizeSnapshot(s)).toMatchObject({ state: "attached", snapshot: s });
    const big = finalizeSnapshot(s, bytes - 1);
    expect(big.state).toBe("too_large");
    expect(big.snapshot).toBeNull();
    expect(finalizeSnapshot(s, bytes).state).toBe("attached");
  });

  it("通常の状況は16KBよりずっと小さい（5件のクリック・全設定を載せても）", () => {
    const s = buildFeedbackSnapshot(input({
      clicks: Array.from({ length: 5 }, (_, i) => click({ tag: "button", role: "tab", tour: "okr-week-cards", at: NOW - i * 10 })),
      context: {
        ...input().context,
        ganttSettings: { mode: "person", dayWidth: 80, hideCompleted: true, sortOrder: "date", showDeps: true, showBaseline: true, showCriticalPath: true, showOverload: true },
        kanbanSettings: { hideDone: true, showPaused: true, hasSectionFilter: true },
      },
    }));
    expect(serializeSnapshot(s).bytes).toBeLessThan(4 * 1024);
  });
});

describe("summarizeSnapshot：人が読む要約", () => {
  it("画面・版・ブラウザ・ウィンドウ・表示部署・選択・表示設定・直前の操作の行が出る", () => {
    const lines = summarizeSnapshot(buildFeedbackSnapshot(input()));
    const byId = Object.fromEntries(lines.map(l => [l.id, l.value]));
    expect(byId.screen).toBe("リスト・計画モード");
    expect(byId.app).toBe("v3.157");
    expect(byId.browser).toBe("Chrome 130・Windows");
    expect(byId.window).toBe("1280×720・拡大 125%・PC表示");
    expect(byId.department).toContain("grp-egg");
    expect(byId.department).toContain("部署名は送りません");
    expect(byId.selection).toContain("名前は送りません");
    expect(byId.display).toContain("まとめ方 PJ別");
    expect(byId.display).toContain("並び順 期日");
    expect(byId.display).toContain("自分のみ");
    expect(byId.clicks).toBe("ボタン→行（直近2件・最後は1秒前。文字は送りません）");
  });

  it("クリックが無ければ「直前の操作」の行を出さない／設定ページ・オーバーレイは画面の行に出る", () => {
    const lines = summarizeSnapshot(buildFeedbackSnapshot(input({
      clicks: [], context: { mode: "plan", view: "list", overlay: "settings", settingsPage: "notify" },
    })));
    expect(lines.find(l => l.id === "clicks")).toBeUndefined();
    expect(lines.find(l => l.id === "screen")?.value).toContain("設定を開いている");
    expect(lines.find(l => l.id === "screen")?.value).toContain("設定：notify");
  });
});
