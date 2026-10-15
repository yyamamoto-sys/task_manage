// src/components/tour/tours/__tests__/announcements.test.ts
//
// お知らせツアー（v3.159）の登録表・公開範囲・自動開始の判定・クリックで進む流れの検証。
// 🔴 一般アカウント（super_admin でない人）には、自動開始・ガイドの一覧・「ツアーで見る」ボタン・ディープリンクのどれも出ないことを固定する。

import { describe, it, expect } from "vitest";
import {
  ANNOUNCEMENT_TOURS, canSeeAnnouncement, pickAutoStartAnnouncement, visibleAnnouncementEntries,
  type AnnouncementTour, type AutoStartContext,
} from "../announcements";
import { ALL_TOURS, announcementTourList, buildTours } from "..";
import { feedbackIntroTour, FEEDBACK_INTRO_TOUR_ID } from "../feedback-intro";
import { isValidTourId } from "../tourLinks";
import { evaluateStepGate } from "../../tourStepGate";

const ENTRY = ANNOUNCEMENT_TOURS.find(e => e.tourId === FEEDBACK_INTRO_TOUR_ID)!;
const admin = { isGuest: false, isSuperAdmin: true };
const general = { isGuest: false, isSuperAdmin: false };
const guest = { isGuest: true, isSuperAdmin: false };

const baseCtx = (over: Partial<AutoStartContext> = {}): AutoStartContext => ({
  viewer: admin, memberId: "m1", firstTimeDone: true, isCompleted: () => false, tourRunning: false, blocked: false, ...over,
});

describe("登録表の整合", () => {
  it("全エントリの tourId は ALL_TOURS に登録済み・id の形が正しく・tourId が重複しない・公開版が数字", () => {
    const ids = ANNOUNCEMENT_TOURS.map(e => e.tourId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ANNOUNCEMENT_TOURS) {
      expect(ALL_TOURS[e.tourId]).toBeDefined();
      expect(isValidTourId(e.tourId)).toBe(true);
      expect(e.sinceVersion).toMatch(/^\d+\.\d+$/);
      expect(["super_admin", "all"]).toContain(e.audience);
    }
  });

  it("feedback-intro は v3.159・まず管理者だけに公開する（audience: super_admin）", () => {
    expect(ENTRY.sinceVersion).toBe("3.159");
    expect(ENTRY.audience).toBe("super_admin");
    expect(ENTRY.autoStart).toBe(true);
  });
});

describe("公開範囲（audience）", () => {
  it("super_admin 向けは管理者にだけ見える。ゲストには audience に関わらず見えない", () => {
    expect(canSeeAnnouncement(ENTRY, admin)).toBe(true);
    expect(canSeeAnnouncement(ENTRY, general)).toBe(false);
    expect(canSeeAnnouncement(ENTRY, guest)).toBe(false);
    const all: AnnouncementTour = { ...ENTRY, audience: "all" };
    expect(canSeeAnnouncement(all, general)).toBe(true);
    expect(canSeeAnnouncement(all, guest)).toBe(false);
  });

  it("一般アカウントのガイド一覧（announcementTourList）は空・管理者には feedback-intro が並ぶ", () => {
    expect(announcementTourList(general)).toEqual([]);
    expect(announcementTourList(guest)).toEqual([]);
    const list = announcementTourList(admin);
    expect(list.map(x => x.tour.id)).toContain(FEEDBACK_INTRO_TOUR_ID);
    expect(list.find(x => x.tour.id === FEEDBACK_INTRO_TOUR_ID)?.audience).toBe("super_admin");
  });

  it("一般アカウントの tours には登録されない＝ボタン・ディープリンクから start() しても再生できない／管理者には登録される", () => {
    expect(buildTours({ isGuest: false, isSuperAdmin: false })[FEEDBACK_INTRO_TOUR_ID]).toBeUndefined();
    expect(buildTours({ isGuest: false })[FEEDBACK_INTRO_TOUR_ID]).toBeUndefined();
    expect(buildTours({ isGuest: true, isSuperAdmin: true })[FEEDBACK_INTRO_TOUR_ID]).toBeUndefined();
    expect(buildTours({ isGuest: false, isSuperAdmin: true })[FEEDBACK_INTRO_TOUR_ID]).toBeDefined();
    // 一般アカウントでも既存の2本は変わらず使える
    expect(Object.keys(buildTours({ isGuest: false, isSuperAdmin: false })).sort()).toEqual(
      Object.keys(ALL_TOURS).filter(id => id !== FEEDBACK_INTRO_TOUR_ID).sort(),
    );
  });

  it("全員へ広げる＝audience を all にすると一般アカウントにも見える（1行の変更で済む）", () => {
    const widened: AnnouncementTour[] = [{ ...ENTRY, audience: "all" }];
    expect(visibleAnnouncementEntries(general, widened)).toHaveLength(1);
    expect(pickAutoStartAnnouncement(baseCtx({ viewer: general }), widened)).toBe(FEEDBACK_INTRO_TOUR_ID);
  });
});

