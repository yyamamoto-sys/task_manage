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

export interface OkrItem {
  id: string;
  kind: OkrKind;
  parentId: string | null;
  /** 画面に出す番号（例：KR1、TF1-2） */
  label: string;
  text: string;
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

export interface TeamMemo {
  date: string;
  byKr: Record<string, string>;
}

export interface Seg {
  text: string;
  changed: boolean;
}
