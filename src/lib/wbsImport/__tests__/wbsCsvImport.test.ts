// 各種ツールの CSV 取り込みのテスト。各ツールの実物の書き出しは手元に無いため、
// 公開されている列名（Asana: Task ID/Name/Parent task/Assignee/Start Date/Due Date、Jira: Issue key/Summary/Parent、
// Redmine: #/題名/親チケット/開始日/期日、Backlog: キー/件名/親課題/開始日/期限日 など）から作った架空の最小例である。
import { describe, it, expect } from "vitest";
import { detectDelimiter, parseDelimited } from "../wbsCsv";
import { autoMapping, guessRole, itemsFromTable, tableFromGrid, type WbsColumnMapping } from "../wbsColumns";
import { buildRowsFromItems, parseWbsStatus } from "../wbsItems";
import { parseWbsDate, parseWbsGrid } from "../wbsParse";
import { parsePredecessorText } from "../wbsPredecessors";
import { loadWbsBytes } from "../wbsFileLoader";
import { decodeTextBytesStrict } from "../../textDecode";
import { makeXlsx, HEADER } from "./wbsTestHelpers";

/** テスト用の Shift_JIS 符号化：TextDecoder で全2バイト符号を引いて逆表を作る（Node に符号化器が無いため） */
function encodeSjis(text: string): Uint8Array {
  const dec = new TextDecoder("shift_jis");
  const rev = new Map<string, number[]>();
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([lead, trail]));
      if (ch.length === 1 && ch !== "�" && !rev.has(ch)) rev.set(ch, [lead, trail]);
    }
  }
  const out: number[] = [];
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x80) out.push(ch.charCodeAt(0));
    else {
      const b = rev.get(ch);
      if (!b) throw new Error(`Shift_JIS にできない文字: ${ch}`);
      out.push(...b);
    }
  }
  return new Uint8Array(out);
}

/** CSV 本文 → 自動対応づけ → 行（グループ切替つき） */
function importCsv(text: string, opts: { groupTop?: boolean; patch?: (m: WbsColumnMapping) => void } = {}) {
  const grid = parseDelimited(text, detectDelimiter(text));
  const table = tableFromGrid(grid);
  if (!table) throw new Error("表にならない");
  const mapping = autoMapping(table);
  opts.patch?.(mapping);
  const t = itemsFromTable(table, mapping);
  const parsed = buildRowsFromItems(t.items, { groupTop: opts.groupTop ?? false, mode: t.mode, title: null, warnings: t.warnings });
  return { mapping, parsed, rows: parsed.rows, table };
}

describe("parseDelimited / detectDelimiter", () => {
  it("引用符・改行入りセル・二重引用符・CRLF・BOM", () => {
    const text = '\uFEFFa,b,c\r\n1,"x,y","line1\nline2"\r\n2,"say ""hi""",\r\n';
    expect(parseDelimited(text, ",")).toEqual([["a", "b", "c"], ["1", "x,y", "line1\nline2"], ["2", 'say "hi"', ""]]);
  });
  it("区切りの自動判定（, タブ ;）。引用符の中の区切りは数えない", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter('"a,b,c";d\n1;2')).toBe(";");
  });
});

describe("見出しの推定", () => {
  it("大文字小文字・全半角・空白・記号を無視する", () => {
    expect(guessRole("TASK NAME")).toBe("name");
    expect(guessRole("Ｔａｓｋ\u3000ＩＤ")).toBe("id");
    expect(guessRole(" parent_task ")).toBe("parent");
    expect(guessRole("% Complete")).toBe("status");
    expect(guessRole("Issue key")).toBe("id");
    expect(guessRole("WBS")).toBe("wbs");
    expect(guessRole("期限日")).toBe("end");
    expect(guessRole("Blocked By")).toBe("pred");
    expect(guessRole("謎の列")).toBeNull();
  });
});

