// src/components/consultation/AIReplyBubble.tsx
//
// 【設計意図】
// AI返答の本文を表示する部品。AIは「タスク名(task_001)」の形で参照を書くが（内部では保持）、
// 画面には識別記号を出さない（v3.209・lib/ai/displayText.ts）。名前の部分は、タスクに解決できれば
// クリックでそのタスクを開くリンクとして描画する（data-ref-id に識別記号を残す）。
// 提案カード（ProposalCard）・会話履歴（ChatHistory）・最新のやりとり（ConsultationPanel）で
// 同じ見た目・同じ変換を使うためここに集める。

import { splitAliasRefs } from "../../lib/ai/displayText";
import { useAliasNameResolver } from "../../hooks/useAliasNameResolver";

/**
 * text の識別記号を取り除いて描画する。タスクに解決できた参照は、onOpenTask があればクリックでタスクを開く。
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
  const resolve = useAliasNameResolver(shortIdMap);
  const segs = splitAliasRefs(text, resolve);
  return (
    <>
      {segs.map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.text}</span>;
        const uuid = seg.alias.startsWith("task_") ? shortIdMap.get(seg.alias) : undefined;
        if (uuid && seg.resolved && onOpenTask) {
          return (
            <button
              key={i}
              data-ref-id={seg.alias}
              onClick={() => onOpenTask(uuid)}
              title="クリックしてタスクを開く"
              style={{
                background: "transparent",
                border: "none",
                borderBottom: "1px dotted var(--color-text-purple)",
                padding: 0,
                color: "var(--color-text-purple)",
                fontSize: "inherit",
                fontFamily: "inherit",
                cursor: "pointer",
                lineHeight: "inherit",
                textAlign: "inherit",
                verticalAlign: "baseline",
              }}
            >
              {seg.text}
            </button>
          );
        }
        return <span key={i} data-ref-id={seg.alias}>{seg.text}</span>;
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
