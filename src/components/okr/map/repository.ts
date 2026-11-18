// OKRモード（地図）の「記録」の入口。
// 本番の既存の表（O・KR・TF・PJ・タスク・メンバー）で足りないもの＝新しい表が要るものは、すべてここを通す。
// 段階2で Supabase の実装（supabaseRepository.ts）を足した。ゲストとテストはメモリ実装（memoryRepository）のまま。
// 画面はこの空の状態（まだ記録がない）でも崩れないこと。docs/dev/sections/s91_okr-map-stage1.md
import type { History } from "./reach";
import type {
  AiCandidate,
  AssessEntry,
  Checkin,
  Decision,
  Hint,
  KintoneRow,
  KrBands,
  KrDef,
  KrRecord,
  Learning,
  OkrItem,
  OutcomeNote,
  PastWeek,
  PersonalOkr,
  Quarter,
  Resource,
} from "./types";
import type { UserState } from "./userState";

export interface OkrMapLock {
  /** 今期のTF構成を Kintone の内容で確定済みか */
  locked: boolean;
  /** 確定した日（YYYY-MM-DD）。未確定は null */
  lockedAt: string | null;
}

/** 人ごとの記録のうち、overrides・personalLinks・picks 以外（本人の分だけが入る） */
export type UserRecord = Partial<Pick<UserState, "how" | "proposals" | "answers" | "claims">>;

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
  /** 資料を読ませたが、まだ何も確定していない回（「資料を読ませる」で選べる） */
  openCheckins?: Checkin[];
  /** 回ごとに、最後に確定した人 */
  confirmedBy?: Record<string, string>;
  decisions: Decision[];
  /** 読ませた資料のAIの読み取り結果（okr_resources） */
  resources: Resource[];
  /** Kintone の PDF から読んだ今期のTF。読み取りの仕組みが無いあいだは null */
  kintoneRows: KintoneRow[] | null;
  lock: OkrMapLock;
  /** 人ごとの過去の週の振り返り（本人だけ） */
  pastWeeks: Record<string, PastWeek[]>;
  /** 人ごとの、仕事のつなぎ先の選び直し（利用者ID → 仕事ID → KRの集合）。本番は仕事1件1行で、選び直した人の分に入れる */
  overrides: Record<string, Record<string, string[]>>;
  /** 人ごとの、個人OKR → KR の矢印 */
  personalLinks: Record<string, { personalId: string; krId: string }[]>;
  /** 人ごとの、今週やると選んだ仕事（今週の分） */
  picks: Record<string, string[]>;
  /** 人ごとの、どう役立つか・提案の採否・週の振り返りの答え・結びつきへの答え */
  userRecords?: Record<string, UserRecord>;
  /** 確定した成果の記述（足し合わせ済み） */
  outcomeNotes?: OutcomeNote[];
  personalOkrs: PersonalOkr[];
  /** PJごとの、AIが出すつなぎ先の候補（段階3で都度作る。保存しない） */
  aiCandidates: Record<string, AiCandidate[]>;
  /** KRごとの「どう役立つか」の一言の候補（段階3で都度作る。保存しない） */
  howOptions: Record<string, string[]>;
}

export interface OkrMapLoadArgs {
  groupId: string | null;
  krIds: string[];
  /** 本人（ログイン中の人）。本人の分の記録と、今期の個人OKRを読む */
  viewerId: string;
  /** 今期（暦年と四半期）。個人OKR・TF構成の確定を読む */
  year: number;
  quarter: Quarter;
  /** 今週の月曜 */
  weekStart: string;
  /** 表示部署の仕事の ID（つなぎ先はこの分だけ読む）。無ければつなぎ先は読まない */
  taskIds?: string[];
}

/** 手がかりの数字の定め（値は資料の確定で入る） */
export type HintDef = Pick<Hint, "unit" | "start" | "target" | "direction">;

