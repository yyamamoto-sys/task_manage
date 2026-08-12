// src/lib/demo/personalOkrDataset.ts
//
// 【設計意図】
// ゲスト（サンプル閲覧）モード用の個人OKR（OKRモード「自分」タブ）の架空データ本体。
// dataset.ts（PJ・タスク・グループOKR）と同じ流儀：実在の顧客名・PJ名・人名は使わない、
// id は "demo-" 接頭辞、group_id は DEMO_GROUP_ID、member_id は GUEST_MEMBER_ID。
//
// 【動的importでのみ読み込む】このファイルは src/stores/personalOkrUiStore.ts のゲスト分岐
// （loadKrs）からのみ import("./personalOkrDataset") で読み込む。他のファイルから静的import
// しないこと（Section 19：ダウンロード量の最小化。通常利用者はこのファイルを一切
// ダウンロードしない。__tests__/personalOkrDataset.test.ts が静的importの禁止を機械検査する）。
//
// 【日付は相対計算】fiscal_year・quarter は「今日」から実際に計算する（currentQuarter()）。
// 固定の四半期を書くと時間が経つと「全部過去（read-only）」または「全部未来（未着手）」の
// 不自然なデータになる。週の目標状態も、今日から見た「現在の週」を基準に、それより前は
// 評価済み・それ以降は未評価にする（AheadBlockの機械計算―残り週数・評価待ちの週―が
// 意味を持つ程度のデータ量にする。CLAUDE.md Section 24参照）。
//
// 【dataset.ts（PJ・タスク）との連携】週とタスクの紐づけ（weekTasksByWeek）は、
// dataset.ts が用意した実在のタスクid（"demo-task-3"＝ベースライン遅延あり、
// "demo-task-4"＝先行タスク未完了で先行待ち）を参照する。この2つのidが実際に
// dataset.ts の buildDemoDataset().tasks に存在することは
// __tests__/personalOkrDataset.test.ts が機械的に検証する（dataset.ts側のid変更に
// 気づけるようにするため）。

import { currentQuarter, toDateStr } from "../date";
import { computeMonthWeekSegments } from "../date/monthWeeks";
import { quarterMonthSlots, monthToDateStr, classifyMonth } from "../personalOkr/quarterMonths";
import { GUEST_MEMBER_ID } from "../guestMode";
import { DEMO_GROUP_ID } from "./constants";
import type {
  PersonalKr, PersonalKrMonth, PersonalKrWeek, PersonalKrMemo, PersonalKrWeekTask, WeekSelfRating,
} from "../localData/types";

export interface DemoPersonalOkrData {
  krs: PersonalKr[];
  monthsByKr: Record<string, PersonalKrMonth[]>;
  weeksByKr: Record<string, PersonalKrWeek[]>;
  memosByKr: Record<string, PersonalKrMemo[]>;
  weekTasksByWeek: Record<string, PersonalKrWeekTask[]>;
}

/** dataset.ts（グループOKR側サンプル）の実在タスクid。冒頭コメント参照。 */
const LINKED_TASK_DELAYED = "demo-task-3"; // 新システム設計（当初計画より遅延）
const LINKED_TASK_BLOCKED = "demo-task-4"; // 開発・実装（先行タスク未完了で先行待ち）

const KR_IDS = { system: "demo-pkr-1", expo: "demo-pkr-2", manual: "demo-pkr-3" } as const;

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function buildKrs(fiscalYear: number, quarter: PersonalKr["quarter"]): PersonalKr[] {
  const base = {
    member_id: GUEST_MEMBER_ID, group_id: DEMO_GROUP_ID, fiscal_year: fiscalYear, quarter,
    is_deleted: false, created_at: isoDaysAgo(70), updated_at: isoDaysAgo(3), updated_by: GUEST_MEMBER_ID,
  };
  return [
    {
      ...base,
      id: KR_IDS.system,
      kr_kind: "group_kr",
      key_result_id: "demo-kr-1",
      task_force_id: "demo-tf-1",
      label: "KR1",
      weight_pct: 40,
      category: "基幹システム更新",
      activity: "新システムの設計フェーズを推進し、入力エラー率の削減につながる仕様を固める",
      strength_role: "設計レビューのリード役",
      weakness_role: "ベンダーとの折衝",
      criteria: "設計レビューが完了し、エラー率の削減効果が数値で説明できる状態",
      supplement: "これはゲスト向けサンプルです。実際の業務内容ではありません。",
      display_order: 1,
    },
    {
      ...base,
      id: KR_IDS.expo,
      kr_kind: "general",
      label: "KR2",
      weight_pct: 35,
      category: "展示会運営",
      activity: "秋季展示会の出展準備を計画的に進め、当日の運営品質を高める",
      strength_role: "ブース運営の進行管理",
      weakness_role: "配布資料のデザイン確認",
      criteria: "会期前に準備タスクが完了し、当日の運営マニュアルが整っている状態",
      supplement: "",
      display_order: 2,
    },
    {
      ...base,
      id: KR_IDS.manual,
      kr_kind: "company_common",
      label: "KR3",
      weight_pct: 25,
      category: "業務マニュアル整備",
      activity: "自部署のマニュアルを整備し、他部署からの問い合わせ対応時間を減らす",
      strength_role: "テンプレート作成",
      weakness_role: "他部署への周知",
      criteria: "自部署のマニュアルカバー率が80%に達している状態",
      supplement: "",
      display_order: 3,
    },
  ];
}

