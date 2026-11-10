// src/components/consultation/AIReplyBubble.tsx
//
// 【設計意図】
// AI返答の本文に含まれる「タスク名(task_001)」の参照をクリック可能にする表示部品と、
// v3.206 で追加した直接回答（reply）の吹き出し。提案カード（ProposalCard）・会話履歴（ChatHistory）・
// 最新のやりとり（ConsultationPanel）で同じ見た目・同じリンク化を使うためここに集める。

/**
 * text 内の (task_001) 形式のタスク参照を、クリックでタスクを開くボタンとして描画する。
 * shortIdMap で UUID に解決できた場合のみリンク化する。
 */
export function TaskRefText({
  text,
  shortIdMap,
  onOpenTask,
}: {
  text: string;
  shortIdMap: Map<string, string>;
  onOpenTask?: (taskId: string) => void;
}) {
  if (!onOpenTask) return <>{text}</>;

  // (task_001), (task001), (task9) などにマッチ
  const parts = text.split(/(\(task_?\d+\))/gi);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\((task_?\d+)\)$/i);
        const uuid = m ? shortIdMap.get(m[1]) : undefined;
        if (uuid) {
          return (
            <button
              key={i}
              onClick={() => onOpenTask(uuid)}
              title="クリックしてタスクを開く"
              style={{
                background: "var(--color-brand-light, rgba(124,58,237,0.08))",
                border: "1px solid var(--color-brand-border, rgba(124,58,237,0.25))",
                borderRadius: "4px",
                padding: "0 4px",
                color: "var(--color-text-purple)",
                fontSize: "inherit",
                fontFamily: "monospace",
                cursor: "pointer",
                lineHeight: "inherit",
                textDecoration: "none",
                verticalAlign: "baseline",
              }}
            >
              {part}
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** AIの直接回答（reply）の吹き出し。会話履歴のアシスタント文と同じ見た目 */
export function AIReplyBubble({
  text,
  shortIdMap,
  onOpenTask,
}: {
  text: string;
  shortIdMap: Map<string, string>;
  onOpenTask?: (taskId: string) => void;
}) {
  return (
    <div
      style={{
        fontSize: "12px",
        color: "var(--color-text-primary)",
        lineHeight: 1.6,
        padding: "8px 12px",
        background: "var(--color-bg-secondary)",
        borderRadius: "var(--radius-md)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      <TaskRefText text={text} shortIdMap={shortIdMap} onOpenTask={onOpenTask} />
    </div>
  );
}
