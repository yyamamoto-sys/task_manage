// src/components/feedback/__tests__/feedbackWiring.test.ts
//
// v3.157：ご意見（アプリ内フィードバック）の配線をソース走査で固定する。描画テスト基盤が無いため、
// 「入口が2つある」「スナップショットは開いた瞬間に確定する」「ベル・モーダル自身のクリックは履歴から除く」
// 「ゲストには入口もクリック履歴も出ない」「材料に業務データの文字列を渡さない」「Claude 用コピーに送信者を渡さない」を守る。
// コメントは除去してから走査する（Section 59。コメントに書いた語で無力化されない）。
//
// 【わざと壊して赤くなることを確認した記録】
//  ・InAppNotificationBell.tsx から `data-feedback-ui=""` を1つ消す → 赤 → 戻して緑
//  ・MainLayout.tsx のリスナーで captureFeedbackSnapshot() を外す（モーダル側で撮る形にする）→ 赤 → 戻して緑
//  ・FeedbackSection.tsx の toCopyInput に member_id を足す → 赤 → 戻して緑
//  ・ListView.tsx の useSnapshotProvider の中に searchText をそのまま入れる → 赤 → 戻して緑

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../../");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map(l => {
    const i = l.indexOf("//");
    return i === -1 ? l : l.slice(0, i);
  }).join("\n");
}
const read = (rel: string) => stripComments(fs.readFileSync(path.join(SRC, rel), "utf8"));

function count(src: string, needle: string | RegExp): number {
  return typeof needle === "string" ? src.split(needle).length - 1 : (src.match(needle) ?? []).length;
}