describe("ツール別のCSV", () => {
  it("Asana風：親の名前で指定・親が子より後ろ・担当者・メモ", () => {
    const csv = [
      "Task ID,Name,Assignee,Start Date,Due Date,Parent task,Notes",
      "3,子B,山田,2026-02-03,2026-02-04,親X,詳細B",
      "1,親X,,2026-02-01,2026-02-10,,",
      "4,子A,,2026-02-01,2026-02-02,親X,",
      "5,孫,,2026-02-01,2026-02-01,子A,",
    ].join("\n");
    const { rows, mapping } = importCsv(csv);
    expect(mapping.hierarchy).toBe("parent");
    // 親が先、子は元の順
    expect(rows.map(r => r.name)).toEqual(["親X", "子B", "子A", "孫"]);
    expect(rows.map(r => r.depth)).toEqual([0, 1, 1, 2]);
    expect(rows[1].parentIndex).toBe(0);
    expect(rows[3].parentIndex).toBe(2);
    expect(rows[1].assigneeText).toBe("山田");
    expect(rows[1].memo).toBe("詳細B");
    expect(rows[1].start).toBe("2026-02-03");
  });

  it("グループON：最上位で子を持つ行がグループになる", () => {
    const csv = "Task ID,Name,Parent task\n1,P1,\n2,c,P1\n3,単独,\n";
    const { rows } = importCsv(csv, { groupTop: true });
    expect(rows.map(r => [r.name, r.isGroup, r.depth])).toEqual([["P1", true, 0], ["c", false, 0], ["単独", false, 0]]);
    expect(rows[1].groupIndex).toBe(0);
    expect(rows[2].groupIndex).toBeNull();
  });

  it("Jira風：Issue key・Parent・Summary・Blocked By・Status", () => {
    const csv = [
      "Issue key,Summary,Parent,Status,Blocked By,Due date",
      "PRJ-1,エピック,,In Progress,,",
      "PRJ-2,タスクA,PRJ-1,Done,,3/4/2026",
      "PRJ-3,タスクB,PRJ-1,To Do,PRJ-2,13/4/2026",
      "PRJ-4,不明な親,PRJ-99,Closed,,",
    ].join("\n");
    const { rows, parsed } = importCsv(csv);
    expect(rows.map(r => [r.id, r.parentIndex])).toEqual([["PRJ-1", null], ["PRJ-2", 0], ["PRJ-3", 0], ["PRJ-4", null]]);
    expect(rows.map(r => r.status)).toEqual(["in_progress", "done", "todo", "done"]);
    // 「PRJ-2」のハイフン＋数字をラグと読まない
    expect(rows[2].predecessors).toEqual([{ id: "PRJ-2", type: "FS", lagDays: 0 }]);
    expect(rows[3].warnings.join()).toContain("PRJ-99");
    // M/D/YYYY：3/4/2026 は曖昧（3月4日と読む）、13/4/2026 は日が13と確定（4月13日）
    expect(rows[1].end).toBe("2026-03-04");
    expect(rows[2].end).toBe("2026-04-13");
    expect(parsed.warnings.join()).toContain("月/日/年");
    expect(parsed.warnings.join()).toContain("1件");
  });

  it("Redmine風：# ・題名・親チケット・日本語・Shift_JIS", () => {
    const text = [
      "#,題名,親チケット,開始日,期日,進捗率,担当者",
      "10,設計,,2026/01/05,2026/01/09,100,山田",
      "11,詳細設計,10,2026/01/05,2026/01/06,50,",
      "12,レビュー,#10,2026/01/07,2026/01/08,0,",
    ].join("\r\n");
    const bytes = encodeSjis(text);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toThrow();
    expect(decodeTextBytesStrict(bytes)).toBe(text);
    const { rows, mapping } = importCsv(decodeTextBytesStrict(bytes));
    expect(mapping.hierarchy).toBe("parent");
    expect(rows.map(r => r.name)).toEqual(["設計", "詳細設計", "レビュー"]);
    expect(rows[1].parentIndex).toBe(0);
    // 「#10」は一致しないので最上位＋警告（Redmine の書き出しは数値のみ）
    expect(rows[2].parentIndex).toBeNull();
    expect(rows[2].warnings.join()).toContain("#10");
    expect(rows.map(r => r.status)).toEqual(["done", "in_progress", "todo"]);
    expect(rows[0].start).toBe("2026-01-05");
  });

  it("Shift_JIS／UTF-8（BOMあり・なし）を loadWbsBytes が読み分ける", async () => {
    const text = "ID,タスク名,開始日\n1,設計,2026-01-05\n";
    const sj = await loadWbsBytes("a.csv", encodeSjis(text));
    const u8 = await loadWbsBytes("b.csv", new TextEncoder().encode(text));
    const bom = await loadWbsBytes("c.csv", new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]));
    for (const o of [sj, u8, bom]) {
      expect(o.ok).toBe(true);
      if (o.ok && o.source.kind === "table") {
        expect(o.source.table.header).toEqual(["ID", "タスク名", "開始日"]);
        expect(o.source.table.rows[0][1]).toBe("設計");
      } else throw new Error("table ではない");
    }
  });

  it("Backlog風：キー・件名・親課題・期限日（親課題はキーで指定）", () => {
    const csv = "キー,件名,親課題,開始日,期限日,状態\nPJ-1,親課題の件,,2026-03-01,2026-03-31,処理中\nPJ-2,子課題,PJ-1,2026-03-02,2026-03-03,完了\n";
    const { rows } = importCsv(csv);
    expect(rows.map(r => [r.name, r.parentIndex, r.status])).toEqual([["親課題の件", null, "in_progress"], ["子課題", 0, "done"]]);
    expect(rows[1].end).toBe("2026-03-03");
  });

  it("WBS番号：1.2.3 の桁数で深さを決める（階層が飛んでも直近の上位へ）", () => {
    const csv = "WBS,Name\n1,A\n1.1,A1\n1.1.1,A11\n1.2,A2\n2,B\n2.1.1,B?\n";
    const { rows, mapping } = importCsv(csv);
    expect(mapping.hierarchy).toBe("wbs");
    expect(rows.map(r => r.depth)).toEqual([0, 1, 2, 1, 0, 1]);
    expect(rows[5].parentIndex).toBe(4);
    expect(rows[5].warnings.join()).toContain("階層が飛んでいます");
    expect(rows.map(r => r.id)).toEqual(["1", "1.1", "1.1.1", "1.2", "2", "2.1.1"]);
  });

  it("レベル列：Outline Level（1始まり／0始まりどちらでも最小を最上位に）", () => {
    const one = importCsv("Outline Level,Name\n1,a\n2,b\n3,c\n2,d\n").rows;
    expect(one.map(r => r.depth)).toEqual([0, 1, 2, 1]);
    const zero = importCsv("レベル,タスク名\n0,a\n1,b\n").rows;
    expect(zero.map(r => r.depth)).toEqual([0, 1]);
  });

  it("インデント（半角空白・全角空白・タブ）", () => {
    const csv = ["Name,Start", "親,2026-01-01", "  子1,2026-01-02", "    孫,2026-01-03", "  子2,2026-01-04", "\u3000子3全角,2026-01-05", "別の親,2026-01-06"].join("\n");
    const { rows, mapping } = importCsv(csv);
    expect(mapping.hierarchy).toBe("indent");
    expect(rows.map(r => [r.name, r.depth])).toEqual([["親", 0], ["子1", 1], ["孫", 2], ["子2", 1], ["子3全角", 1], ["別の親", 0]]);
    const tab = importCsv("Name,Start\n親,\n\t子,\n").rows;
    expect(tab.map(r => r.depth)).toEqual([0, 1]);
  });

  it("階層なし・階層の取り方の手動変更", () => {
    const csv = "Name,Parent\na,\nb,a\n";
    const none = importCsv(csv, { patch: m => { m.hierarchy = "none"; } }).rows;
    expect(none.map(r => r.depth)).toEqual([0, 0]);
    const plain = importCsv("Name\na\nb\n").rows;
    expect(plain.every(r => r.parentIndex === null)).toBe(true);
  });

  it("引用符と改行入りのセル（メモ・名前）", () => {
    const csv = 'ID,Name,Notes\n1,"名前, カンマ入り","1行目\n2行目"\n2,次,\n';
    const { rows } = importCsv(csv);
    expect(rows.map(r => r.name)).toEqual(["名前, カンマ入り", "次"]);
    expect(rows[0].memo).toBe("1行目 2行目");
  });

  it("親の循環は切る・親が自分自身は最上位", () => {
    const csv = "ID,Name,Parent\n1,a,2\n2,b,1\n3,c,3\n";
    const { rows } = importCsv(csv);
    expect(rows.length).toBe(3);
    expect(rows.some(r => r.warnings.join().includes("循環"))).toBe(true);
    expect(rows.find(r => r.name === "c")?.parentIndex).toBeNull();
  });

  it("列の役割を手で直せる（名前の見出しが辞書に無い表）", () => {
    const csv = "作業項目,予定開始\nあ,2026-05-01\nい,2026-05-02\n";
    const { rows, table } = importCsv(csv);
    expect(rows.map(r => r.name)).toEqual(["あ", "い"]); // 名前の見出しが無いとき最初の列が名前
    const m = autoMapping(table);
    m.columns.start = 1;
    expect(itemsFromTable(table, m).items[0].start).toBe("2026-05-01");
  });
});

