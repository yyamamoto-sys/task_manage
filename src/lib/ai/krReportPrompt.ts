// src/lib/ai/krReportPrompt.ts
//
// 【設計意図】
// KRレポート生成用のシステムプロンプトとコンテキストデータ構築。
// CSS/HTMLテンプレートを固定することで毎回一貫したデザインのレポートを出力する。
// OKR/KR/TFデータのAI送信はユーザー確認済みのポリシー変更による許可。

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
      const tdTasks = tasks.filter(t => t.todo_ids.includes(td.id) && !t.is_deleted);
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

  return { today, kr_title: kr.title, task_forces, mode, meeting_notes: meetingNotes };
}

// ===== クライアント側でHTMLラップするためのCSS =====
// AIにはbody内コンテンツのみ出力させ、クライアント側でこのCSSと合成する。
// → システムプロンプトにCSS (~3500トークン) を含めるコストを削減。

export const REPORT_HTML_WRAPPER = (bodyContent: string, title: string): string => `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Noto+Serif+JP:wght@400;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #fff; color: #1a1a1a; font-family: 'Noto Sans JP', sans-serif; font-weight: 300; font-size: 14px; line-height: 1.8; }
.doc-header { background: #fff; border-bottom: 2px solid #1a1a1a; padding: 40px 64px 32px; }
.doc-header .meta { font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.15em; color: #888; margin-bottom: 10px; }
.doc-header h1 { font-family: 'Noto Serif JP', serif; font-size: 24px; font-weight: 600; letter-spacing: 0.04em; color: #1a1a1a; margin-bottom: 6px; }
.doc-header .subtitle { font-size: 13px; color: #666; }
.tab-bar { display: flex; border-bottom: 1px solid #e0e0e0; padding: 0 64px; background: #fff; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.tab-btn { padding: 16px 32px; cursor: pointer; font-family: 'Noto Sans JP', sans-serif; font-size: 13px; font-weight: 500; letter-spacing: 0.06em; border: none; background: transparent; color: #aaa; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.2s; }
.tab-btn.kr1.active { color: #b07d2e; border-bottom-color: #b07d2e; }
.tab-btn.kr2.active { color: #2e7d6e; border-bottom-color: #2e7d6e; }
.tab-btn.kr3.active { color: #2e4d8e; border-bottom-color: #2e4d8e; }
.tab-btn:hover { color: #1a1a1a; }
.tab-content { display: none; }
.tab-content.active { display: block; }
.page { padding: 48px 64px 80px; max-width: 960px; }
.kr-banner { display: flex; align-items: flex-start; gap: 16px; padding: 20px 24px; border-radius: 8px; margin-bottom: 32px; border-left: 4px solid; }
.kr-banner.kr1 { background: #fdf6ea; border-color: #b07d2e; }
.kr-banner.kr2 { background: #eaf4f1; border-color: #2e7d6e; }
.kr-banner.kr3 { background: #eaeff8; border-color: #2e4d8e; }
.kr-banner-left { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; align-items: flex-start; }
.kr-badge { font-family: 'DM Mono', monospace; font-size: 11px; font-weight: 500; letter-spacing: 0.18em; padding: 5px 12px; border-radius: 3px; white-space: nowrap; }
.kr1 .kr-badge { background: #b07d2e; color: #fff; }
.kr2 .kr-badge { background: #2e7d6e; color: #fff; }
.kr3 .kr-badge { background: #2e4d8e; color: #fff; }
.kr-banner .kr-text { font-size: 13px; color: #555; line-height: 1.7; flex: 1; padding-top: 4px; }
.signal-pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; font-family: 'DM Mono', monospace; font-size: 10px; font-weight: 600; white-space: nowrap; letter-spacing: 0.05em; }
.signal-pill.green  { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
.signal-pill.yellow { background: #fef9c3; color: #a16207; border: 1px solid #fde047; }
.signal-pill.red    { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
.summary-box { background: #f8f4ff; border: 1px solid #e9d8fd; border-left: 4px solid #7c3aed; border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; }
.summary-box .summary-title { font-family: 'DM Mono', monospace; font-size: 10px; font-weight: 600; color: #7c3aed; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 10px; }
.summary-box ul { margin: 0; padding-left: 18px; }
.summary-box li { font-size: 13px; color: #374151; line-height: 1.75; margin-bottom: 3px; }
.mustdo-box { background: #fff7ed; border: 1px solid #fed7aa; border-left: 4px solid #f97316; border-radius: 6px; padding: 16px 20px; margin-bottom: 24px; }
.mustdo-box .mustdo-title { font-family: 'DM Mono', monospace; font-size: 10px; font-weight: 700; color: #ea580c; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 12px; }
.mustdo-item { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; font-size: 13px; color: #1a1a1a; line-height: 1.6; }
.mustdo-item::before { content: "→"; color: #f97316; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
.mustdo-item:last-child { margin-bottom: 0; }
.part-heading { display: flex; align-items: center; gap: 14px; margin: 40px 0 20px; }
.part-num { font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.15em; color: #fff; background: #1a1a1a; padding: 4px 10px; border-radius: 3px; }
.part-heading h2 { font-family: 'Noto Serif JP', serif; font-size: 17px; font-weight: 600; color: #1a1a1a; }
.part-rule { flex: 1; height: 1px; background: #e8e8e8; }
.analysis-block { margin-bottom: 28px; }
.analysis-label { display: inline-flex; align-items: center; gap: 8px; font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 12px; }
.analysis-label .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.label-hypo .dot { background: #d4614a; } .label-hypo { color: #d4614a; }
.label-exec .dot { background: #3a7bd5; } .label-exec { color: #3a7bd5; }
.label-ext  .dot { background: #7d5eab; } .label-ext  { color: #7d5eab; }
.analysis-card { background: #fafafa; border: 1px solid #ebebeb; border-radius: 6px; padding: 18px 22px; margin-bottom: 10px; }
.analysis-card.priority { background: #fff9f8; border-color: #f5c6be; border-left: 3px solid #d4614a; }
.analysis-card .card-tf { font-family: 'DM Mono', monospace; font-size: 10px; color: #aaa; letter-spacing: 0.1em; margin-bottom: 6px; }
.analysis-card .card-title { font-size: 13.5px; font-weight: 500; color: #1a1a1a; margin-bottom: 8px; line-height: 1.6; }
.analysis-card .card-body { font-size: 13px; color: #555; line-height: 1.85; }
.section-divider { border: none; border-top: 1px solid #e0e0e0; margin: 0; }
.next-block { margin-bottom: 28px; }
.next-label { display: inline-flex; align-items: center; gap: 8px; font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 12px; }
.next-label .bar { width: 14px; height: 3px; border-radius: 2px; flex-shrink: 0; }
.label-n-hypo .bar { background: #d4614a; } .label-n-hypo { color: #d4614a; }
.label-n-exec .bar { background: #3a7bd5; } .label-n-exec { color: #3a7bd5; }
.label-n-str  .bar { background: #e8a020; } .label-n-str  { color: #e8a020; }
.label-n-obj  .bar { background: #7d5eab; } .label-n-obj  { color: #7d5eab; }
.time-tag { display: inline-block; font-family: 'DM Mono', monospace; font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 3px; margin-bottom: 8px; letter-spacing: 0.06em; }
.time-tag.urgent { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
.time-tag.soon   { background: #fef9c3; color: #a16207; border: 1px solid #fde047; }
.time-tag.later  { background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db; }
.next-card { border: 1px solid #e8e8e8; border-radius: 6px; padding: 20px 24px; margin-bottom: 10px; background: #fff; }
.next-card.priority { border-color: #bcd4f7; border-left: 3px solid #3a7bd5; background: #f8faff; }
.next-card .card-tf { font-family: 'DM Mono', monospace; font-size: 10px; color: #aaa; letter-spacing: 0.1em; margin-bottom: 6px; }
.next-card .card-title { font-size: 13.5px; font-weight: 500; color: #1a1a1a; margin-bottom: 12px; line-height: 1.6; }
.change-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.change-from { font-size: 12px; color: #999; background: #f3f3f3; border: 1px solid #ddd; border-radius: 3px; padding: 4px 10px; text-decoration: line-through; text-decoration-color: #ccc; }
.change-arrow-icon { font-size: 14px; color: #ccc; }
.change-to { font-size: 12px; color: #2e7a55; background: #edf7f2; border: 1px solid #b8dfc9; border-radius: 3px; padding: 4px 10px; font-weight: 500; }
.next-card .card-body { font-size: 13px; color: #555; line-height: 1.85; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.doc-footer { border-top: 1px solid #e0e0e0; padding: 20px 64px; display: flex; justify-content: space-between; font-family: 'DM Mono', monospace; font-size: 10px; color: #bbb; letter-spacing: 0.1em; }
@media print { .tab-bar { display: none; } .tab-content { display: block !important; } .page { padding: 32px 40px 60px; } }
@media (max-width: 720px) { .doc-header { padding: 28px 24px 20px; } .tab-bar { padding: 0 24px; } .tab-btn { padding: 14px 16px; font-size: 12px; } .page { padding: 32px 24px 60px; } .two-col { grid-template-columns: 1fr; } }
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;

// ===== HTMLドキュメント構造の説明（AIへの指示） =====
// AIには<body>内コンテンツのみを出力させる。CSSはクライアント側でラップする。

const HTML_STRUCTURE_GUIDE = `
【出力形式】
<body>タグ内に入れるHTMLコンテンツのみを出力してください。
<!DOCTYPE html>、<html>、<head>、<body>タグは不要です。
CSSも不要です（クライアント側で適用します）。