describe("自動開始の判定（pickAutoStartAnnouncement）", () => {
  it("すべての条件を満たすと、未読のお知らせツアーが1本選ばれる", () => {
    expect(pickAutoStartAnnouncement(baseCtx())).toBe(FEEDBACK_INTRO_TOUR_ID);
  });

  it("一般アカウント・ゲストには自動開始しない（試作の公開範囲）", () => {
    expect(pickAutoStartAnnouncement(baseCtx({ viewer: general }))).toBeNull();
    expect(pickAutoStartAnnouncement(baseCtx({ viewer: guest }))).toBeNull();
  });

  it("メンバーIDが未確定（ログイン前）・初回ツアー未了・他のツアー中・モーダル等がある間は始めない", () => {
    expect(pickAutoStartAnnouncement(baseCtx({ memberId: null }))).toBeNull();
    expect(pickAutoStartAnnouncement(baseCtx({ firstTimeDone: false }))).toBeNull();
    expect(pickAutoStartAnnouncement(baseCtx({ tourRunning: true }))).toBeNull();
    expect(pickAutoStartAnnouncement(baseCtx({ blocked: true }))).toBeNull();
  });

  it("既読（「あとで」を含む）なら始めない＝自動では何度も出ない", () => {
    expect(pickAutoStartAnnouncement(baseCtx({ isCompleted: id => id === FEEDBACK_INTRO_TOUR_ID }))).toBeNull();
  });

  it("autoStart: false のお知らせは自動では始めない（ボタン・一覧からは再生できる）", () => {
    expect(pickAutoStartAnnouncement(baseCtx(), [{ ...ENTRY, autoStart: false }])).toBeNull();
  });
});

describe("feedback-intro の流れ（クリックで進む・閉じたときの扱い）", () => {
  const steps = feedbackIntroTour.steps;
  const [intro, bell, entry, write] = steps;
  const present = (...ids: string[]) => (id: string) => ids.includes(id);

  it("4ステップ・ステップ数がガイドライン（7〜9以内）に収まる", () => {
    expect(steps.map(s => s.id)).toEqual(["intro", "bell", "entry", "write"]);
    expect(steps.length).toBeLessThanOrEqual(9);
  });

  it("1段目は中央表示・「あとで」で閉じられる。2〜3段目は押したら進む（次へを出さない種別）", () => {
    expect(intro.target).toBeUndefined();
    expect(intro.skipLabel).toBe("あとで");
    expect(bell.advanceOn).toEqual({ appears: "notification-panel" });
    expect(entry.advanceOn).toEqual({ appears: "feedback-modal" });
    expect(write.advanceOn).toBeUndefined();
    for (const s of steps) if (s.target) expect(s.skipIfMissing).toBe(true);
  });

  it("ベルを押す段：パネルが開くまで待ち、開いたら進む", () => {
    expect(evaluateStepGate(bell, present("notification-bell"))).toBe("stay");
    expect(evaluateStepGate(bell, present("notification-bell", "notification-panel"))).toBe("advance");
  });

  it("ご意見を送るを押す段：モーダルが開いたら進む（同時にパネルが閉じても進む側が勝つ）", () => {
    expect(evaluateStepGate(entry, present("notification-panel", "bell-feedback-entry"))).toBe("stay");
    expect(evaluateStepGate(entry, present("feedback-modal"))).toBe("advance");
    expect(evaluateStepGate(entry, present("notification-panel", "feedback-modal"))).toBe("advance");
  });

  it("パネルを途中で閉じたら1つ前（ベルを押す段）へ戻る", () => {
    expect(evaluateStepGate(entry, present("notification-bell"))).toBe("back");
  });

  it("最後の段：モーダルが開いている間は表示・閉じたら（送らなくても）終了", () => {
    expect(evaluateStepGate(write, present("feedback-modal", "feedback-textarea"))).toBe("stay");
    expect(evaluateStepGate(write, present())).toBe("end");
  });
});