/** 月次計画（当月・存在すれば前月分も）。過去月は確定済みの体裁、当月は編集中の体裁にする。 */
function buildMonthsForKr(
  krId: string,
  slots: { monthIndex: 1 | 2 | 3; monthStart: Date }[],
  today: Date,
  content: { positioning: string; activities: string; targetAndEvidence: string; risks: string },
): PersonalKrMonth[] {
  const months: PersonalKrMonth[] = [];
  for (const slot of slots) {
    const status = classifyMonth(slot.monthStart, today);
    if (status === "future") continue; // Phase 1方針：未来月は手入力させない（計画未実施のまま）
    const monthStr = monthToDateStr(slot.monthStart);
    const isPast = status === "past";
    months.push({
      id: `demo-pkr-month-${krId}-${slot.monthIndex}`,
      personal_kr_id: krId,
      month: monthStr,
      month_index: slot.monthIndex,
      positioning: content.positioning,
      activities: content.activities,
      target_and_evidence: content.targetAndEvidence,
      risks: content.risks,
      band_target: isPast ? 70 : 80,
      band_override: null,
      band_override_by: null,
      band_override_at: null,
      review_text: isPast ? "計画どおり概ね前進した（サンプルの振り返りです）" : null,
      self_eval_pct: isPast ? 72 : null,
      is_deleted: false,
      created_at: isoDaysAgo(isPast ? 45 : 12),
      updated_at: isoDaysAgo(isPast ? 40 : 1),
      updated_by: GUEST_MEMBER_ID,
    });
  }
  return months;
}

/** 週の目標状態。現在の週より前は評価済み（◯△✕を混在させる）、現在以降は未評価にする。 */
function buildWeeksForKr(
  krId: string,
  monthStart: Date,
  status: "past" | "current",
  today: Date,
  goalTexts: string[],
): PersonalKrWeek[] {
  const monthStr = monthToDateStr(monthStart);
  const segments = computeMonthWeekSegments(monthStart);
  const currentWeekIndex = status === "current"
    ? segments.find(s => today >= s.weekStart && today <= new Date(s.weekEnd.getFullYear(), s.weekEnd.getMonth(), s.weekEnd.getDate(), 23, 59, 59))?.weekIndex ?? null
    : null;
  const ratingCycle: WeekSelfRating[] = ["o", "o", "t", "x", "o", "o"];

  const weeks: PersonalKrWeek[] = [];
  for (const seg of segments) {
    const isBeforeCurrent = status === "past" || (currentWeekIndex != null && seg.weekIndex < currentWeekIndex);
    const isCurrentWeek = currentWeekIndex != null && seg.weekIndex === currentWeekIndex;
    if (!isBeforeCurrent && !isCurrentWeek) continue; // 現在より先の週は空のまま（未着手を表現）
    const goalState = goalTexts[(seg.weekIndex - 1) % goalTexts.length];
    weeks.push({
      id: `demo-pkr-week-${krId}-${monthStr}-${seg.weekIndex}`,
      personal_kr_id: krId,
      month: monthStr,
      week_index: seg.weekIndex,
      week_start: toDateStr(seg.weekStart),
      week_end: toDateStr(seg.weekEnd),
      goal_state: goalState,
      self_rating: isBeforeCurrent ? ratingCycle[(seg.weekIndex - 1) % ratingCycle.length] : null,
      rated_at: isBeforeCurrent ? isoDaysAgo(7) : null,
      note: null,
      is_deleted: false,
      created_at: isoDaysAgo(isBeforeCurrent ? 20 : 3),
      updated_at: isoDaysAgo(isBeforeCurrent ? 15 : 1),
      updated_by: GUEST_MEMBER_ID,
    });
  }
  return weeks;
}

function buildMemosForKr(krId: string, bodies: string[]): PersonalKrMemo[] {
  return bodies.map((body, i) => ({
    id: `demo-pkr-memo-${krId}-${i + 1}`,
    personal_kr_id: krId,
    member_id: GUEST_MEMBER_ID,
    body,
    is_deleted: false,
    created_at: isoDaysAgo(2 + i * 5),
    updated_at: isoDaysAgo(2 + i * 5),
    updated_by: GUEST_MEMBER_ID,
  }));
}

