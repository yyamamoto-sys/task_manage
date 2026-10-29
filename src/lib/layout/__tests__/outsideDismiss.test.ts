import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isInsideAny, shouldDismissOnOutside } from "../outsideDismiss";

const box = (inner: unknown[]) => ({ contains: (n: unknown) => inner.includes(n) }) as { contains(n: Node): boolean };

describe("isInsideAny", () => {
  const a = {}, b = {}, out = {};
  it("どれかの内側なら true・null の要素は無視", () => {
    expect(isInsideAny(a as Node, [null, box([a])])).toBe(true);
    expect(isInsideAny(b as Node, [box([a]), box([b])])).toBe(true);
  });
  it("外側・target が null なら false", () => {
    expect(isInsideAny(out as Node, [box([a]), null])).toBe(false);
    expect(isInsideAny(null, [box([a])])).toBe(false);
  });
});

describe("shouldDismissOnOutside", () => {
  it("開いていて保留でなく外側のときだけ閉じる", () => {
    expect(shouldDismissOnOutside({ open: true, suspended: false, inside: false })).toBe(true);
    expect(shouldDismissOnOutside({ open: true, suspended: false, inside: true })).toBe(false);
    expect(shouldDismissOnOutside({ open: true, suspended: true, inside: false })).toBe(false);
    expect(shouldDismissOnOutside({ open: false, suspended: false, inside: false })).toBe(false);
  });
});

describe("配線（CLAUDE.md Section 59）", () => {
  const main = readFileSync("src/components/layout/MainLayout.tsx", "utf8");
  it("miscOpen・labOpen の両方に外側クリックの処理がありツアー実行中は保留する", () => {
    expect(main).toMatch(/useOutsideDismiss\(miscOpen, \[miscItemsRef, miscToggleRef\][^)]*\)[^;]*tourRunning\)/);
    expect(main).toMatch(/useOutsideDismiss\(labOpen, \[labMenuRef, labToggleRef\][^;]*tourRunning\)/);
  });
  it("miscOpen は保存しない", () => {
    expect(main).not.toMatch(/localStorage\.(get|set)Item\(KEYS\.SIDEBAR_MISC_OPEN/);
  });
});
