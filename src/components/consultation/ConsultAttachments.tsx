// src/components/consultation/ConsultAttachments.tsx
//
// 【設計意図・v3.144】AI相談の入力欄に資料（Word・Excel・PowerPoint・PDF・HTML・テキスト）を添える部品。
// 添付ボタン＋入力欄へのドラッグ&ドロップ（複数可）＋入力欄の上のチップ表示。受付判定・読み込み・上限の計算は
// lib/ai/consultationAttachment(.Loader).ts にあり、ここは表示と配線だけ。添付はその1回の送信だけに使う。

import { useRef, useState } from "react";
import type { FileAttachment } from "../../lib/ai/invokeAI";
import {
  applyAttachmentTextBudget, describeAttachmentOverflow, isPdfPassthrough, MAX_CONSULT_ATTACHMENT_CHARS,
} from "../../lib/ai/consultationAttachment";
import {
  CONSULT_ATTACHMENT_ACCEPT, checkConsultAttachFile, checkCanAddAttachment, loadConsultAttachment,
} from "../../lib/ai/consultationAttachmentLoader";

interface Props {
  attachments: FileAttachment[];
  onChange: (next: FileAttachment[]) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

export function ConsultAttachments({ attachments, onChange, disabled, children }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const addFiles = async (files: File[]) => {
    if (disabled || files.length === 0) return;
    setLoading(true);
    const errs: string[] = [];
    let current = attachmentsRef.current;
    for (const file of files) {
      const check = checkConsultAttachFile(file);
      if (!check.ok) { errs.push(check.reason); continue; }
      try {
        const att = await loadConsultAttachment(file);
        const why = checkCanAddAttachment(current, att);
        if (why) { errs.push(why); continue; }
        current = [...current, att];
      } catch (e) {
        errs.push(`${file.name}：${e instanceof Error ? e.message : "読み込みに失敗しました。"}`);
      }
    }
    onChange(current);
    setErrors(errs);
    setLoading(false);
  };

  const budgeted = applyAttachmentTextBudget(attachments);
  const overflow = describeAttachmentOverflow(attachments);
  const total = attachments.reduce((s, a) => s + (a.isText ? a.data.length : 0), 0);

  return (
    // ドラッグ&ドロップ専用。キーボードでは下の「添付」ボタンから同じ操作ができる
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      style={{ position: "relative", display: "flex", flexDirection: "column", gap: "6px" }}
      onDragEnter={e => { e.preventDefault(); dragCounter.current++; if (dragCounter.current === 1) setIsDragOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragOver(false); } }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragOver(false);
        void addFiles(Array.from(e.dataTransfer.files ?? []));
      }}
    >
      {attachments.length > 0 && (
        <div data-testid="consult-attachment-chips" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {budgeted.map((b, i) => {
            const att = b.attachment;
            const pdf = isPdfPassthrough(att);
            return (
              <div key={`${att.fileName}-${i}`} style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "3px 8px",
                background: "var(--color-bg-purple, #ede9fe)", border: "1px solid var(--color-border-purple, #ddd6fe)",
                borderRadius: "var(--radius-md)", fontSize: "11px", color: "var(--color-text-primary)",
              }}>
                <span style={{ flexShrink: 0 }}>{pdf ? "📑" : "📄"}</span>
                <span title={att.fileName} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                  {att.fileName}
                </span>
                <span style={{ flexShrink: 0, color: "var(--color-text-secondary)" }}>
                  {pdf ? "PDFのまま送信（文字を読み取れないため）" : `${b.originalChars.toLocaleString("ja-JP")}字`}
                </span>
                {b.truncated && (
                  <span style={{ flexShrink: 0, color: "var(--color-danger, #dc2626)" }}>
                    {b.sentChars === 0 ? "送られません" : `${b.sentChars.toLocaleString("ja-JP")}字まで`}
                  </span>
                )}
                <button
                  type="button" aria-label={`${att.fileName}を外す`} title="外す" disabled={disabled}
                  onClick={() => onChange(attachments.filter((_, j) => j !== i))}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", padding: 0, lineHeight: 1, flexShrink: 0 }}
                >✕</button>
              </div>
            );
          })}
          <div data-testid="consult-attachment-total" style={{ fontSize: "10px", color: overflow ? "var(--color-danger, #dc2626)" : "var(--color-text-tertiary)" }}>
            {overflow ?? `資料の文字数：${total.toLocaleString("ja-JP")}字（上限${MAX_CONSULT_ATTACHMENT_CHARS.toLocaleString("ja-JP")}字）`}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" style={{ fontSize: "11px", color: "var(--color-danger, #dc2626)", display: "flex", flexDirection: "column", gap: "2px" }}>
          {errors.map((m, i) => <span key={i}>{m}</span>)}
        </div>
      )}

      {children}

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          ref={inputRef} type="file" multiple accept={CONSULT_ATTACHMENT_ACCEPT} style={{ display: "none" }}
          onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void addFiles(files); }}
        />
        <button
          type="button" disabled={disabled || loading} onClick={() => inputRef.current?.click()}
          title="Word・Excel・PowerPoint・PDF・HTML・テキストを添付できます（文字だけを取り出して送ります。画像は不可）"
          style={{
            display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px", fontSize: "11px",
            background: "var(--color-bg-secondary)", border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)", color: "var(--color-text-secondary)", cursor: "pointer",
          }}
        >
          <span>📎</span><span>{loading ? "読み込み中..." : "資料を添付"}</span>
        </button>
      </div>

      {isDragOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(99,102,241,0.07)", border: "2px dashed var(--color-ai-from)", borderRadius: "var(--radius-md)",
        }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-ai-from)", background: "rgba(99,102,241,0.1)", padding: "6px 14px", borderRadius: "var(--radius-full)" }}>
            ここにファイルをドロップ（複数可）
          </div>
        </div>
      )}
    </div>
  );
}
