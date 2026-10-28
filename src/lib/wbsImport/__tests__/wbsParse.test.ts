import { describe, it, expect } from "vitest";
import { parseWbsGrid, parseWbsMarkdown, parseWbsSheets, parseWbsDate, type WbsCell } from "../wbsParse";
import { extractXlsxGrids } from "../../xlsxGrid";
import { makeXlsx, HEADER, SERIAL_20260105 } from "./wbsTestHelpers";

const ok = (o: ReturnType<typeof parseWbsGrid>) => {
  if (!o.ok) throw new Error(o.error);
  return o.result;
};

const BASE: WbsCell[][] = [
  HEADER,
  ["1", "G", "準備", null, null, null, null, null],
  ["1.1", "P", "要件整理", "2026-01-05", "2026-01-09", 5, null, null],
  ["1.1.1", "C", "ヒアリング", "2026/1/5", "2026/1/6", 2, null, "完了"],
  ["1.1.2", "C", "まとめ", "2026-01-07", "2026-01-09", 3, "1.1.1", "ユーザー・仮"],
  ["1.2", "P", "判断日", "2026-01-12", "2026-01-12", 1, "1.1", "マイルストーン・社内確認"],
  ["2", "G", "実施", null, null, null, null, null],
  ["2.1", "P", "構築", "2026-01-13", "2026-01-20", 6, "1.2, 1.1.2", null],
];

describe("parseWbsGrid", () => {
  it("G・P・C の階層・日付・先行タスク・備考を読む", () => {
    const r = ok(parseWbsGrid(BASE));
    expect(r.rows.map(x => x.level).join("")).toBe("GPCCPGP");
    const [g1, p11, c111, c112, p12, g2, p21] = r.rows;
    expect(c111.parentIndex).toBe(p11.index);
    expect(c111.groupIndex).toBe(g1.index);
    expect(c111.start).toBe("2026-01-05");
    expect(c111.done).toBe(true);
    expect(c112.predecessorIds).toEqual(["1.1.1"]);
    expect(c112.tags).toEqual(["ユーザー", "仮"]);
    expect(p12.milestone).toBe(true);
    expect(p12.memo).toBe("社内確認");
    expect(p12.parentIndex).toBeNull();
    expect(p21.groupIndex).toBe(g2.index);
    expect(p21.predecessorIds).toEqual(["1.2", "1.1.2"]);
    expect(r.rows.every(x => x.warnings.length === 0)).toBe(true);
  });

  it("見出しの位置・列の順番・余分な列に依存しない（結合見出しの空行・タイトル行つき）", () => {
    const grid: WbsCell[][] = [
      ["架空プロジェクトWBS"],
      [],
      ["備考", "余分", "タスク名", "終了日", "開始日", "ID", "階層"],
      [],
      [],
      ["完了", "x", "作業A", "2026-02-02", "2026-02-01", "1", "P"],
    ];
    const r = ok(parseWbsGrid(grid));
    expect(r.title).toBe("架空プロジェクトWBS");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ id: "1", name: "作業A", start: "2026-02-01", end: "2026-02-02", done: true });
  });

  it("IDが空の行（凡例など）で止まる。その後にIDのある行があれば警告する", () => {
    const grid: WbsCell[][] = [...BASE, [null, null, "凡例"], [null, "G", "凡例の説明"]];
    const r = ok(parseWbsGrid(grid));
    expect(r.rows).toHaveLength(7);
    expect(r.warnings).toHaveLength(0);
    const r2 = ok(parseWbsGrid([...BASE, [null], ["9", "P", "離れた行", null, null]]));
    expect(r2.rows).toHaveLength(7);
    expect(r2.warnings[0]).toContain("読んでいません");
  });

  it("階層列が無ければIDの深さから決める", () => {
    const r = ok(parseWbsGrid([["ID", "タスク名"], ["1", "a"], ["1.1", "b"], ["1.1.1", "c"]]));
    expect(r.rows.map(x => x.level).join("")).toBe("GPC");
  });

  it("日付：Excelの日付・YYYY-MM-DD・YYYY/MM/DD・YYYY/M/D", () => {
    expect(parseWbsDate(SERIAL_20260105).value).toBe("2026-01-05");
    expect(parseWbsDate("2026-01-05").value).toBe("2026-01-05");
    expect(parseWbsDate("2026/01/05").value).toBe("2026-01-05");
    expect(parseWbsDate("2026/1/5").value).toBe("2026-01-05");
    expect(parseWbsDate("2026-01-05 00:00:00").value).toBe("2026-01-05");
    expect(parseWbsDate("").invalid).toBe(false);
    expect(parseWbsDate("2026/2/30").invalid).toBe(true);
    expect(parseWbsDate("来週").invalid).toBe(true);
  });

  it("不正な行は警告：日付が読めない・開始が終了より後・先行IDなし・階層の並び", () => {
    const r = ok(parseWbsGrid([
      HEADER,
      ["1", "C", "親なしの子", "あした", "2026-01-02", 1, null, null],
      ["2", "P", "逆転", "2026-03-10", "2026-03-01", 1, "9.9", null],
      ["3", "X", "階層不明", null, null, null, null, null],
      ["4", "P", null, null, null, null, null, null],
    ]));
    expect(r.rows).toHaveLength(2);
    expect(r.warnings).toHaveLength(2);
    const [c, p] = r.rows;
    expect(c.warnings.join()).toContain("開始日を日付として読めません");
    expect(c.warnings.join()).toContain("親（P）がありません");
    expect(c.start).toBeNull();
    expect(p.warnings.join()).toContain("開始日が終了日より後");
    expect(p.start).toBeNull();
    expect(p.end).toBeNull();
    expect(p.warnings.join()).toContain("「9.9」が見つかりません");
    expect(p.predecessorIds).toEqual([]);
  });

  it("先行タスク：自己参照・循環・グループ指定は警告して読み飛ばす", () => {
    const r = ok(parseWbsGrid([
      HEADER,
      ["1", "G", "g", null, null, null, "1.1", null],
      ["1.1", "P", "a", null, null, null, "1.1, 1.2", null],
      ["1.2", "P", "b", null, null, null, "1.1", null],
      ["1.3", "P", "c", null, null, null, "1", null],
    ]));
    const [g, a, b, c] = r.rows;
    expect(g.warnings.join()).toContain("グループ（G）の先行タスク");
    expect(a.predecessorIds).toEqual(["1.2"]);
    expect(a.warnings.join()).toContain("自分自身");
    expect(b.predecessorIds).toEqual([]);
    expect(b.warnings.join()).toContain("循環");
    expect(c.warnings.join()).toContain("グループ（G）のため");
  });

  it("見出し・データが無ければエラー", () => {
    expect(parseWbsGrid([["a", "b"]]).ok).toBe(false);
    expect(parseWbsGrid([HEADER]).ok).toBe(false);
  });
});