export function buildDemoPersonalOkrDataset(): DemoPersonalOkrData {
  const today = new Date();
  const fiscalYear = today.getFullYear();
  const quarter = currentQuarter();
  const slots = quarterMonthSlots(fiscalYear, quarter);
  const currentSlot = slots.find(s => classifyMonth(s.monthStart, today) === "current") ?? slots[0];

  const krs = buildKrs(fiscalYear, quarter);

  const monthsByKr: Record<string, PersonalKrMonth[]> = {
    [KR_IDS.system]: buildMonthsForKr(KR_IDS.system, slots, today, {
      positioning: "設計フェーズの中心として、要件と実装のギャップを埋める",
      activities: "設計レビューの実施、ベンダーとの仕様調整、テスト計画の下書き",
      targetAndEvidence: "設計レビュー議事録が確定し、残課題リストが5件以下になっている",
      risks: "ベンダー側の回答が遅れると後工程（開発）に影響する",
    }),
    [KR_IDS.expo]: buildMonthsForKr(KR_IDS.expo, slots, today, {
      positioning: "ブース運営の実務面を支える",
      activities: "配布資料の最終確認、当日シフトの調整、デモ機材の動作確認",
      targetAndEvidence: "当日の運営マニュアルが完成し、シフト表に穴が無い状態",
      risks: "配布資料の印刷が展示会直前に集中しやすい",
    }),
    [KR_IDS.manual]: buildMonthsForKr(KR_IDS.manual, slots, today, {
      positioning: "自部署マニュアルのテンプレート統一を主導する",
      activities: "既存手順の聞き取り、テンプレートへの落とし込み、レビュー依頼",
      targetAndEvidence: "自部署の主要業務3件がテンプレート化され、レビューを通過している",
      risks: "他部署の協力が得られないとカバー率が伸びない",
    }),
  };

  const weeksByKr: Record<string, PersonalKrWeek[]> = {
    [KR_IDS.system]: [
      ...slots.filter(s => classifyMonth(s.monthStart, today) === "past").flatMap(s =>
        buildWeeksForKr(KR_IDS.system, s.monthStart, "past", today, ["要件の再確認", "設計方針の合意"])),
      ...buildWeeksForKr(KR_IDS.system, currentSlot.monthStart, "current", today,
        ["設計レビュー準備", "ベンダー折衝", "残課題の解消", "テスト計画の下書き", "レビュー確定", "振り返り"]),
    ],
    [KR_IDS.expo]: [
      ...slots.filter(s => classifyMonth(s.monthStart, today) === "past").flatMap(s =>
        buildWeeksForKr(KR_IDS.expo, s.monthStart, "past", today, ["レイアウト決定", "配布資料の初稿確認"])),
      ...buildWeeksForKr(KR_IDS.expo, currentSlot.monthStart, "current", today,
        ["資料の最終確認", "シフト調整", "デモ機材確認", "当日リハーサル", "最終チェック", "振り返り"]),
    ],
    [KR_IDS.manual]: [
      ...slots.filter(s => classifyMonth(s.monthStart, today) === "past").flatMap(s =>
        buildWeeksForKr(KR_IDS.manual, s.monthStart, "past", today, ["聞き取り開始", "テンプレート初版"])),
      ...buildWeeksForKr(KR_IDS.manual, currentSlot.monthStart, "current", today,
        ["聞き取りの継続", "テンプレート反映", "レビュー依頼", "修正対応", "公開準備", "振り返り"]),
    ],
  };

  const memosByKr: Record<string, PersonalKrMemo[]> = {
    [KR_IDS.system]: buildMemosForKr(KR_IDS.system, [
      "ベンダーからの回答が来週にずれ込みそう。設計レビューの日程を再確認する。",
      "テスト計画は開発フェーズの人員が決まってから詳細化する方が良さそう。",
    ]),
    [KR_IDS.expo]: buildMemosForKr(KR_IDS.expo, [
      "配布資料の印刷は最低1週間前倒しで手配する（前回の反省点）。",
    ]),
    [KR_IDS.manual]: buildMemosForKr(KR_IDS.manual, [
      "テンプレートは項目数を絞った方が他部署も書きやすい。",
    ]),
  };

  // ★週とタスクの紐づけ（自動候補ではなく明示リンク。ここでは初期状態として付与）。
  // 当月の最初の週（＝現週または最古の当月週）に、遅延タスクと先行待ちタスクを1件ずつ紐づけ、
  // AheadBlockの機械計算（遅延・先行待ち）が空にならないようにする。
  const currentSystemWeeks = weeksByKr[KR_IDS.system].filter(w => w.month === monthToDateStr(currentSlot.monthStart));
  const weekTasksByWeek: Record<string, PersonalKrWeekTask[]> = {};
  if (currentSystemWeeks.length > 0) {
    const targetWeekId = currentSystemWeeks[0].id;
    weekTasksByWeek[targetWeekId] = [
      { week_id: targetWeekId, task_id: LINKED_TASK_DELAYED },
      { week_id: targetWeekId, task_id: LINKED_TASK_BLOCKED },
    ];
  }

  return { krs, monthsByKr, weeksByKr, memosByKr, weekTasksByWeek };
}