【使用可能なCSSクラス一覧】
- .doc-header / .meta / .subtitle
- .tab-bar / .tab-btn.kr1|kr2|kr3 / .tab-content（複数KR時のみ）
- .page
- .kr-banner.kr1|kr2|kr3 / .kr-banner-left / .kr-badge / .kr-text
- .signal-pill.green|yellow|red
- .summary-box / .summary-title
- .mustdo-box / .mustdo-title / .mustdo-item
- .part-heading / .part-num / .part-rule
- .analysis-block / .analysis-label.label-hypo|label-exec|label-ext / .dot
- .analysis-card（.priority追加で強調） / .card-tf / .card-title / .card-body
- .section-divider
- .next-block / .next-label.label-n-hypo|label-n-exec|label-n-str|label-n-obj / .bar
- .time-tag.urgent|soon|later
- .next-card（.priority追加で強調） / .change-row / .change-from / .change-arrow-icon / .change-to
- .two-col / .doc-footer

【必須のHTML構造パターン】

1. ヘッダー（.doc-header）
<div class="doc-header">
  <div class="meta">WEEKLY CHECK-IN REPORT｜YYYY.MM.DD</div>
  <h1>KR 進捗分析と次の一手</h1>
  <div class="subtitle">うまくいっていない理由の分析 ＋ 次の一手の提案</div>