/** 資料の確定で保存するもの（state.tsx の confirmImport が組み立てる） */
export interface ConfirmSave {
  groupId: string | null;
  viewerId: string;
  checkin: Checkin;
  /** 確定した資料（その回のこの資料の分を入れ替える） */
  resourceIds: string[];
  /** 確定した資料の見立て（KRごと） */
  assessments: { krId: string; entry: AssessEntry }[];
  /** その回に確定した手がかりの値（KR → 値） */
  hintValues: Record<string, { value: number; source: { doc: string; page: string } | null }>;
  learnings: Learning[];
  decisions: Decision[];
  /** 足し合わせたあとの成果の記述（今回の確定で触れたものだけ） */
  notes: OutcomeNote[];
  /** 担当者へ届ける結びつき（まだ答えのないものだけ pending で作る） */
  claims: { noteKey: string; taskId: string; memberId: string }[];
}

export interface OkrMapRepository {
  /** groupId の部署・krIds のKRについての記録を読む。値を返すだけで、保存に使う行IDの対応は変えない */
  load(args: OkrMapLoadArgs): Promise<OkrMapRecords>;
  /** load が返した記録を採用する（呼び出し側が世代番号を確かめてから呼ぶ。保存に使う行IDの対応を差し替える） */
  adopt?(rec: OkrMapRecords): void;
  /**
   * 本人の状態の変化を保存する（before → after の差分だけ書く）。
   * overrides は全員分を足し合わせたもの（つなぎ先は仕事1件1行なので、他の担当者の分を外した変化も拾う）
   */
  saveUser(viewerId: string, before: UserState, after: UserState): Promise<void>;
  saveConfirm(c: ConfirmSave): Promise<void>;
  /** 資料1件の読み取り結果を保存する（回がまだ無ければ未確定の回として作る） */
  saveResource(a: { groupId: string | null; viewerId: string; checkin: Checkin; resource: Resource }): Promise<void>;
  /** 今期のTF構成の確定 */
  saveLock(l: { groupId: string | null; viewerId: string; year: number; quarter: Quarter; lockedOn: string; snapshot: OkrItem[] }): Promise<void>;
  /**
   * KRの段の基準文・証拠・手がかりの定め（手入力と Kintone の取り込み）。
   * 他の人が先に直した・同時に初めて作ったときは KrDefConflictError（最新の内容つき）を投げる
   */
  saveKrDef(krId: string, def: KrDef, hint: HintDef | null, viewerId: string): Promise<void>;
}

/** KRの定めの保存の競合。読み直した最新の内容を持つ（画面はそれに差し替えて知らせる） */
export class KrDefConflictError extends Error {
  krId: string;
  def: KrDef;
  hint: HintDef | null;
  constructor(krId: string, def: KrDef, hint: HintDef | null) {
    super("ほかの人が先にこのKRの段の基準を保存していました。最新の内容を読み直したので、確かめてからもう一度保存してください。");
    this.name = "KrDefConflictError";
    this.krId = krId;
    this.def = def;
    this.hint = hint;
  }
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
    openCheckins: [],
    confirmedBy: {},
    decisions: [],
    resources: [],
    kintoneRows: null,
    lock: { locked: false, lockedAt: null },
    pastWeeks: {},
    overrides: {},
    personalLinks: {},
    picks: {},
    userRecords: {},
    outcomeNotes: [],
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

/** 段階1の実装：何も保存しない・いつも空を返す。ゲストとテストはこれ（Supabase に触れない） */
export const memoryRepository: OkrMapRepository = {
  load: async ({ krIds }) => emptyRecords(krIds),
  saveUser: async () => {},
  saveConfirm: async () => {},
  saveResource: async () => {},
  saveLock: async () => {},
  saveKrDef: async () => {},
};

/** 本人の状態の保存で、いくつかの表が書けなかった（失敗した表の名前と最初の原因） */
export class SaveUserError extends Error {
  failed: string[];
  cause: unknown;
  constructor(failed: string[], cause: unknown) {
    const why = cause && typeof cause === "object" && typeof (cause as { message?: unknown }).message === "string" ? `（${(cause as { message: string }).message}）` : "";
    super(`${failed.join("・")}を保存できませんでした${why}`);
    this.name = "SaveUserError";
    this.failed = failed;
    this.cause = cause;
  }
}

/** PostgreSQL の一意制約違反（23505） */
export function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "23505";
}
