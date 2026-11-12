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
  /** 完了した時点でつながっていたKR。後のTF構成の変化で図から落ちないように記録として持つ */
  doneKrIds?: string[];
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
  /** 期首値。進み＝（現状−期首）÷（目標値−期首） */
  start: number;
  /** 増やす／減らす */
  direction: "up" | "down";
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
  /** どの資料から取り出したか（同じ回の資料ごとに足し合わせるため） */
  resourceId?: string;
}

/** AIが資料から読み取った下書き（1KR分） */
export interface Draft {
  krId: string;
  value: number | Band;
  source: Source;
}

/** 資料の中の「成果の記述」と、AIが推定した関連の仕事 */
export interface OutcomeLink {
  taskId: string;
  /** 推定の理由（一言） */
  reason: string;
}

/** 資料1件の中の成果の記述。同じ出来事を別の資料が書いていたら key を同じにする（足し合わせで1つにまとめる） */
export interface ResourceNote {
  key: string;
  krId: string;
  /** 増減の表記（例：＋1社、C→B） */
  change: string;
  excerpt: string;
  source: Source;
  links: OutcomeLink[];
}

/** 確定して足し合わせたあとの成果の記述 */
export interface OutcomeNote {
  key: string;
  krId: string;
  change: string;
  excerpt: string;
  sources: Source[];
  links: OutcomeLink[];
}

/** 結びつきへの本人の答え。pending＝まだ答えていない */
export type ClaimStatus = "pending" | "yes" | "no";

export interface Resource {
  id: string;
  name: string;
  kind: string;
  checkinId: string;
  drafts: Draft[];
  notes: ResourceNote[];
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

export type Effect = "よく効いた" | "少し" | "今週は届かず";
export type Match = "そのとおり" | "少し違う" | "違う";

export interface KrAnswer {
  effect?: Effect;
  match?: Match;
}

export interface PastWeek {
  weekStart: string;
  answers: Record<string, { effect: Effect; match: Match; view: string }>;
}

/** Kintone（正）から読んだTFの1行 */
export interface KintoneRow {
  id: string;
  label: string;
  text: string;
  parentId: string;
}

export interface ConflictOption {
  value: number | Band;
  source: Source;
  /** すでに確定済みの値か */
  existing: boolean;
}

/** 同じKRについて、資料どうし（または確定済みの値）で値が違うもの */
export interface Conflict {
  krId: string;
  options: ConflictOption[];
}
