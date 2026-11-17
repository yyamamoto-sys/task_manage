// OKRモード（地図）の「記録」の入口。
// 本番の既存の表（O・KR・TF・PJ・タスク・メンバー）で足りないもの＝新しい表が要るものは、すべてここを通す。
// 段階1（今回）はメモリ上の空実装だけ。段階2で Supabase の実装に差し替える（docs/dev/sections/s91_okr-map-stage1.md）。
// 画面はこの空の状態（まだ記録がない）でも崩れないこと。
import type { History } from "./reach";
import type { AiCandidate, AssessEntry, Checkin, Decision, KintoneRow, KrBands, KrDef, KrRecord, Learning, PastWeek, PersonalOkr, Resource } from "./types";

export interface OkrMapLock {
  /** 今期のTF構成を Kintone の内容で確定済みか */
  locked: boolean;
  /** 確定した日（YYYY-MM-DD）。未確定は null */
  lockedAt: string | null;
}

/** 新しい表から読むもの。キーはすべて本番のID（KRのID・タスクのID・メンバーのID） */
export interface OkrMapRecords {
  /** KRごとの段の基準文（60/70/80…）と「Oに近づいた証拠として見るもの」 */
  krDefs: Record<string, KrDef>;
  /** KRごとの手がかりの数字と最終更新 */
  records: Record<string, KrRecord>;
  /** 手がかりの数字の回ごとの値 */
  history: History;
  /** 回ごとのAIの見立て（資料ごと） */
  assess: Record<string, AssessEntry[]>;
  learnings: Learning[];
  checkins: Checkin[];
  decisions: Decision[];
  /** 読ませた資料のAIの読み取り結果（段階3で作る） */
  resources: Resource[];
  /** Kintone の PDF から読んだ今期のTF。読み取りの仕組みが無いあいだは null */
  kintoneRows: KintoneRow[] | null;
  lock: OkrMapLock;
  /** 人ごとの過去の週の振り返り（本人だけ） */
  pastWeeks: Record<string, PastWeek[]>;
  /** 人ごとの、仕事のつなぎ先の選び直し（利用者ID → 仕事ID → KRの集合） */
  overrides: Record<string, Record<string, string[]>>;
  /** 人ごとの、個人OKR → KR の矢印 */
  personalLinks: Record<string, { personalId: string; krId: string }[]>;
  /** 人ごとの、今週やると選んだ仕事（今週の分） */
  picks: Record<string, string[]>;
  personalOkrs: PersonalOkr[];
  /** PJごとの、AIが出すつなぎ先の候補 */
  aiCandidates: Record<string, AiCandidate[]>;
  /** KRごとの「どう役立つか」の一言の候補 */
  howOptions: Record<string, string[]>;
}

export interface OkrMapRepository {
  /** groupId の部署・krIds のKRについての記録を読む */
  load(args: { groupId: string | null; krIds: string[] }): Promise<OkrMapRecords>;
}

/** 段の基準文がまだ無いKRに使う形。60 は必ずあるので 60・70・80 の3段を空文で持つ */
export const EMPTY_BANDS: KrBands = { 60: "", 70: "", 80: "" };

/** 記録が1件もない状態。KRごとの欄は空の形をそろえておく（画面が KR ID で引いたときに undefined にならないように） */
export function emptyRecords(krIds: string[]): OkrMapRecords {
  return {
    krDefs: Object.fromEntries(krIds.map((k) => [k, { bands: { ...EMPTY_BANDS }, evidence: "" }])),
    records: Object.fromEntries(krIds.map((k) => [k, { krId: k, updatedAt: "", prevAt: "", source: null }])),
    history: {},
    assess: {},
    learnings: [],
    checkins: [],
    decisions: [],
    resources: [],
    kintoneRows: null,
    lock: { locked: false, lockedAt: null },
    pastWeeks: {},
    overrides: {},
    personalLinks: {},
    picks: {},
    personalOkrs: [],
    aiCandidates: {},
    howOptions: {},
  };
}

/** 読んだ記録に、まだ記録のないKRの空の欄を足す（期中にKRが増えても画面が undefined を引かないように） */
export function fillRecords(rec: OkrMapRecords, krIds: string[]): OkrMapRecords {
  const empty = emptyRecords(krIds.filter((k) => !rec.krDefs[k] || !rec.records[k]));
  return { ...rec, krDefs: { ...empty.krDefs, ...rec.krDefs }, records: { ...empty.records, ...rec.records } };
}

/** 段階1の実装：何も保存しない・いつも空を返す。ゲストでも同じ（Supabase に触れない） */
export const memoryRepository: OkrMapRepository = {
  load: async ({ krIds }) => emptyRecords(krIds),
};
