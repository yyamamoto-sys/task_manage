import { describe, it, expect } from "vitest";
import {
  isTypingTarget, isInteractiveTarget, isImeComposing, shouldIgnoreSingleKey, isPlainLetter,
  isUndoKey, shouldRunConsultUndo, moveFocus, type ElementLike,
} from "../keys";
import { computeKanbanOrderedIds } from "../../kanbanOrder";

const input = (type = "text"): ElementLike => ({ tagName: "INPUT", type });
const body: ElementLike = { tagName: "BODY" };
const ctx = (over: Partial<{ activeElement: ElementLike | null; modalOpen: boolean }> = {}) =>
  ({ activeElement: body, modalOpen: false, ...over });

describe("isTypingTarget", () => {
  it("text系input・textarea・select・contenteditableは入力中", () => {
    expect(isTypingTarget(input())).toBe(true);
    expect(isTypingTarget(input("search"))).toBe(true);
    expect(isTypingTarget(input("date"))).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("チェックボックス・ボタン・body・nullは入力中ではない", () => {
    expect(isTypingTarget(input("checkbox"))).toBe(false);
    expect(isTypingTarget(input("range"))).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("shouldIgnoreSingleKey（単キーが発火しない条件）", () => {
  it("素の状態では発火してよい", () => {
    expect(shouldIgnoreSingleKey({ key: "j" }, ctx())).toBe(false);
  });
  it("IME変換中は発火しない（isComposing・key=Process・keyCode=229）", () => {
    expect(shouldIgnoreSingleKey({ key: "j", isComposing: true }, ctx())).toBe(true);
    expect(shouldIgnoreSingleKey({ key: "Process" }, ctx())).toBe(true);
    expect(shouldIgnoreSingleKey({ key: "j", keyCode: 229 }, ctx())).toBe(true);
    expect(isImeComposing({ key: "Enter" })).toBe(false);
  });
  it("入力欄にフォーカスがあると発火しない", () => {
    expect(shouldIgnoreSingleKey({ key: "e" }, ctx({ activeElement: input() }))).toBe(true);
    expect(shouldIgnoreSingleKey({ key: "e" }, ctx({ activeElement: { tagName: "TEXTAREA" } }))).toBe(true);
  });
  it("Ctrl・Alt・Metaを併用すると発火しない（Ctrl+Eなどブラウザ動作を奪わない）", () => {
    expect(shouldIgnoreSingleKey({ key: "e", ctrlKey: true }, ctx())).toBe(true);
    expect(shouldIgnoreSingleKey({ key: "e", metaKey: true }, ctx())).toBe(true);
    expect(shouldIgnoreSingleKey({ key: "e", altKey: true }, ctx())).toBe(true);
  });
  it("モーダルが開いていると発火しない", () => {
    expect(shouldIgnoreSingleKey({ key: "n" }, ctx({ modalOpen: true }))).toBe(true);
  });
  it("他のハンドラが処理済み（defaultPrevented）なら発火しない", () => {
    expect(shouldIgnoreSingleKey({ key: "n", defaultPrevented: true }, ctx())).toBe(true);
  });
  it("Shiftを押しただけの ? は発火できる（?は Shift+/ で生成されるため）", () => {
    expect(shouldIgnoreSingleKey({ key: "?", shiftKey: true }, ctx())).toBe(false);
  });
});

describe("isPlainLetter", () => {
  it("CapsLockの大文字は許可・Shift併用は不許可", () => {
    expect(isPlainLetter({ key: "E" }, "e")).toBe(true);
    expect(isPlainLetter({ key: "e" }, "e")).toBe(true);
    expect(isPlainLetter({ key: "E", shiftKey: true }, "e")).toBe(false);
    expect(isPlainLetter({ key: "j" }, "e")).toBe(false);
  });
});

describe("isInteractiveTarget（Enterを奪うと二重に動く要素）", () => {
  it("ボタン・リンク・role=button・チェックボックスは対象", () => {
    expect(isInteractiveTarget({ tagName: "BUTTON" })).toBe(true);
    expect(isInteractiveTarget({ tagName: "A" })).toBe(true);
    expect(isInteractiveTarget({ tagName: "DIV", getAttribute: n => (n === "role" ? "button" : null) })).toBe(true);
    expect(isInteractiveTarget(input("checkbox"))).toBe(true);
  });
  it("body・通常のdivは対象外", () => {
    expect(isInteractiveTarget(body)).toBe(false);
    expect(isInteractiveTarget({ tagName: "DIV", getAttribute: () => null })).toBe(false);
  });
});

describe("shouldRunConsultUndo（AI相談パネルの Ctrl+Z）", () => {
  const ctrlZ = { key: "z", ctrlKey: true };
  it("入力欄では実行しない（ブラウザ標準の文字の取り消しに任せる）", () => {
    expect(shouldRunConsultUndo(ctrlZ, input())).toBe(false);
    expect(shouldRunConsultUndo(ctrlZ, { tagName: "TEXTAREA" })).toBe(false);
    expect(shouldRunConsultUndo(ctrlZ, { tagName: "DIV", isContentEditable: true })).toBe(false);
  });
  it("入力欄以外では実行する（Ctrl・Cmd）", () => {
    expect(shouldRunConsultUndo(ctrlZ, body)).toBe(true);
    expect(shouldRunConsultUndo({ key: "z", metaKey: true }, body)).toBe(true);
  });
  it("Shift+Ctrl+Z（やり直し）やZ以外は実行しない", () => {
    expect(shouldRunConsultUndo({ key: "z", ctrlKey: true, shiftKey: true }, body)).toBe(false);
    expect(shouldRunConsultUndo({ key: "x", ctrlKey: true }, body)).toBe(false);
    expect(isUndoKey({ key: "z" })).toBe(false);
  });
});

describe("moveFocus（J/K の移動順）", () => {
  const ids = ["a", "b", "c"];
  it("次・前へ動く。端で止まる（循環しない）", () => {
    expect(moveFocus(ids, "a", 1)).toBe("b");
    expect(moveFocus(ids, "c", 1)).toBe("c");
    expect(moveFocus(ids, "b", -1)).toBe("a");
    expect(moveFocus(ids, "a", -1)).toBe("a");
  });
  it("注目が無い・並びに無い（絞り込みで消えた）ときは先頭から", () => {
    expect(moveFocus(ids, null, 1)).toBe("a");
    expect(moveFocus(ids, "zzz", -1)).toBe("a");
  });
  it("並びが空なら null", () => {
    expect(moveFocus([], "a", 1)).toBeNull();
  });
  it("非表示のものは並びに入っていないので飛ばされる", () => {
    // b は折りたたみ・絞り込みで表示順に含まれない
    expect(moveFocus(["a", "c"], "a", 1)).toBe("c");
  });
});

describe("カンバンの移動順（列をまたぐ・非表示列を飛ばす）", () => {
  const tasks = [
    { id: "t1", status: "todo" as const },
    { id: "d1", status: "done" as const },
    { id: "p1", status: "in_progress" as const },
    { id: "t2", status: "todo" as const },
    { id: "h1", status: "on_hold" as const },
  ];
  it("列ごとに上から、列の末尾で次の列へ進む", () => {
    const ordered = computeKanbanOrderedIds(tasks, false, false);
    expect(ordered).toEqual(["t1", "t2", "p1", "d1"]);
    expect(moveFocus(ordered, "t2", 1)).toBe("p1");
    expect(moveFocus(ordered, "p1", -1)).toBe("t2");
  });
  it("完了を隠している間は完了列を飛ばす・保留列は表示していなければ入らない", () => {
    const ordered = computeKanbanOrderedIds(tasks, true, false);
    expect(ordered).toEqual(["t1", "t2", "p1"]);
    expect(moveFocus(ordered, "p1", 1)).toBe("p1");
  });
  it("保留・中止列を表示しているときは列の最後に続く", () => {
    const ordered = computeKanbanOrderedIds(tasks, false, true);
    expect(moveFocus(ordered, "d1", 1)).toBe("h1");
  });
});