</div>

2. KRが複数ある場合はタブバー（.tab-bar）を使用。1つの場合はタブなし。

3. KRごとのコンテンツ（.page内）

3-1. KRバナー（シグナルを必ず含める）
<div class="kr-banner kr1">
  <div class="kr-banner-left">
    <span class="kr-badge">KR1</span>
    <span class="signal-pill red">🔴 要対応</span>
  </div>
  <div class="kr-text">KRのタイトルと概要。全体進捗XX%</div>
</div>

3-2. ① 分析セクション（summary-box → analysis-block×3）

3-3. ② 次の一手セクション（mustdo-box → next-block×4）

4. フッター
<div class="doc-footer">
  <span>KR Check-in Report｜YYYY.MM.DD</span>
  <span>Generated by Claude</span>
</div>

5. タブ切り替えスクリプト（複数KRの場合のみ）
<script>
function switchTab(kr) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.tab-btn.' + kr).classList.add('active');
  document.getElementById('tab-' + kr).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

【クオリティ要件】
- signal-pill: 議事メモ・タスク状況から判断して必ず選ぶ（green/yellow/red）
- summary-box: 分析カードを全部読まなくても「今週最大の課題」が1秒でわかる内容に
- mustdo-box: 「今週中に誰かが動かないといけないこと」TOP2〜3に絞る
- time-tag: urgent=今週中, soon=来週〜再来週, later=来月以降
- priority クラス: 各セクションで最重要な1〜2枚にだけつける
- change-from/change-to: 具体的に。「〇〇する → △△する」の形式
- card-body: 理由・背景・具体的な行動まで含める（箇条書き可）
- KRデータ（TF/ToDo/Task）を具体的に参照する（「TF2の△△タスクが期日超過」等）
`;

// ===== システムプロンプト =====

const CHECKIN_ROLE = `あなたはOKR推進チームの分析AIです。
KRのチェックイン会議の記録（文字起こし・議事メモ）と、アプリDBから取得したKRの構造データ（TF・ToDo・Task）を受け取り、
グループメンバーに共有するHTMLレポートを生成します。

【分析の観点】
① うまくいっていない理由の分析（仮説の問題 / 実行の問題 / 外部環境の問題）
② 次の一手の提案（仮説変更 / 打ち手変更 / 強度変更 / 対象変更）

【重要】
- KRデータは現在アプリDBに登録されている実際のTF・ToDo・Taskです。タスクの遅延・未着手・担当者情報などを積極的に分析に活用してください
- 分析は具体的に。「担当分散」等の抽象表現より「TF2のタスク○○が期日超過・担当者は未定」など具体名を入れる
- 提案は今週動けるレベルに落とす。「検討する」ではなく「今週火曜の会議でGOを得る」まで具体化`;

const WIN_ROLE = `あなたはOKR推進チームの分析AIです。
KRのウィンセッション（金曜振り返り会議）の記録（文字起こし・議事メモ）と、アプリDBから取得したKRの構造データ（TF・ToDo・Task）を受け取り、
グループメンバーに共有するHTMLレポートを生成します。

【分析の観点】
① うまくいっていない理由の分析（仮説の問題 / 実行の問題 / 外部環境の問題）
② 次の一手の提案（仮説変更 / 打ち手変更 / 強度変更 / 対象変更）

【ウィンセッション固有の観点】
- 今週の宣言達成状況（達成・部分達成・未達成）
- 仮説検証から得た学び（何が分かったか）
- 外部環境変化が計画に与える影響
- 来週以降の軌道修正ポイント`;

export const KR_REPORT_SYSTEM_PROMPTS: Record<KrReportMode, string> = {
  checkin: `${CHECKIN_ROLE}

${HTML_STRUCTURE_GUIDE}`,

  win_session: `${WIN_ROLE}

${HTML_STRUCTURE_GUIDE}`,
};
