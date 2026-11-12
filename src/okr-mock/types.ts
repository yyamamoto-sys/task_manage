export type TaskStatus = "未着手" | "進行中" | "完了";

export interface Member {
  id: string;
  name: string;
  /** 画面上の立場（メンバー／GM）。誰として見るかの切替に使う */
  role: "メンバー" | "GM";
  color: string;
}

export type OkrKind = "objective" | "kr" | "tf";

/** 半期の中の四半期。Objective・KRは半期の間ずっと固定、TFは四半期ごとに構成が変わる */
export type Quarter = "3Q" | "4Q";

export interface OkrItem {
  id: string;
  kind: OkrKind;
  parentId: string | null;
  /** 画面に出す番号（例：KR1、TF1-2） */
  label: string;
  text: string;
  /** TFだけ：この取り組みがある四半期。Objective・KRは半期を通して有効なので持たない */
  quarters?: Quarter[];
  /** TFだけ：リーダー */
  leaderId?: string;
}

export interface Pj {
  id: string;
  name: string;
  tfIds: string[];
}

export interface Task {
  id: string;
  pjId: string;
  title: string;
  assigneeId: string;
  /** YYYY-MM-DD */
  due: string;
  status: TaskStatus;
  /** 最終更新日 YYYY-MM-DD（完了のときは完了日） */
  updated: string;
}

export interface Seg {
  text: string;
  changed: boolean;
}

/** 達成度バンド。仮の5段階（実際の区分に差し替える。定義は logic.ts の BANDS） */
export type Band = "S" | "A" | "B" | "C" | "D";

export interface Source {
  doc: string;
  page: string;
}

interface RecordBase {
  krId: string;
  /** 最終更新日（その値を取り込んだチェックインの日） YYYY-MM-DD */
  updatedAt: string;
  /** 前回の更新日 */
  prevAt: string;
  source: Source | null;
}

export interface NumberRecord extends RecordBase {
  kind: "number";
  unit: string;
  target: number;
  value: number;
  prev: number;
}

export interface BandRecord extends RecordBase {
  kind: "band";
  target: Band;
  value: Band;
  prev: Band;
}

export type KrRecord = NumberRecord | BandRecord;

export interface Checkin {
  id: string;
  date: string;
  title: string;
}

/** 決定事項と宿題 */
export interface Decision {
  id: string;
  checkinId: string;
  kind: "決定" | "宿題";
  text: string;
  ownerId: string | null;
  source: Source;
  /** 関わるKR（KR詳細パネルに出す） */
  krIds: string[];
}

/** AIが資料から読み取った下書き（1KR分） */
export interface Draft {
  krId: string;
  value: number | Band;
  source: Source;
}

export interface Resource {
  id: string;
  name: string;
  kind: string;
  checkinId: string;
  drafts: Draft[];
  decisions: Omit<Decision, "id" | "checkinId">[];
}

export interface PersonalOkr {
  id: string;
  ownerId: string;
  text: string;
}

export interface AiCandidate {
  krId: string;
  reason: string;
}

export type Effect = "よく効いた" | "少し" | "効かせられなかった";
export type Match = "そのとおり" | "少し違う" | "違う";

export interface KrAnswer {
  effect?: Effect;
  match?: Match;
}

export interface PastWeek {
  weekStart: string;
  answers: Record<string, { effect: Effect; match: Match; view: string }>;
}
