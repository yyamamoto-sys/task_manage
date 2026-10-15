// src/components/tour/__tests__/announcementWiring.test.ts
//
// お知らせツアー（v3.159）の配線をソース走査で固定する（描画テスト基盤が無いため。CLAUDE.md Section 59：コメント行を除いてから走査する）。
// 検査の根拠は各 it の説明。わざと壊して赤くなることを確認済み（Section 83 に記録）。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { feedbackIntroTour } from "../tours/feedback-intro";

const SRC = join(__dirname, "..", "..", "..");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(l => !l.trim().startsWith("//"))
    .join("\n");
}
function read(rel: string): string {
  return stripComments(readFileSync(join(SRC, rel), "utf8"));
}
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "__tests__" || n === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("TourProvider：クリックで進むステップ", () => {
  const src = read("components/tour/TourProvider.tsx");
  it("対象要素の出現・消失を一定間隔で判定し（evaluateStepGate）、進む・戻る・終わるを実行する", () => {
    expect(src).toContain("evaluateStepGate(");
    expect(src).toMatch(/setInterval\(tick,/);
    expect(src).toMatch(/clearInterval\(/);
  });
  it("押してくださいの段（gated）では「次へ」「戻る」を出さず、キー操作（矢印・Enter）でも進まない", () => {
    expect(src).toContain("isGatedStep(step)");
    expect(src).toMatch(/stepIdx > 0 && !gated/);
    expect(src).toMatch(/\{!gated && \(/);
    expect(src).toMatch(/if \(gated\) return;/);
  });
  it("暗幕にはクリックを通す穴が開いている（4枚に分けた暗幕＝対象の部分は覆わない）", () => {
    expect(src).toMatch(/<DimBox style=\{\{ top: 0,/);
    expect(src).toMatch(/left: cutout\.left \+ cutout\.width/);
  });
  it("ステップ表示時のフォーカスを奪わない指定（keepFocus）と、枠線を手前へ上げる指定（raiseSpotlight）を読む", () => {
    expect(src).toContain("step.keepFocus");
    expect(src).toContain("step.raiseSpotlight ? TOUR_Z.bubble : TOUR_Z.spotlight");
  });
});

describe("feedback-intro が指す要素は実際の画面に data-tour-id がある", () => {
  const allSrc = walk(SRC).filter(f => !f.includes(join("components", "tour", "tours"))).map(f => stripComments(readFileSync(f, "utf8"))).join("\n");
  const ids = new Set<string>();
  for (const s of feedbackIntroTour.steps) {
    if (s.target) ids.add(s.target);
    if (s.advanceOn) ids.add(s.advanceOn.appears);
    if (s.whileVisible) ids.add(s.whileVisible.id);
  }
  for (const id of ids) {
    it(`data-tour-id="${id}"`, () => {
      expect(allSrc).toContain(`data-tour-id="${id}"`);
    });
  }
  it("ベルのパネル・ご意見のモーダルの場所は仕様どおり（パネル内の入口ボタン・モーダルの本体と入力欄）", () => {
    const bell = read("components/notifications/InAppNotificationBell.tsx");
    expect(bell).toMatch(/data-tour-id="notification-panel"/);
    expect(bell).toMatch(/data-tour-id="bell-feedback-entry" onClick=\{\(\) => \{ setOpen\(false\); onOpenFeedback\(\);/);
    const modal = read("components/feedback/FeedbackModal.tsx");
    expect(modal).toMatch(/data-tour-id="feedback-modal"/);
    expect(modal).toMatch(/data-tour-id="feedback-textarea"/);
  });
});

describe("MainLayout：公開範囲・自動開始・再生口", () => {
  const src = read("components/layout/MainLayout.tsx");
  it("tours は super_admin かどうかで作る（見えない人は start() が通らない）", () => {
    expect(src).toMatch(/buildTours\(\{ isGuest: isGuestMember\(props\.currentUser\), isSuperAdmin: tourIsSuperAdmin \}\)/);
  });
  it("自動開始は pickAutoStartAnnouncement（登録表の判定）を通す。モーダル・入力中・未保存編集・全画面表示は避ける", () => {
    expect(src).toContain("pickAutoStartAnnouncement({");
    expect(src).toMatch(/isModalOpen\(\) \|\| isInputFocused\(\)/);
    expect(src).toMatch(/hasUnsavedEditors\(\)/);
    expect(src).toMatch(/firstTimeDone: c\.tour\.isCompleted\(FIRST_TIME_TOUR_ID\) && !c\.showTourInvite/);
  });
  it("「自動表示をもう一度試す」は super_admin にだけ渡す", () => {
    expect(src).toMatch(/onResetAutoStart=\{isSuperAdmin \? resetAnnouncementAutoStart : undefined\}/);
  });
  it("ディープリンク open=tour はツアーを重ねるだけ（画面遷移ではないので guardedNavigate を通さない）", () => {
    const m = src.match(/target === "tour" && tourId !== null\) \{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("tour.start(tourId)");
    expect(m![0]).not.toContain("guardedNavigate");
  });
  it("お知らせの詳細には、この人に見えるツアーだけをボタンにするための tourTitleOf を渡す", () => {
    expect(src).toContain("tourTitleOf={tour.tourTitleOf}");
  });
});

describe("お知らせの詳細・ベル・送信画面", () => {
  it("詳細は本文から記法を取り除いて表示し、tourTitleOf が null のツアーはボタンにしない", () => {
    const src = read("components/notifications/AdminMessageDialog.tsx");
    expect(src).toContain("stripTourLinks(msg.body)");
    expect(src).toMatch(/if \(title === null\) return \[\];/);
  });
  it("ベルの行は記法を取り除いて表示する（旧画面ではただの文字）", () => {
    expect(read("components/notifications/InAppNotificationBell.tsx")).toContain("stripTourLinks(n.body)");
  });
  it("送信画面の「ツアーを添付」は、その人に見えるお知らせツアーだけを選べる", () => {
    const src = read("components/admin/AdminMessageSection.tsx");
    expect(src).toMatch(/announcementTourList\(\{ isGuest: false, isSuperAdmin \}\)/);
    expect(src).toContain("attachTourLink(body, tourId || null)");
  });
  it("ガイドの「自動表示をもう一度試す」は onResetAutoStart が渡されたときだけ出す", () => {
    const src = read("components/guide/GuideModeView.tsx");
    expect(src).toMatch(/onResetAutoStart && extraTours\?\.some\(/);
  });
});
