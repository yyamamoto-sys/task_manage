import { useRef, useState } from "react";
import { buildCopilotPrompt, type CopilotPromptKr } from "../copilotPrompt";

/**
 * 会議の文字起こしを Copilot にまとめさせてから読ませるための案内とプロンプト（v3.221）。
 * 文字起こしは長く、そのままだと「分けて読ませてください」になりやすいため、これを本命の導線にする。
 */
export function CopilotPromptHelp({ krs }: { krs: CopilotPromptKr[] }) {
  const prompt = buildCopilotPrompt(krs);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  if (prompt === "") return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("ok");
    } catch {
      areaRef.current?.focus();
      areaRef.current?.select();
      setCopied("manual");
    }
  };

  return (
    <details className="mk-card" style={{ margin: "8px 0" }}>
      <summary>会議の文字起こしは、Copilot にまとめさせてから読ませると確実です</summary>
      <ol className="mk-small">
        <li>Teams の会議の Copilot（または Microsoft 365 Copilot）に、下のプロンプトを貼る。</li>
        <li>出てきた回答をコピーする。</li>
        <li>出てきた回答を下の欄に貼って「この文章を読ませる」を押す。</li>
      </ol>
      <textarea ref={areaRef} className="mk-input" readOnly rows={12} style={{ width: "100%" }} value={prompt} aria-label="Copilot に貼るプロンプト" onFocus={(e) => e.currentTarget.select()} />
      <div className="mk-row" style={{ marginTop: 6 }}>
        <button type="button" className="mk-btn mk-btn-sm" onClick={() => void copy()}>
          プロンプトをコピー
        </button>
        <span className="mk-small mk-muted" role="status">
          {copied === "ok" ? "コピーしました" : copied === "manual" ? "自動でコピーできませんでした。本文を選択したので、Ctrl+C でコピーしてください" : ""}
        </span>
      </div>
    </details>
  );
}
