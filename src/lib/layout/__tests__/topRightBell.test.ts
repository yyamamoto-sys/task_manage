// src/lib/layout/__tests__/topRightBell.test.ts
//
// 右上の常設ベル（v3.129）の位置と、各画面のヘッダーがベルの幅を空けていること。
// 後者はソース走査（Section 59：コメントを除去してから走査する。「わざと外すと赤くなる」ことを確認済み）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_BELL_FIXED_TOP_PX, APP_BELL_RESERVE_PC_PX, APP_BELL_SIZE_PC_PX, APP_FRAME_INSET_PC_PX, BELOW_BELL_TOP_PX,
  computeBellRightPc, withBellReserve,
} from "../topRightBell";

const SRC = join(__dirname, "..", "..", "..");
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .map(line => line.replace(/\s\/\/\s.*$/, ""))
  .join("\n");

describe("ベルの位置", () => {
  it("AI相談パネルが開いていればその幅だけ左へ退く（FAB と同じ避け方）", () => {
    expect(computeBellRightPc(false, 400)).toBe(APP_FRAME_INSET_PC_PX + 10);
    expect(computeBellRightPc(true, 400)).toBe(APP_FRAME_INSET_PC_PX + 10 + 400);
    expect(computeBellRightPc(true, -5)).toBe(APP_FRAME_INSET_PC_PX + 10);
  });

  it("ヘッダーが空ける幅はベル本体＋右余白＋隙間。一覧の1段ツールバー（約38px）に収まる", () => {
    expect(APP_BELL_RESERVE_PC_PX).toBeGreaterThan(APP_BELL_SIZE_PC_PX);
    expect(APP_BELL_FIXED_TOP_PX - APP_FRAME_INSET_PC_PX + APP_BELL_SIZE_PC_PX).toBeLessThanOrEqual(38);
    expect(withBellReserve(16)).toBe("calc(16px + var(--app-bell-reserve, 0px))");
  });

  it("右上のカード型バナー（ヘルスバナー）はベルより下に出す", () => {
    expect(BELOW_BELL_TOP_PX).toBeGreaterThan(APP_BELL_FIXED_TOP_PX + APP_BELL_SIZE_PC_PX);
    for (const f of ["components/common/ReminderHealthBanner.tsx", "components/common/SchemaHealthBanner.tsx"]) {
      const src = stripComments(readFileSync(join(SRC, f), "utf8"));
      expect(src, f).toContain("top: `${BELOW_BELL_TOP_PX}px`");
    }
  });
});

/** 画面の右上の角に来るヘッダー（右端にボタンが並ぶ行）を持つファイル。新しい画面を足したらここにも足す */
const HEADER_FILES: readonly string[] = [
  "components/list/ListToolbar.tsx",
  "components/kanban/KanbanView.tsx",
  "components/gantt/GanttView.tsx",
  "components/dashboard/DashboardView.tsx",
  "components/workload/WorkloadView.tsx",
  "components/okr/OkrDashboardView.tsx",
  "components/lab/CalendarLabView.tsx",
  "components/lab/MyPageView.tsx",
  "components/lab/ProjectStructureView.tsx",
  "components/graph/GraphView.tsx",
  "components/task/TaskSidePanel.tsx",
];

export function usesBellReserve(src: string): boolean {
  return /withBellReserve\(\d+\)/.test(stripComments(src));
}

describe("各画面のヘッダーがベルの幅を空けている", () => {
  it.each(HEADER_FILES)("%s", (file) => {
    expect(usesBellReserve(readFileSync(join(SRC, file), "utf8"))).toBe(true);
  });

  it("設定・ガイドの見出し行（MainLayout）も2か所とも空けている", () => {
    const src = stripComments(readFileSync(join(SRC, "components/layout/MainLayout.tsx"), "utf8"));
    expect(src.match(/paddingRight: withBellReserve\(16\)/g)).toHaveLength(2);
    expect(src).toContain("[APP_BELL_RESERVE_VAR as string]: isGuest ? \"0px\" : `${APP_BELL_RESERVE_PC_PX}px`");
  });

  it("検査自体が効いている：コメントに書いただけでは通らない", () => {
    expect(usesBellReserve("// paddingRight: withBellReserve(16)\nconst a = 1;")).toBe(false);
    expect(usesBellReserve("const s = { paddingRight: withBellReserve(16) };")).toBe(true);
  });
});