describe("xlsx（テンプレートに合わない表）", () => {
  it("英語見出しの xlsx は対応づけ画面へ、テンプレートの xlsx は従来どおり", async () => {
    const generic = makeXlsx([{ name: "Sheet1", rows: [["Task Name", "Parent", "Due Date"], ["a", null, "2026-01-05"], ["b", "a", 46027]] }]);
    const g = await loadWbsBytes("g.xlsx", generic);
    expect(g.ok && g.source.kind).toBe("table");
    if (g.ok && g.source.kind === "table") {
      const m = autoMapping(g.source.table);
      const t = itemsFromTable(g.source.table, m);
      expect(t.items.map(i => i.end)).toEqual(["2026-01-05", "2026-01-05"]);
    }
    const tpl = makeXlsx([{ name: "WBS", rows: [HEADER, ["1", "G", "準備", null, null, null, null, null], ["1.1", "P", "要件", null, null, null, null, null]] }]);
    const t = await loadWbsBytes("t.xlsx", tpl);
    expect(t.ok && t.source.kind).toBe("rows");
  });
});

describe("状態・日付・先行の表記", () => {
  it("状態", () => {
    const todo = ["", "未着手", "Open", "To Do", "0%", "0", "New"];
    expect(todo.map(parseWbsStatus)).toEqual(todo.map(() => "todo"));
    const done = ["完了", "Done", "Closed", "Resolved", "完了済み", "100%", "100", "done"];
    expect(done.map(parseWbsStatus)).toEqual(done.map(() => "done"));
    const doing = ["進行中", "In Progress", "対応中", "処理中", "in-progress", "50%", "50"];
    expect(doing.map(parseWbsStatus)).toEqual(doing.map(() => "in_progress"));
    expect(parseWbsStatus(1)).toBe("done");
    expect(parseWbsStatus(0.4)).toBe("in_progress");
  });

  it("日付：各表記・Excelシリアル・日時つき・M/D と D/M の曖昧さ", () => {
    expect(parseWbsDate("2026-01-05").value).toBe("2026-01-05");
    expect(parseWbsDate("2026/1/5").value).toBe("2026-01-05");
    expect(parseWbsDate("2026年1月5日").value).toBe("2026-01-05");
    expect(parseWbsDate("2026-01-05T09:30:00").value).toBe("2026-01-05");
    expect(parseWbsDate("2026-01-05 09:30").value).toBe("2026-01-05");
    expect(parseWbsDate(46027).value).toBe("2026-01-05");
    expect(parseWbsDate("3/4/2026")).toMatchObject({ value: "2026-03-04", ambiguous: true });
    expect(parseWbsDate("3/3/2026").ambiguous).toBe(false);
    expect(parseWbsDate("13/4/2026")).toMatchObject({ value: "2026-04-13" });
    expect(parseWbsDate("12/31/2026")).toMatchObject({ value: "2026-12-31" });
    expect(parseWbsDate("2/30/2026").invalid).toBe(true);
    expect(parseWbsDate("あした").invalid).toBe(true);
  });

  it("先行：カンマ・セミコロン区切りと「3FS+2」「3SS-1d」", () => {
    const known = (id: string) => ["1", "2", "3", "BFS", "1.1"].includes(id);
    expect(parsePredecessorText("1, 2;3", known).map(p => p.id)).toEqual(["1", "2", "3"]);
    expect(parsePredecessorText("3FS+2", known)).toEqual([{ id: "3", type: "FS", lagDays: 2, note: undefined }]);
    expect(parsePredecessorText("3SS-1d", known)[0]).toMatchObject({ id: "3", type: "SS", lagDays: -1 });
    expect(parsePredecessorText("2ff", known)[0]).toMatchObject({ id: "2", type: "FF", lagDays: 0 });
    expect(parsePredecessorText("2SF + 3 days", known)[0]).toMatchObject({ id: "2", type: "SF", lagDays: 3 });
    expect(parsePredecessorText("1.1FS+1日", known)[0]).toMatchObject({ id: "1.1", type: "FS", lagDays: 1 });
    expect(parsePredecessorText("3+2d", known)[0]).toMatchObject({ id: "3", type: "FS", lagDays: 2 });
    expect(parsePredecessorText("BFS", known)).toEqual([{ id: "BFS", type: "FS", lagDays: 0 }]);
    expect(parsePredecessorText("PRJ-12", known)).toEqual([{ id: "PRJ-12", type: "FS", lagDays: 0 }]);
    expect(parsePredecessorText("1 2", known).map(p => p.id)).toEqual(["1", "2"]);
    expect(parsePredecessorText("2FS+1.5", known)[0].note).toContain("端数");
  });
});

describe("固定列テンプレートの先行タスク列に種類・ラグを書ける", () => {
  it("3FS+2 / 3SS-1d が predecessors に入る", () => {
    const o = parseWbsGrid([
      HEADER,
      ["1", "G", "g", null, null, null, null, null],
      ["1.1", "P", "a", null, null, null, null, null],
      ["1.2", "P", "b", null, null, null, "1.1SS-1d", null],
      ["1.3", "P", "c", null, null, null, "1.1FS+2, 1.2", null],
    ]);
    if (!o.ok) throw new Error(o.error);
    expect(o.result.rows[2].predecessors).toEqual([{ id: "1.1", type: "SS", lagDays: -1 }]);
    expect(o.result.rows[3].predecessors).toEqual([{ id: "1.1", type: "FS", lagDays: 2 }, { id: "1.2", type: "FS", lagDays: 0 }]);
  });
});
