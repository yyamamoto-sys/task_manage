import { useEffect, useId, useRef, useState } from "react";
import { registerUnsavedEditor, unregisterUnsavedEditor } from "../../../../lib/editing/unsavedEditorRegistry";
import { canReadPasted, readPastedText, type ReadFilesFn } from "../pasteRead";

/**
 * 文章を貼り付けて読ませる欄（v3.222）。Copilot の回答や議事メモをそのまま貼れる。
 * 読み取りはファイル選択と同じ readFiles に File として渡す。書きかけがあるまま引き出しを閉じると消えるため、
 * unsavedEditorRegistry に載せる（Section 46・閉じる前に破棄確認が出る）
 */
export function PasteReadBox({ readFiles, disabled }: { readFiles: ReadFilesFn; disabled: boolean }) {
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const id = useId();
  const textRef = useRef("");
  textRef.current = text;
  useEffect(() => {
    registerUnsavedEditor(id, () => textRef.current !== "");
    return () => unregisterUnsavedEditor(id);
  }, [id]);

  const run = async () => {
    if (reading || disabled || !canReadPasted(text)) return;
    setReading(true);
    try {
      if (await readPastedText(text, new Date(), readFiles)) setText("");
    } finally {
      setReading(false);
    }
  };

  return (
    <div style={{ margin: "8px 0" }}>
      <h4 className="mk-panel-sub">文章を貼り付けて読ませる</h4>
      <p className="mk-small mk-muted">Copilot の回答や議事メモをそのまま貼れます。</p>
      <textarea
        className="mk-input"
        rows={8}
        style={{ width: "100%", resize: "vertical" }}
        value={text}
        aria-label="読ませる文章"
        disabled={disabled || reading}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mk-row" style={{ marginTop: 6 }}>
        <button type="button" className="mk-btn mk-btn-primary" disabled={disabled || reading || !canReadPasted(text)} onClick={() => void run()}>
          {reading ? "読み取り中…" : "この文章を読ませる"}
        </button>
        <span className="mk-small mk-muted">{text.length.toLocaleString()}字</span>
      </div>
    </div>
  );
}
