// src/components/lab/widgets/MemoWidget.tsx
//
// 【設計意図】
// 自分だけのフリーテキストメモ。「設定を持つウィジェット」の最初の実例として、
// config の往復（setConfig で書き込み → 次回描画時に config から読み戻す）を実証する見本を
// 兼ねる（Phase 2 の configSchema 設計の検証材料。docs/dev/mypage-widgets-design.md §5）。
// 入力のたびに setConfig を呼ぶと保存デバウンス（useMyPageLayout 側・800ms）が
// 短い間隔で連打されるため、ここでも600ms程度のローカルデバウンスを挟んでから
// setConfig を呼ぶ（キー入力のたびにレイアウト全体の保存タイマーをリセットしすぎないため）。
//
// 【Phase 2】configSchema に「見出し」（title）を追加した。本文は今まで通りウィジェット内で
// 直接編集する（本文は「設定」ではなく「中身」のため、⚙モーダルには出さない）。見出しは
// 複数枚のメモを置いたときに見分けるためのラベルで、空なら従来通り見出し無しの表示。

import { useEffect, useRef, useState } from "react";
import type { WidgetConfigField, WidgetContext } from "../../../lib/widgets/types";
import { resolveConfig } from "../../../lib/widgets/config";

/** レジストリ（registry.ts）が WidgetDefinition.configSchema としてそのまま使う */
export const MEMO_CONFIG_SCHEMA: WidgetConfigField[] = [
  { key: "title", label: "見出し", type: "text", placeholder: "例）今日やること" },
];

export function MemoWidget({ config, setConfig }: WidgetContext) {
  const configText = typeof config.text === "string" ? config.text : "";
  const [text, setText] = useState(configText);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const title = resolveConfig(MEMO_CONFIG_SCHEMA, config).title as string;

  // config（DBの最新値）がこのインスタンス以外の経路で変わったら追従する
  // （例：別タブで編集した後にこの画面を開き直した場合）
  useEffect(() => {
    setText(typeof config.text === "string" ? config.text : "");
    // config.text の変化だけを見る（config全体を依存にすると自分自身のsetConfig呼び出しで
    // 参照が変わるたびに再同期され、入力中のカーソル位置が乱れるため）
  }, [config.text]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleChange = (v: string) => {
    setText(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setConfig({ ...config, text: v });
    }, 600);
  };

  return (
    <div>
      {title.trim().length > 0 && (
        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: "5px" }}>
          {title}
        </div>
      )}
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder="自分だけのメモ…"
        rows={4}
        style={{
          width: "100%", boxSizing: "border-box", resize: "vertical",
          padding: "8px 10px", fontSize: "12px", lineHeight: 1.6,
          border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
          background: "var(--color-bg-secondary)", color: "var(--color-text-primary)",
          fontFamily: "inherit", outline: "none",
        }}
      />
    </div>
  );
}