describe("parseWbsMarkdown", () => {
  const md = [
    "# 架空WBS",
    "",
    "説明文",
    "",
    "| ID | 階層 | タスク名 | 開始日 | 終了日 | 日数 | 先行タスク | 備考 |",
    "|---|---|---|---|---|---|---|---|",
    "| 1 | G | 準備 | | | | | |",
    "| 1.1 | P | **要件** | 2026-01-05 | 2026/1/9 | 5 | | |",
    "| 1.1.1 | C | 調査 \\| 整理 | 2026-01-05 | 2026-01-06 | 2 | 1.1 | 完了・ユーザー |",
    "",
    "| 凡例 | 内容 |",
    "|---|---|",
    "| G | グループ |",
  ].join("\n");

  it("表を読み、先頭の見出しをタイトルにする。凡例の表は読まない", () => {
    const r = ok(parseWbsMarkdown(md));
    expect(r.title).toBe("架空WBS");
    expect(r.rows.map(x => x.name)).toEqual(["準備", "要件", "調査 | 整理"]);
    expect(r.rows[2]).toMatchObject({ done: true, tags: ["ユーザー"], parentIndex: 1 });
    expect(r.rows[2].predecessorIds).toEqual(["1.1"]);
    expect(r.rows[1].end).toBe("2026-01-09");
  });

  it("CRLFでも読める。表が無ければエラー", () => {
    expect(ok(parseWbsMarkdown(md.replace(/\n/g, "\r\n"))).rows).toHaveLength(3);
    expect(parseWbsMarkdown("ただの文章").ok).toBe(false);
  });
});

describe("xlsx（テスト内で生成）", () => {
  it("タイトル行と結合見出しの空行のあと・日付はシリアル値・凡例で止まる・「ガントチャート」を優先する", () => {
    const buf = makeXlsx([
      { name: "説明", rows: [["使い方"]] },
      {
        name: "ガントチャート",
        rows: [
          ["架空WBS"],
          [],
          [],
          HEADER,
          [],
          [],
          ["1", "G", "準備", null, null, null, null, null],
          ["1.1", "P", "要件", SERIAL_20260105, SERIAL_20260105 + 4, "=NETWORKDAYS", null, null],
          [],
          [null, null, "凡例"],
        ],
      },
    ]);
    const sheets = extractXlsxGrids(buf, "ガントチャート");
    expect(sheets[0].name).toBe("ガントチャート");
    const r = ok(parseWbsSheets(sheets));
    expect(r.title).toBe("架空WBS");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]).toMatchObject({ start: "2026-01-05", end: "2026-01-09" });
  });

  it("途中の空行で表を終える／非表示シートは読まない／見出しの無いシートは飛ばす", () => {
    const buf = makeXlsx([
      { name: "隠し", hidden: true, rows: [HEADER, ["1", "G", "隠れた"]] },
      { name: "説明", rows: [["使い方"]] },
      { name: "表", rows: [HEADER, ["1", "G", "a"], [], ["2", "G", "b"]] },
    ]);
    const r = ok(parseWbsSheets(extractXlsxGrids(buf)));
    expect(r.rows.map(x => x.name)).toEqual(["a"]);
    expect(r.warnings[0]).toContain("読んでいません");
  });

  it("見出しのあるシートが無ければエラー", () => {
    const buf = makeXlsx([{ name: "説明", rows: [["使い方"]] }]);
    expect(parseWbsSheets(extractXlsxGrids(buf)).ok).toBe(false);
  });

  it("数値のID（1・1.1）は文字列として読む", () => {
    const buf = makeXlsx([{ name: "表", rows: [HEADER, [1, "G", "a"], [1.1, "P", "b"]] }]);
    const r = ok(parseWbsSheets(extractXlsxGrids(buf)));
    expect(r.rows.map(x => x.id)).toEqual(["1", "1.1"]);
  });
});
