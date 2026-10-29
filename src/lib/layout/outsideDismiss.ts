// src/lib/layout/outsideDismiss.ts
//
// サイドバー下部の「⋯（その他）」「🧪（ラボ）」を、外側のクリックと Esc で閉じるための判定（v3.193）。
// 判定は純関数にしてテストする。フックは src/hooks/useOutsideDismiss.ts。

/** target が containers のどれかの内側か（null の要素は無視）。 */
export function isInsideAny(target: Node | null, containers: ReadonlyArray<{ contains(n: Node): boolean } | null>): boolean {
  if (!target) return false;
  return containers.some(c => !!c && c.contains(target));
}

/** 閉じてよいか。開いていて、ツアー中などの保留でなく、内側でないときだけ true。 */
export function shouldDismissOnOutside(opts: { open: boolean; suspended: boolean; inside: boolean }): boolean {
  return opts.open && !opts.suspended && !opts.inside;
}
