// src/components/common/FileAttachButton.tsx
//
// PDF・画像・テキストファイルをAI呼び出しに添付するためのUI部品。
// FileAttachment型はinvokeAI.tsに定義されており、buildMessageContentで
// ContentBlock[]またはstring追記に変換してAIに渡す。

import { useRef, useState } from "react";
import type { FileAttachment } from "../../lib/ai/invokeAI";
import { extractDocxText, isDocxFile } from "../../lib/docxText";
import { extractHtmlText, isHtmlFile } from "../../lib/htmlText";
import { isPdfFile } from "../../lib/pdfTextFormat";
import { resolveMediaType, isSupportedMediaType, TEXT_MEDIA_TYPES } from "../../lib/fileAttachMediaType";
import { useT } from "../../hooks/useT";
import { useLangStore } from "../../stores/langStore";
import { translate } from "../../lib/i18n";

// 【設計意図】processFileAttachmentはコンポーネント外の素の関数（drag&dropハンドラからも
// 呼ぶため）でuseT()フックが使えない。alert()文言のみ useLangStore.getState().lang +
// translate() を直接呼ぶ（ErrorBoundary.tsxと同じ考え方）。
function tOutside(key: string): string {
  return translate(useLangStore.getState().lang, key);
}

export type { FileAttachment };

const ACCEPT_TYPES = ".pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.html,.htm";

function processFileAttachment(file: File, onAttach: (att: FileAttachment) => void) {
  // Word(.docx)：Anthropic API は直接読めないのでクライアント側で本文テキストを抽出し、テキスト添付として渡す
  if (isDocxFile(file)) {
    extractDocxText(file)
      .then(text => onAttach({ fileName: file.name, mediaType: "text/plain", data: text, isText: true }))
      .catch((e: unknown) => alert(e instanceof Error ? e.message : tOutside("common.fileAttach.docxFailed")));
    return;
  }
  // HTML(.html/.htm)：raw HTML ではなく本文テキストを抽出し、text/plain のテキスト添付として渡す
  if (isHtmlFile(file)) {
    extractHtmlText(file)
      .then(text => onAttach({ fileName: file.name, mediaType: "text/plain", data: text, isText: true }))
      .catch((e: unknown) => alert(e instanceof Error ? e.message : tOutside("common.fileAttach.htmlFailed")));
    return;
  }
  // PDF：base64のdocumentブロックとしてAI（Edge Function）に送ると、大きなPDFでワーカーが
  // リソース上限で落ちる事故が起きたため（CLAUDE.md Section 19）、.docx/.htmlと同じく
  // クライアント側でテキスト抽出してからテキスト添付として渡す。isPdfFile自体は
  // pdfTextFormat.tsの純粋関数（pdfjs-dist非依存）で判定し、実際の抽出処理・フォールバック
  // 判定（v3.79・pdfjs-distを抱えるlib/pdfAttachment.ts経由）はPDFと判定できたときだけ
  // 動的importする（Section 19。PDFを一度も添付しない人がこのチャンクをダウンロードしない
  // ようにするのが肝）。抽出結果が空・抽出自体が失敗した場合は自動でbase64直送に
  // フォールバックする（buildPdfAttachment内で判定。Section 27・28参照）。
  // ただしテキスト層が無く、かつ PDF_BASE64_FALLBACK_MAX_BYTES を超える場合は
  // base64へ落とさず例外を投げる（546を踏ませず、次にすべきことが分かる文言を出すため。
  // v3.79・Section 37）。したがってここでalertが出るのは「サイズ超過」と
  // 「base64の読み込み自体の失敗」の2通り。どちらも e.message をそのまま見せる。
  if (isPdfFile(file)) {
    import("../../lib/pdfAttachment")
      .then(({ buildPdfAttachment }) => buildPdfAttachment(file))
      .then(onAttach)
      .catch((e: unknown) => alert(e instanceof Error ? e.message : tOutside("common.fileAttach.pdfFailed")));
    return;
  }
  const mediaType = resolveMediaType(file);
  if (!isSupportedMediaType(mediaType)) {
    alert(tOutside("common.fileAttach.unsupported"));
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

interface Props {
  attachment: FileAttachment | null;
  onAttach: (att: FileAttachment) => void;
  onRemove: () => void;
}

export function FileAttachButton({ attachment, onAttach, onRemove }: Props) {
  const t = useT();
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
            title={t("common.fileAttach.removeTitle")}
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
          title={t("common.fileAttach.attachTitle")}
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
          <span>{t("common.fileAttach.attach")}</span>
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
  const t = useT();
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
    // ドラッグ&ドロップ専用ゾーン。ファイル選択自体は別途キーボード操作可能な
    // 「添付」ボタン（input[type=file]）から可能なため、ここはマウス専用でよい
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
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
          border: "2px dashed var(--color-ai-from)",
          borderRadius: "var(--radius-md)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 10,
          pointerEvents: "none",
        }}>
          <div style={{
            fontSize: "12px", color: "var(--color-ai-from)", fontWeight: "600",
            background: "rgba(99,102,241,0.1)", padding: "6px 14px",
            borderRadius: "var(--radius-full)",
          }}>
            {t("common.fileAttach.dropHint")}
          </div>
        </div>
      )}
    </div>
  );
}