/** useSnapshotProvider("id", () => ...) の呼び出し全体（括弧の対応で取り出す） */
function providerBlock(src: string, id: string): string {
  const start = src.indexOf(`useSnapshotProvider("${id}"`);
  expect(start, `provider ${id}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("unbalanced");
}

describe("入口は2つ：ベルのパネル上部と、設定「困ったとき」", () => {
  const bell = read("components/notifications/InAppNotificationBell.tsx");
  const help = read("components/settings/PersonalPages.tsx");

  it("ベル：パネルを閉じてから onOpenFeedback を呼ぶボタンがある。ベルのトリガーとパネルは data-feedback-ui（クリック履歴の対象外）", () => {
    expect(bell).toMatch(/onOpenFeedback\(\)/);
    expect(bell).toContain("layout.feedback.entryBell");
    expect(count(bell, 'data-feedback-ui=""')).toBeGreaterThanOrEqual(2);
  });

  it("MainLayout：ベルに requestOpenFeedback を渡す", () => {
    const layout = read("components/layout/MainLayout.tsx");
    expect(layout).toContain("onOpenFeedback={requestOpenFeedback}");
  });

  it("困ったとき：ゲストには出さず、押したら requestOpenFeedback。入口のボタンも data-feedback-ui", () => {
    expect(help).toContain("!isGuestMode() && item(t(\"layout.settings.help.feedback\")");
    expect(help).toMatch(/<button data-feedback-ui="" [^>]*onClick=\{requestOpenFeedback\}/);
  });
});

describe("スナップショットはモーダルを開いた瞬間に確定する", () => {
  const layout = read("components/layout/MainLayout.tsx");
  const modal = read("components/feedback/FeedbackModal.tsx");

  it("MainLayout：入口のイベントを受けたその場で captureFeedbackSnapshot() を呼び、確定済みの値をモーダルへ渡す。ゲストは受けない", () => {
    expect(layout).toMatch(/onOpenFeedbackRequest\(\(\) => setFeedbackCapture\(prev => prev \?\? captureFeedbackSnapshot\(\)\)\)/);
    expect(layout).toMatch(/if \(isGuest\) return;\s+return onOpenFeedbackRequest/);
    expect(layout).toContain("<FeedbackModal capture={feedbackCapture}");
    expect(layout).toContain("!isGuest && feedbackCapture !== null");
    expect(count(layout, "{feedbackModal}")).toBe(2);
  });

  it("モーダル：自分ではスナップショットを撮り直さない（送信時にも確定済みの capture を使う）", () => {
    expect(modal).not.toContain("captureFeedbackSnapshot");
    expect(modal).not.toContain("collectSnapshotContext");
    expect(modal).toContain("capture.snapshot");
    expect(modal).toContain("capture.finalized");
  });

  it("モーダル：data-feedback-ui・pointerEvents:auto（Portal・Section 51）・未保存編集レジストリ・Ctrl/Cmd+Enter 送信・IME 確定は無視", () => {
    expect(modal).toContain('data-feedback-ui=""');
    expect(modal).toMatch(/pointerEvents:\s*"auto"/);
    expect(modal).toContain("useUnsavedEditor(dirty)");
    expect(modal).toMatch(/\(e\.ctrlKey \|\| e\.metaKey\) && e\.key === "Enter" && !e\.nativeEvent\.isComposing/);
    expect(modal).toContain("createPortal(");
  });

  it("モーダル：状況をオフにしたら snapshot を送らず state は off。送るときのスナップショットは attached のときだけ", () => {
    expect(modal).toContain('snapshot: attach && capture.finalized.state === "attached" ? capture.snapshot : null');
    expect(modal).toContain('snapshotState: !attach ? "off" : capture.finalized.state');
  });

  it("モーダル：既定は状況を付ける（既定オン）・種類は任意（未選択のまま送れる）", () => {
    expect(modal).toContain("useState(true)");
    expect(modal).toContain('kind: kind ?? "unspecified"');
  });
});

describe("クリック履歴・材料はゲストでは動かさず、業務データの文字列を渡さない", () => {
  it("App.tsx：クリック履歴はゲストでは起動しない。アンマウントで止める", () => {
    const app = read("App.tsx");
    expect(app).toContain("isGuestMode() ? null : startClickHistory()");
    expect(app).toContain("stopClicks?.()");
  });

  it("ListView：材料は列挙値・真偽・IDだけ。検索語・タスク名をそのまま入れない（hasSearch は入力の有無）", () => {
    const block = providerBlock(read("components/list/ListView.tsx"), "list");
    expect(block).toContain('hasSearch: searchText.trim() !== ""');
    expect(block).not.toMatch(/searchText(?!\.trim)/);
    expect(block).toContain('member: filterMember === "all" ? "all" : "set"');
    expect(block).not.toMatch(/\.name\b|\.title\b|display_name|email/);
  });

  it("GanttView：AI提案のプレビュー用の描画は登録しない。KanbanView：真偽と ID だけ", () => {
    const gantt = providerBlock(read("components/gantt/GanttView.tsx"), "gantt");
    expect(gantt).toContain("isPreview ? null");
    expect(gantt).not.toMatch(/\.name\b|\.title\b|display_name|email/);
    const kanban = providerBlock(read("components/kanban/KanbanView.tsx"), "kanban");
    expect(kanban).toContain('hasSectionFilter: effectiveSectionFilter !== ""');
    expect(kanban).not.toMatch(/\.name\b|\.title\b|display_name|email/);
  });

  it("MainLayout の材料にも名前・メールを渡さない（部署ID・PJのIDだけ）", () => {
    const block = providerBlock(read("components/layout/MainLayout.tsx"), "layout");
    expect(block).toContain("department: { displayGroupId: currentGroupId }");
    expect(block).toContain("selection: { projectId: selectedProjectId }");
    expect(block).not.toMatch(/display_name|email|\.name\b/);
  });

  it("設定画面：開いている設定ページ（列挙値）を登録する", () => {
    expect(read("components/settings/SettingsView.tsx")).toContain('useSnapshotProvider("settings", () => ({ settingsPage: page }))');
  });
});

describe("管理ページ：送信者名はこの画面だけ。Claude 用コピーには載せない", () => {
  const section = read("components/admin/FeedbackSection.tsx");

  it("toCopyInput は member_id・admin_memo を渡さない", () => {
    const m = /function toCopyInput\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(section);
    expect(m).not.toBeNull();
    expect((m as RegExpExecArray)[1]).not.toMatch(/member_id|admin_memo|memberNameById|display_name/);
  });

  it("コピーは buildFeedbackCopyText 経由・クリップボードに書く前に他の整形をしない。選んだ件数の上限がある", () => {
    expect(section).toContain("buildFeedbackCopyText(");
    expect(section).toContain("slice(0, FEEDBACK_COPY_LIMIT)");
  });

  it("状態は即時保存（切替ボタン）・メモは SaveButton（手書きの保存ボタンを置かない）・未適用の案内を出す・super_admin 以外は中身を出さない", () => {
    expect(section).toContain("updateFeedbackStatus(row.id, next)");
    expect(section).toContain("<SaveButton ");
    expect(section).toContain("isFeedbackNotAppliedError(e)");
    expect(section).toContain("if (!isSuperAdmin)");
  });

  it("一覧の取得にスナップショットを含めない（重いので詳細・コピーのときだけ取る）", () => {
    const store = read("lib/supabase/feedbackStore.ts");
    const cols = /const LIST_COLUMNS = "([^"]*)"/.exec(store);
    expect(cols?.[1]).toBeTruthy();
    expect(cols?.[1]).not.toMatch(/\bsnapshot\b/);
  });
});

describe("通知・設定ページ・深いリンク", () => {
  it("設定ページ feedback は AdminView で描画し、MainLayout は /?open=admin-feedback で開く", () => {
    expect(read("components/admin/AdminView.tsx")).toContain('page === "feedback"');
    expect(read("components/layout/MainLayout.tsx")).toContain('target === "admin-feedback") openSettings("feedback")');
  });

  it("ゲストには送信させない（feedbackStore が先頭で拒否し、RPC を呼ばない）", () => {
    const store = read("lib/supabase/feedbackStore.ts");
    expect(store).toMatch(/export async function submitFeedback[\s\S]*?if \(isGuestMode\(\)\) throw/);
  });
});
