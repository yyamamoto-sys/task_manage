// MS Project XML（MSPDI）の取り込みテスト。
// 注意：ProjectLibre・GanttProject が実際に書き出すファイルの実物は手元に無い。ここの XML はすべて、
// MSPDI の仕様（Project／Tasks／Task／PredecessorLink／Resources／Assignments の各要素）から作った架空の最小例である。
// 実物での確認は山本さんの手元（MS Project・ProjectLibre・GanttProject から書き出して取り込む）で行う。
import { describe, it, expect } from "vitest";
import { parseMspdi, isElapsedLagFormat } from "../wbsMspdi";
import { buildRowsFromItems } from "../wbsItems";
import { parseXml } from "../miniXml";
import { buildWbsPlan } from "../wbsPlan";
import { loadWbsBytes } from "../wbsFileLoader";

const NS = 'xmlns="http://schemas.microsoft.com/project"';

interface T {
  uid: number;
  name: string;
  level: number;
  start?: string;
  finish?: string;
  pct?: number;
  milestone?: boolean;
  notes?: string;
  isNull?: boolean;
  links?: { uid: number; type?: number; lag?: number; fmt?: number }[];
}

function xml(tasks: T[], extra = "", head = ""): string {
  const ts = tasks.map(t => `<Task><UID>${t.uid}</UID><ID>${t.uid}</ID><Name>${t.name}</Name>`
    + `<OutlineLevel>${t.level}</OutlineLevel>`
    + (t.isNull ? "<IsNull>1</IsNull>" : "<IsNull>0</IsNull>")
    + (t.start ? `<Start>${t.start}</Start>` : "") + (t.finish ? `<Finish>${t.finish}</Finish>` : "")
    + (t.pct !== undefined ? `<PercentComplete>${t.pct}</PercentComplete>` : "")
    + (t.milestone ? "<Milestone>1</Milestone>" : "<Milestone>0</Milestone>")
    + (t.notes ? `<Notes>${t.notes}</Notes>` : "")
    + (t.links ?? []).map(l => `<PredecessorLink><PredecessorUID>${l.uid}</PredecessorUID>`
      + (l.type !== undefined ? `<Type>${l.type}</Type>` : "")
      + (l.lag !== undefined ? `<LinkLag>${l.lag}</LinkLag>` : "")
      + (l.fmt !== undefined ? `<LagFormat>${l.fmt}</LagFormat>` : "")
      + "</PredecessorLink>").join("")
    + "</Task>").join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Project ${NS}><Name>架空計画.mpp</Name>${head}<Tasks>${ts}</Tasks>${extra}</Project>`;
}

const ok = (s: string) => {
  const o = parseMspdi(s);
  if (!o.ok) throw new Error(o.error);
  return o.result;
};
const rowsOf = (s: string, groupTop: boolean) => {
  const r = ok(s);
  return buildRowsFromItems(r.items, { groupTop, mode: "depth", title: r.title, warnings: r.warnings });
};

const FIVE: T[] = [
  { uid: 0, name: "架空計画", level: 0 },
  { uid: 1, name: "A", level: 1, start: "2026-01-05T08:00:00", finish: "2026-01-30T17:00:00" },
  { uid: 2, name: "A1", level: 2 },
  { uid: 3, name: "A1a", level: 3 },
  { uid: 4, name: "A1a1", level: 4 },
  { uid: 5, name: "A1a1x", level: 5, start: "2026-01-06T08:00:00", finish: "2026-01-07T17:00:00", pct: 100 },
  { uid: 6, name: "B", level: 1, start: "2026-02-02T08:00:00", finish: "2026-02-03T17:00:00", pct: 40, notes: "メモ&amp;補足" },
  { uid: 7, name: "", level: 1 },
  { uid: 8, name: "空行", level: 1, isNull: true },
];

describe("miniXml", () => {
  it("名前空間の接頭辞・CDATA・実体・コメント・DOCTYPE を読む（実体は展開しない）", () => {
    const n = parseXml('<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x "boom">]><!-- c --><p:Project xmlns:p="u"><p:Name><![CDATA[a<b]]> &amp;&#x41;&x;</p:Name><Empty/></p:Project>');
    expect(n.name).toBe("Project");
    expect(n.children[0].text).toBe("a<b &A&x;");
    expect(n.children[1].name).toBe("Empty");
  });
  it("閉じていないXMLはエラー", () => {
    expect(() => parseXml("<a><b></a>")).toThrow();
    expect(() => parseXml("<a>")).toThrow();
  });
});

describe("parseMspdi", () => {
  it("5段の木：UID=0・IsNull・名前なしを除き、OutlineLevel で深さを決める", () => {
    const r = ok(xml(FIVE));
    expect(r.title).toBe("架空計画.mpp");
    expect(r.items.map(i => [i.id, i.name, i.depth])).toEqual([
      ["1", "A", 0], ["2", "A1", 1], ["3", "A1a", 2], ["4", "A1a1", 3], ["5", "A1a1x", 4], ["6", "B", 0],
    ]);
    expect(r.items[0].start).toBe("2026-01-05");
    expect(r.items[0].end).toBe("2026-01-30");
  });

  it("グループON：子を持つ最上位をグループにし、子を深さ0のタスクにする。子の無い最上位はタスクのまま", () => {
    const { rows } = rowsOf(xml(FIVE), true);
    expect(rows.map(r => [r.name, r.isGroup, r.depth])).toEqual([
      ["A", true, 0], ["A1", false, 0], ["A1a", false, 1], ["A1a1", false, 2], ["A1a1x", false, 3], ["B", false, 0],
    ]);
    const a1 = rows[1];
    expect(a1.parentIndex).toBeNull();
    expect(a1.groupIndex).toBe(0);
    expect(rows[4].parentIndex).toBe(3);
    expect(rows[4].groupIndex).toBe(0);
    expect(rows[5].groupIndex).toBeNull();
  });

  it("グループOFF：全行タスク（5段のまま）", () => {
    const { rows } = rowsOf(xml(FIVE), false);
    expect(rows.some(r => r.isGroup)).toBe(false);
    expect(rows.map(r => r.depth)).toEqual([0, 1, 2, 3, 4, 0]);
    expect(rows[4].parentIndex).toBe(3);
  });

  it("進捗→状態・マイルストーン・メモ", () => {
    const rows = ok(xml([
      { uid: 1, name: "完", level: 1, pct: 100 },
      { uid: 2, name: "途中", level: 1, pct: 1 },
      { uid: 3, name: "途中2", level: 1, pct: 99 },
      { uid: 4, name: "未", level: 1, pct: 0, notes: "メモ&amp;補足" },
      { uid: 5, name: "節目", level: 1, milestone: true, start: "2026-03-01T08:00:00", finish: "2026-03-01T08:00:00" },
    ])).items;
    expect(rows.map(r => r.status)).toEqual(["done", "in_progress", "in_progress", "todo", "todo"]);
    expect(rows[3].memo).toBe("メモ&補足");
    expect(rows[4].milestone).toBe(true);
  });

  it("4種の依存とラグ換算：稼働日=480分・経過=1440分・MinutesPerDay・負（リード）・端数の警告", () => {
    const tasks: T[] = [
      { uid: 1, name: "先行", level: 1 },
      { uid: 2, name: "既定FS", level: 1, links: [{ uid: 1 }] },
      { uid: 3, name: "FF+6日", level: 1, links: [{ uid: 1, type: 0, lag: 28800, fmt: 7 }] },
      { uid: 4, name: "SF経過1日", level: 1, links: [{ uid: 1, type: 2, lag: 14400, fmt: 8 }] },
      { uid: 5, name: "SS-1日", level: 1, links: [{ uid: 1, type: 3, lag: -4800, fmt: 7 }] },
      { uid: 6, name: "半日", level: 1, links: [{ uid: 1, type: 1, lag: 2400, fmt: 7 }] },
    ];
    const { rows, warnings } = rowsOf(xml(tasks), false);
    const pred = (name: string) => rows.find(r => r.name === name)?.predecessors[0];
    expect(pred("既定FS")).toEqual({ id: "1", type: "FS", lagDays: 0 });
    expect(pred("FF+6日")).toEqual({ id: "1", type: "FF", lagDays: 6 });
    expect(pred("SF経過1日")).toEqual({ id: "1", type: "SF", lagDays: 1 });
    expect(pred("SS-1日")).toEqual({ id: "1", type: "SS", lagDays: -1 });
    expect(pred("半日")?.lagDays).toBe(1);
    expect(warnings.join()).toContain("端数");
    expect(rows.find(r => r.name === "半日")?.warnings.join()).toContain("端数");

    // MinutesPerDay=600 のプロジェクトでは 600分=1日
    const r600 = rowsOf(xml([
      { uid: 1, name: "先行", level: 1 },
      { uid: 2, name: "後続", level: 1, links: [{ uid: 1, lag: 12000, fmt: 7 }] },
    ], "", "<MinutesPerDay>600</MinutesPerDay>"), false);
    expect(r600.rows[1].predecessors[0].lagDays).toBe(2);
    expect(r600.warnings).toEqual([]);
  });

  it("LagFormat の経過時間判定（3=m・4=em・7=d・8=ed・10=ew、見積り版は+32、13・14は割合）", () => {
    expect([3, 5, 7, 9, 11, 13, 35, 39].map(isElapsedLagFormat)).toEqual([false, false, false, false, false, false, false, false]);
    expect([4, 6, 8, 10, 12, 14, 36, 40].map(isElapsedLagFormat)).toEqual([true, true, true, true, true, true, true, true]);
    const { rows, warnings } = rowsOf(xml([
      { uid: 1, name: "先行", level: 1 },
      { uid: 2, name: "割合", level: 1, links: [{ uid: 1, lag: 500, fmt: 13 }] },
    ]), false);
    expect(rows[1].predecessors[0].lagDays).toBe(0);
    expect(warnings.join()).toContain("割合");
  });

  it("担当者：Assignment から引き、複数はカンマでつなぐ", () => {
    const extra = "<Resources><Resource><UID>0</UID></Resource><Resource><UID>1</UID><Name>山田 太郎</Name></Resource><Resource><UID>2</UID><Name>佐藤</Name></Resource></Resources>"
      + "<Assignments><Assignment><TaskUID>1</TaskUID><ResourceUID>1</ResourceUID></Assignment><Assignment><TaskUID>1</TaskUID><ResourceUID>2</ResourceUID></Assignment><Assignment><TaskUID>2</TaskUID><ResourceUID>-65535</ResourceUID></Assignment></Assignments>";
    const items = ok(xml([{ uid: 1, name: "a", level: 1 }, { uid: 2, name: "b", level: 1 }], extra)).items;
    expect(items[0].assigneeText).toBe("山田 太郎、佐藤");
    expect(items[1].assigneeText).toBe("");
  });

  it("名前空間なし・接頭辞つきでも読める。ProjectLibre 風の最小XML", () => {
    const plain = '<?xml version="1.0"?><Project><Tasks><Task><UID>1</UID><Name>X</Name><OutlineLevel>1</OutlineLevel></Task></Tasks></Project>';
    expect(ok(plain).items[0].name).toBe("X");
    const prefixed = '<p:Project xmlns:p="http://schemas.microsoft.com/project"><p:Tasks><p:Task><p:UID>1</p:UID><p:Name>Y</p:Name><p:OutlineLevel>1</p:OutlineLevel></p:Task></p:Tasks></p:Project>';
    expect(ok(prefixed).items[0].name).toBe("Y");
    // ProjectLibre 風：プロジェクト要約の UID=0 に続き、Summary・OutlineNumber を持つ
    const pl = `<?xml version="1.0" encoding="UTF-8"?><Project ${NS}><SaveVersion>12</SaveVersion><MinutesPerDay>480</MinutesPerDay><Tasks>`
      + "<Task><UID>0</UID><ID>0</ID><Name>P</Name><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>"
      + "<Task><UID>1</UID><ID>1</ID><Name>親</Name><OutlineNumber>1</OutlineNumber><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Start>2026-04-01T08:00:00</Start><Finish>2026-04-10T17:00:00</Finish></Task>"
      + "<Task><UID>2</UID><ID>2</ID><Name>子</Name><OutlineNumber>1.1</OutlineNumber><OutlineLevel>2</OutlineLevel><PercentComplete>50</PercentComplete></Task>"
      + "</Tasks></Project>";
    const { rows } = rowsOf(pl, true);
    expect(rows.map(r => [r.name, r.isGroup, r.depth, r.status])).toEqual([["親", true, 0, "todo"], ["子", false, 0, "in_progress"]]);
    // GanttProject 風：Task に ExtendedAttribute 等の余分な要素があっても読む
    const gp = `<?xml version="1.0" encoding="UTF-8"?><Project ${NS}><Title>GP</Title><Tasks><Task><UID>1</UID><ID>1</ID><Name>t</Name><OutlineLevel>1</OutlineLevel><ExtendedAttribute><FieldID>1</FieldID><Value>z</Value></ExtendedAttribute><PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task></Tasks></Project>`;
    const g = rowsOf(gp, false);
    expect(g.title).toBe("GP");
    expect(g.rows[0].predecessors).toEqual([]);
    expect(g.rows[0].warnings.join()).toContain("自分自身");
  });

  it("Project 以外・空は分かりやすいエラー", () => {
    expect(parseMspdi("<html/>").ok).toBe(false);
    expect(parseMspdi("<Project><Tasks/></Project>").ok).toBe(false);
    expect(parseMspdi("<Project>").ok).toBe(false);
  });

  it("先行が別の行・グループ指定・種類とラグが plan まで届く", () => {
    const { rows, title, warnings } = rowsOf(xml([
      { uid: 1, name: "G", level: 1 },
      { uid: 2, name: "a", level: 2, start: "2026-01-05T08:00:00", finish: "2026-01-06T17:00:00" },
      { uid: 3, name: "b", level: 2, links: [{ uid: 2, type: 3, lag: 9600, fmt: 7 }, { uid: 1 }] },
    ]), true);
    expect(rows[2].predecessors).toEqual([{ id: "2", type: "SS", lagDays: 2 }]);
    expect(rows[2].warnings.join()).toContain("グループ");
    let n = 0;
    const plan = buildWbsPlan({ title, rows, warnings }, {
      target: { kind: "new", name: "P", purpose: "p", color: "#000" }, currentUserId: "me", members: [],
      existingTasks: [], existingSections: [], now: "2026-10-30T00:00:00.000Z", newId: () => `i${++n}`,
    });
    expect(plan.sections.map(s => s.name)).toEqual(["G"]);
    expect(plan.tasks.map(t => t.name)).toEqual(["a", "b"]);
    expect(plan.tasks.every(t => t.parent_task_id === null && t.section_id === plan.sections[0].id)).toBe(true);
    expect(plan.dependencies).toEqual([{ predecessorTaskId: plan.tasks[0].id, successorTaskId: plan.tasks[1].id, depType: "SS", lagDays: 2 }]);
  });
});

describe("loadWbsBytes（拡張子ごとの振り分け）", () => {
  it(".xml は MSPDI、.mpp は案内つきエラー", async () => {
    const bytes = new TextEncoder().encode(xml(FIVE));
    const o = await loadWbsBytes("plan.xml", bytes);
    expect(o.ok && o.source.kind).toBe("items");
    const m = await loadWbsBytes("plan.mpp", new Uint8Array([1, 2, 3]));
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.error).toContain("XML 形式");
  });
});
