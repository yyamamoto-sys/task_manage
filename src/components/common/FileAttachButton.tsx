// src/components/common/FileAttachButton.tsx
//
// PDF・画像・テキストファイルをAI呼び出しに添付するためのUI部品。
// FileAttachment型はinvokeAI.tsに定義されており、buildMessageContentで
// ContentBlock[]またはstring追記に変換してAIに渡す。

import { useRef, useState } from "react";
import type { FileAttachment } from "../../lib/ai/invokeAI";

export type { FileAttachment };

const ACCEPT_TYPES = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.html";
const TEXT_MEDIA_TYPES = ["text/plain", "text/markdown", "text/csv", "text/html"];
const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const DOC_MEDIA_TYPES = ["application/pdf"];

function processFileAttachment(file: File, onAttach: (att: FileAttachment) => void) {
  const mediaType = resolveMediaType(file);
  if (!isSupported(mediaType)) {
    alert(`非対応の形式です。\n対応: PDF / 画像(PNG・JPG・WebP・GIF) / テキスト(TXT・MD・CSV・HTML)`);
    return;
  }
  const isText = TEXT_MEDIA_TYPES.includes(mediaType);
  if (isText) {
    const reader = new FileReader();
    reader.onload = ev => {
      onAttach({ fileName: file.name, mediaType, data: ev.target?.result as string, isText: true });
    };
    reader.readAsText(file, "utf-8");
  } else {
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      onAttach({ fileName: file.name, mediaType, data: base64, isText: false });
    };
    reader.readAsDataURL(file);
  }
}

function resolveMediaType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    md: "text/markdown", csv: "text/csv", txt: "text/plain", html: "text/html",
    pdf: "application/pdf",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    webp: "image/webp", gif: "image/gif",
  };
  return map[ext] ?? "";
}

function isSupported(mediaType: string): boolean {
  return (
    TEXT_MEDIA_TYPES.includes(mediaType) ||
    IMAGE_MEDIA_TYPES.includes(mediaType) ||
    DOC_MEDIA_TYPES.includes(mediaType)
  );
}

interface Props {
  attachment: FileAttachment | null;
  onAttach: (att: FileAttachment) => void;
  onRemove: () => void;
}

export function FileAttachButton({ attachment, onAttach, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    processFileAttachment(file, onAttach);
  };

  const fileIcon = attachment
    ? attachment.mediaType.startsWith("image/") ? "🖼" : attachment.isText ? "📄" : "📑"
    : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_TYPES}
        onChange={handleChange}
        style={{ display: "none" }}
      />
      {attachment ? (
        <div style={{
          display: "flex", alignItems: "center", gap: "5px",
          padding: "3px 8px",
          background: "var(--color-bg-purple, #ede9fe)",
          border: "1px solid var(--color-border-purple, #ddd6fe)",
          borderRadius: "var(--radius-full)",
          fontSize: "11px", color: "var(--color-text-primary)",
          maxWidth: "220px",
        }}>
          <span style={{ fontSize: "12px", flexShrink: 0 }}>{fileIcon}</span>
          <span style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
          }}>
            {attachment.fileName}
          </span>
          <button
            onClick={onRemove}
            title="添付を解除"
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--color-text-tertiary)", fontSize: "12px",
              padding: 0, lineHeight: 1, flexShrink: 0,
            }}
          >✕</button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          title="PDF・画像・テキストを添付"
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            padding: "4px 8px",
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-primary)",
            borderRadius: "var(--radius-md)",
            fontSize: "11px", color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          <span>📎</span>
          <span>添付</span>
        </button>
      )}
    </div>
  );
}

// ===== ドラッグアンドドロップゾーン =====

export function FileDropZone({
  children,
  onAttach,
  style,
}: {
  children: React.ReactNode;
  onAttach: (att: FileAttachment) => void;
  style?: React.CSSProperties;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFileAttachment(file, onAttach);
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ position: "relative", ...style }}
    >
      {children}
      {isDragOver && (
        <div style={{
          position: "absolute", inset: 0,
          background: "rgba(99,102,241,0.07)",
          border: "2px dashed #6366f1",
          borderRadius: "var(--radius-md)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 10,
          pointerEvents: "none",
        }}>
          <div style={{
            fontSize: "12px", color: "#6366f1", fontWeight: "600",
            background: "rgba(99,102,241,0.1)", padding: "6px 14px",
            borderRadius: "var(--radius-full)",
          }}>
            📎 ファイルをドロップして添付
          </div>
        </div>
      )}
    </div>
  );
}
