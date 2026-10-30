// src/lib/wbsImport/wbsCsv.ts
//
// 【設計意図・v3.198】
// 区切り文字つきテキスト（CSV／TSV／セミコロン区切り）を行×列にする純粋関数。外部ライブラリは使わない。
// 引用符（"..."）の中の区切り・改行・二重引用符（""）に対応する。

export type Delimiter = "," | "\t" | ";";

/** 先頭の数行（引用符の外）で、各区切りの出現数が最大のものを選ぶ。同数なら , → タブ → ; の順 */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, "\t": 0, ";": 0 };
  let inQuote = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 5; i++) {
    const c = text[i];
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote) {
      if (c === "\n") { if (counts[","] + counts["\t"] + counts[";"] > 0) lines++; }
      else if (c === "," || c === "\t" || c === ";") counts[c]++;
    }
  }
  const order: Delimiter[] = [",", "\t", ";"];
  return order.reduce((best, d) => (counts[d] > counts[best] ? d : best), "," as Delimiter);
}

export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuote = false;
  let cellStarted = false;
  const endCell = () => { row.push(cell); cell = ""; cellStarted = false; };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuote) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuote = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && !cellStarted) { inQuote = true; cellStarted = true; continue; }
    if (c === delimiter) { endCell(); continue; }
    if (c === "\r") { if (src[i + 1] === "\n") i++; endRow(); continue; }
    if (c === "\n") { endRow(); continue; }
    cell += c;
    cellStarted = true;
  }
  if (cellStarted || cell !== "" || row.length > 0) endRow();
  return rows;
}
