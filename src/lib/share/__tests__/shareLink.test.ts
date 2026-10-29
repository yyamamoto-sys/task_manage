import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildProjectLink, buildTaskLink, extractShareTarget, pickAccessibleGroupId, SHARE_VIEW_KEYS } from "../shareLink";
import { stripOpenParam } from "../../reminder/deepLink";

const ORIGIN = "https://app.example.test";
const PID = "11111111-2222-4333-8444-555555555555";
const TID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("buildProjectLink / buildTaskLink", () => {
  it("PJ・PJ+ビュー・タスクの形", () => {
    expect(buildProjectLink(ORIGIN, PID)).toBe(`${ORIGIN}/?open=project&pid=${PID}`);
    expect(buildProjectLink(ORIGIN, PID, "gantt")).toBe(`${ORIGIN}/?open=project&pid=${PID}&view=gantt`);
    expect(buildTaskLink(ORIGIN, TID)).toBe(`${ORIGIN}/?open=task&tid=${TID}`);
  });
  it("origin にパスが付いていても / 始まりのリンクになる", () => {
    expect(buildProjectLink("http://localhost:5173", PID)).toBe(`http://localhost:5173/?open=project&pid=${PID}`);
  });
});

describe("extractShareTarget", () => {
  it("組み立てたリンクを読み戻せる（許可した全ビュー）", () => {
    for (const v of SHARE_VIEW_KEYS) {
      const u = new URL(buildProjectLink(ORIGIN, PID, v));
      expect(extractShareTarget(u.search)).toEqual({ kind: "project", projectId: PID, view: v });
    }
    expect(extractShareTarget(new URL(buildTaskLink(ORIGIN, TID)).search)).toEqual({ kind: "task", taskId: TID });
  });
  it("未知の view は無視して PJ だけ開く", () => {
    expect(extractShareTarget(`?open=project&pid=${PID}&view=admin`)).toEqual({ kind: "project", projectId: PID, view: null });
    expect(extractShareTarget(`?open=project&pid=${PID}`)).toEqual({ kind: "project", projectId: PID, view: null });
  });
  it("UUID でない id は無視（null）", () => {
    expect(extractShareTarget("?open=project&pid=abc")).toBeNull();
    expect(extractShareTarget("?open=project")).toBeNull();
    expect(extractShareTarget(`?open=task&tid=${PID}x`)).toBeNull();
    expect(extractShareTarget(`?open=task&tid=' OR 1=1 --`)).toBeNull();
  });
  it("他の open は対象外", () => {
    expect(extractShareTarget("?open=my-tasks")).toBeNull();
    expect(extractShareTarget(`?pid=${PID}`)).toBeNull();
  });
});

describe("stripOpenParam（共有リンク）", () => {
  it("pid・view・tid を消し、他のクエリ・ハッシュは残す", () => {
    expect(stripOpenParam(`${ORIGIN}/?open=project&pid=${PID}&view=list&foo=1#h`)).toBe("/?foo=1#h");
    expect(stripOpenParam(`${ORIGIN}/?open=task&tid=${TID}`)).toBe("/");
  });
  it("open=project 以外では view・pid を消さない", () => {
    expect(stripOpenParam(`${ORIGIN}/?open=my-tasks&view=keep&pid=keep`)).toBe("/?view=keep&pid=keep");
  });
});

describe("pickAccessibleGroupId", () => {
  it("行が属する部署のうち選べるものを返す", () => {
    expect(pickAccessibleGroupId({ group_id: "g1", group_ids: ["g1", "g2"] }, ["g2", "g3"])).toBe("g2");
    expect(pickAccessibleGroupId({ group_id: "g1" }, ["g1"])).toBe("g1");
  });
  it("選べる部署に属さなければ null", () => {
    expect(pickAccessibleGroupId({ group_id: "g1", group_ids: ["g1"] }, ["g9"])).toBeNull();
    expect(pickAccessibleGroupId({}, ["g9"])).toBeNull();
  });
});

// 配線（CLAUDE.md Section 59）：コメントに書いただけで効かない状態にならないよう、実コードの要所を確認する
describe("配線", () => {
  const main = readFileSync("src/components/layout/MainLayout.tsx", "utf8");
  it("MainLayout が起動時に共有リンクを読み、クエリを消してから開く", () => {
    expect(main).toMatch(/extractShareTarget\(window\.location\.search\)/);
    expect(main).toMatch(/stripOpenParam\(window\.location\.href\)[\s\S]{0,80}openShareTargetRef\.current\(target\)/);
  });
  it("PJ行メニュー・ビュー・タスク詳細にコピー導線がある", () => {
    expect(main).toMatch(/actionId === "copyLink"/);
    expect(main).toMatch(/copyViewLink/);
    expect(readFileSync("src/components/task/TaskSidePanel.tsx", "utf8")).toMatch(/copyTaskLink/);
    expect(readFileSync("src/components/task/TaskEditModal.tsx", "utf8")).toMatch(/copyTaskLink/);
  });
});
