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
  /** 四半期ごとに確定する取り組み（OkrItem の tf）。必ず1つ以上。仕事とKRのつながりの元になる（PJとKRは直接つながない） */
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

export interface Source {
  doc: string;
  page: string;
}

/** 段の基準文。60が出発点（最低値）。90・100 は持たないKRがある */
export interface KrBands {
  60: string;
  70: string;
  80: string;
  90?: string;
  100?: string;
}

/** KRごとの定義（半期の間は固定）。段の基準文と、Oに近づいた証拠として見るもの */
export interface KrDef {
  bands: KrBands;
  evidence: string;
}

/** 手がかりの数字（数値で測れるKRだけが持つ）。主役ではなく、状態を観る手がかり */
export interface Hint {
  unit: string;
  /** 期首値 */
  start: number;
  direction: "up" | "down";
  target: number;
  value: number;
  prev: number;
}

export interface KrRecord {
  krId: string;
  /** 最終更新日（その回の資料に出た日） YYYY-MM-DD */
  updatedAt: string;
  /** 前回の更新日 */
  prevAt: string;
  source: Source | null;
  hint?: Hint;
}

export type BasisStatus = "確認できた" | "一部" | "まだ";

/** 次の段の要件1つ分。quote は根拠になった資料の記述（短い引用）。「まだ」のときは空 */
export interface BasisItem {
  requirement: string;
  status: BasisStatus;
  quote: string;
}

/** AIの見立て。資料の記述だけから決まる（タスクの完了率は使わない） */
export interface Assessment {
  /** 60〜最上段の整数 */
  value: number;
  /** 次の段の要件（2〜4個） */
  basis: BasisItem[];
  summary: string;
}

export interface ResourceAssessment {
  krId: string;
  assessment: Assessment;
  source: Source;
}

/** 回ごとの見立て。同じ回に複数の資料があれば資料ごとに持つ（resourceId）。seed は資料に紐づかない初期値 */
export interface AssessEntry {
  checkinId: string;
  date: string;
  resourceId: string;
  assessment: Assessment;
  source: Source | null;
}

export type LearningKind = "分かったこと" | "次に試すこと";

export interface LearningDraft {
  krId: string;
  kind: LearningKind;
  text: string;
  source: Source;
}

export interface Learning extends LearningDraft {
  id: string;
  checkinId: string;
  resourceId: string;
}

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

/** AIが資料から読み取った手がかりの数字の下書き（1KR分・数値のあるKRだけ） */
export interface Draft {
  krId: string;
  value: number;
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
  /** 増減の表記（例：＋1社、63→66の要因の一つ） */
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
  assessments: ResourceAssessment[];
  learnings: LearningDraft[];
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

export type Effect = "役立った" | "少し役立った" | "今週は役立たなかった";
export type Match = "そのとおり" | "少し違う" | "違う";

export interface KrAnswer {
  effect?: Effect;
  match?: Match;
}

export interface PastWeek {
  weekStart: string;
  answers: Record<string, { effect: Effect; match: Match; view: string }>;
}

/** Kintone（正式な内容）から読んだTFの1行 */
export interface KintoneRow {
  id: string;
  label: string;
  text: string;
  parentId: string;
}

export interface ConflictOption {
  value: number;
  source: Source;
  /** すでに確定済みの値か */
  existing: boolean;
}

/** 同じKRについて、資料どうし（または確定済みの値）で値が違うもの */
export interface Conflict {
  krId: string;
  options: ConflictOption[];
}
