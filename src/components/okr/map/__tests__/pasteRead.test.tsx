// 貼り付けて読ませる（v3.222）。読み取りはファイル選択と同じ関数へ File として渡す。
import "../../../../__tests__/miniDom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { canReadPasted, pastedFileName, readPastedText } from "../pasteRead";
import { PasteReadBox } from "../parts/PasteReadBox";
import { buildCopilotPrompt } from "../copilotPrompt";

interface MiniEl { tagName?: string; textContent: string; childNodes: MiniEl[]; hasAttribute?: (k: string) => boolean }
// miniDom には querySelector が無いので、木をたどって探す
function findButton(n: MiniEl, label: string): MiniEl | undefined {
  if (n.tagName?.toLowerCase() === "button" && n.textContent === label) return n;
  for (const ch of n.childNodes) {
    const r = findButton(ch, label);
    if (r) return r;
  }
  return undefined;
}

const NOW = new Date(2026, 10, 18, 9, 5);

describe("読ませる File", () => {
  it("貼った本文が、readFiles（ファイル選択と同じ関数）へ text/plain の File で1件渡る。名前は「貼り付け_」", async () => {
    const readFiles = vi.fn(async () => ({ errors: [], notices: [] }));
    await readPastedText("議事メモです", NOW, readFiles);
    expect(readFiles).toHaveBeenCalledTimes(1);
    const [list] = readFiles.mock.calls[0] as unknown as [File[]];
    expect(list).toHaveLength(1);
    expect(list[0]).toBeInstanceOf(File);
    expect(list[0].name).toBe("貼り付け_20261118_0905.txt");
    expect(list[0].type).toBe("text/plain");
    expect(await list[0].text()).toBe("議事メモです");
  });
  it("「■KR」見出しを含む（Copilot 用プロンプトの出力の形）なら名前は「Copilot要約_」", async () => {
    expect(pastedFileName("■KR1 共創\n① …", NOW)).toBe("Copilot要約_20261118_0905.txt");
    expect(pastedFileName("ふつうの文章", NOW)).toBe("貼り付け_20261118_0905.txt");
    // プロンプトに指示した見出し「■KR番号 題名」の形と食い違わない
    expect(buildCopilotPrompt([{ label: "KR1", text: "x", def: null }])).toContain("■KR");
  });
});

describe("押せる条件・成功と失敗", () => {
  it("空白だけでは押せず、readFiles も呼ばれない", async () => {
    expect(canReadPasted("")).toBe(false);
    expect(canReadPasted(" \n\u3000 ")).toBe(false);
    expect(canReadPasted("a")).toBe(true);
    const readFiles = vi.fn(async () => ({ errors: [], notices: [] }));
    expect(await readPastedText("  \n ", NOW, readFiles)).toBe(false);
    expect(readFiles).not.toHaveBeenCalled();
  });
  it("成功（エラーなし）なら true＝欄を空にしてよい。失敗（エラーあり）なら false＝本文を残す", async () => {
    expect(await readPastedText("本文", NOW, async () => ({ errors: [], notices: [] }))).toBe(true);
    expect(await readPastedText("本文", NOW, async () => ({ errors: ["読めませんでした"], notices: [] }))).toBe(false);
  });
  it("欄は、空のうちは「この文章を読ませる」が押せず、文字数を出す", () => {
    const c = document.createElement("div");
    const root = createRoot(c);
    act(() => root.render(createElement(PasteReadBox, { readFiles: async () => ({ errors: [], notices: [] }), disabled: false })));
    expect(c.textContent).toContain("文章を貼り付けて読ませる");
    expect(c.textContent).toContain("Copilot の回答や議事メモをそのまま貼れます");
    expect(c.textContent).toContain("0字");
    const btn = findButton(c as unknown as MiniEl, "この文章を読ませる");
    expect(btn?.hasAttribute?.("disabled")).toBe(true);
    act(() => root.unmount());
  });
});
