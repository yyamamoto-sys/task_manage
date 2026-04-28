// src/lib/ai/krReportPrompt.ts
//
// 【設計意図】
// KRレポート生成用のシステムプロンプトとコンテキストデータ構築。
// 既存のpayloadBuilder/systemPromptとは独立した機能（OKR/KR/TFをAIに渡すことが許可されている）。

import type { KeyResult, TaskForce, ToDo, Task, Member } from "../localData/types";

// ===== コンテキスト型 =====

export interface KrReportTodo {
  title: string;
  due_date: string | null;
  tasks: {
    name: string;
    status: string;
    assignee: string;
    due_date: string | null;
  }[];
}

export interface KrReportTf {
  tf_number: string;
  name: string;
  description?: string;
  todos: KrReportTodo[];
}

export interface KrReportContext {
  today: string;
  kr_title: string;
  task_forces: KrReportTf[];
  mode: "checkin" | "win_session";
  meeting_notes: string;
}

export type KrReportMode = "checkin" | "win_session";

// ===== コンテキスト構築 =====

export function buildKrReportContext(params: {
  today: string;
  kr: KeyResult;
  tfs: TaskForce[];
  todos: ToDo[];
  tasks: Task[];
  members: Member[];
  mode: KrReportMode;
  meetingNotes: string;
}): KrReportContext {
  const { today, kr, tfs, todos, tasks, members, mode, meetingNotes } = params;

  const krTfs = tfs.filter(tf => tf.kr_id === kr.id && !tf.is_deleted);

  const task_forces: KrReportTf[] = krTfs.map(tf => {
    const tfTodos = todos.filter(td => td.tf_id === tf.id && !td.is_deleted);
    const todosWithTasks: KrReportTodo[] = tfTodos.map(td => {
      const tdTasks = tasks.filter(
        t => t.todo_ids.includes(td.id) && !t.is_deleted,
      );
      return {
        title: td.title,
        due_date: td.due_date ?? null,
        tasks: tdTasks.map(t => {
          const assignee = members.find(m => m.id === t.assignee_member_id);
          return {
            name: t.name,
            status: t.status,
            assignee: assignee?.short_name ?? "未設定",
            due_date: t.due_date ?? null,
          };
        }),
      };
    });
    return {
      tf_number: tf.tf_number,
      name: tf.name,
      description: tf.description,
      todos: todosWithTasks,
    };
  });

  return {
    today,
    kr_title: kr.title,
    task_forces,
    mode,
    meeting_notes: meetingNotes,
  };
}

// ===== システムプロンプト =====

const COMMON_OUTPUT_RULES = `
出力形式：
- 必ずHTMLで出力すること（<html>タグ不要。<div>から始める）
- スタイルはインラインCSSで完結させること（外部CSS不要）
- 日本語で出力すること
- 読みやすく、視覚的に整理されたレポートにすること

評価シグナル（進捗状況のバッジ）の使い方：
- 🟢（青・順調）: 目標の60%以上達成見込み
- 🟡（黄・注意）: 目標の50〜59%達成見込み
- 🔴（赤・要対応）: 目標の49%以下

必ずHTML全体を1つのdivで包み、その中に見やすいレポートを記述すること。
`;

export const KR_REPORT_SYSTEM_PROMPTS: Record<KrReportMode, string> = {
  checkin: `あなたはOKR推進を支援するAIアナリストです。
KRのチェックイン会議の議事録・文字起こしと、現在のKR構造（タスクフォース・ToDo・タスク）を受け取り、
以下の形式でHTMLレポートを生成してください。

レポートに含める内容：
① Q末ゴールへの到達可能性
  - 3段階評価（🟢順調 / 🟡注意 / 🔴要対応）と理由コメント
  - 現時点での進捗状況の総評

② 今週の宣言内容の整理
  - 誰が・何を・いつまでに（宣言した行動レベルの内容を整理）
  - 宣言の実現可能性と懸念点

③ うまくいっていない部分の分析（該当する場合）
  - 原因（リソース・スキル・外部要因・計画のズレ 等）
  - 改善の方向性

④ 来週に向けた仮説たたき案
  - 検証すべき仮説を具体的に（行動レベル・期日入り）

${COMMON_OUTPUT_RULES}`,

  win_session: `あなたはOKR推進を支援するAIアナリストです。
KRのウィンセッション会議の議事録・文字起こしと、現在のKR構造（タスクフォース・ToDo・タスク）を受け取り、
以下の形式でHTMLレポートを生成してください。

レポートに含める内容：
① 先週の宣言の達成状況
  - 誰が・何を宣言し・結果どうだったか
  - 達成 / 部分達成 / 未達成の分類

② 仮説検証の結果
  - 何を検証しようとしたか
  - 結果として何が分かったか（学び・気づき）

③ 外部環境変化の確認
  - 市場・チーム・体制等の変化で計画に影響があるものはあるか

④ Q末ゴールへの到達可能性（更新）
  - 今週の結果を踏まえた評価（🟢🟡🔴）と更新コメント

⑤ 次の一手（4観点）
  - やること（Action）
  - やめること（Stop）
  - 変えること（Change）
  - 続けること（Continue）

${COMMON_OUTPUT_RULES}`,
};
