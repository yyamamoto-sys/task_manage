export type TaskStatus = "未着手" | "進行中" | "完了";

export interface Member {
  id: string;
  name: string;
  isManager: boolean;
  teamId: string;
  color: string;
}

export interface Team {
  id: string;
  name: string;
  /** チェックインの曜日（0=日 … 6=土） */
  checkinWeekday: number;
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
  /** TFだけ：リーダー（週1回の自己申告をする人） */
  leaderId?: string;
}

export type ReportLevel = "順調" | "注意" | "相談したい";

/** TFリーダーの週1回の自己申告 */
export interface SelfReport {
  level: ReportLevel;
  note: string;
  /** 申告日 YYYY-MM-DD */
  date: string;
}

/** 月初のチェックポイント（Kintoneの「月次の計画（プロセス評価基準）」に当たる） */
export interface Checkpoint {
  tfId: string;
  /** YYYY-MM */
  month: string;
  text: string;
}

export type SynergyType = "same-subject" | "handoff" | "duplicate" | "crunch";

export interface Synergy {
  id: string;
  type: SynergyType;
  krIds: string[];
  taskIds: string[];
  summary: string;
  /** (c) のようにAIの提案（モックでは固定）か */
  fixed?: boolean;
}

export type SynergyStatus = "picked" | "skipped";

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
  /** 相手・対象の名前（顧客名・成果物名など）。KRをまたぐ「同じ相手・対象」の検出に使う */
  subject?: string;
  /** このタスクの前提になっているタスクのID */
  dependsOn?: string[];
}

export interface TeamMemo {
  date: string;
  byKr: Record<string, string>;
}

export interface Seg {
  text: string;
  changed: boolean;
}
