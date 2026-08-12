// src/components/lab/widgets/WidgetConfigModal.tsx
//
// 【設計意図】
// configSchema（WidgetConfigField[]）からウィジェットの設定フォームを自動生成する汎用
// コンポーネント。個別ウィジェット用の分岐は書かない（type ごとの分岐のみ。ここに if 文が
// 増え始めたら設計が壊れている）。
//
// 選択肢の実データ（PJ一覧・メンバー一覧）は呼び出し元から渡された WidgetContext.data から
// 取る（このモーダル自身が store を読むことは絶対にしない）。
// - type="projectMultiSelect"/"memberMultiSelect" は常に data.projects/data.members から
//   選択肢を組み立てる（field.options は使わない）。
// - type="select" は field.options が明示されていればそれを使い、未指定（動的な選択肢が
//   必要なケース。今のところ QuickAddTaskWidget.projectId のみ）なら data.projects から
//   組み立てる（唯一の一般化ルール。特定ウィジェットの key で分岐しているわけではない）。
//
// 保存は即時（setConfig）。ただしテキスト系（text/textarea）は打鍵のたびにレイアウト全体の
// 保存タイマー（useMyPageLayout・800ms）をリセットしすぎないよう、ここでも600ms程度の
// ローカルデバウンスを挟んでから setConfig を呼ぶ（MemoWidget と同じ流儀）。

import { useEffect, useRef, useState } from "react";
import type { WidgetConfigField, WidgetContext } from "../../../lib/widgets/types";
import { resolveConfig, applyConfigChange } from "../../../lib/widgets/config";
import { CustomSelect } from "../../common/CustomSelect";
import { modalOverlayStyle, modalBoxStyle } from "../../common/modalStyles";

interface Props {
  title: string;
  icon: string;
  schema: WidgetConfigField[];
  context: WidgetContext;
  onClose: () => void;
}

const TEXT_DEBOUNCE_MS = 600;

const labelStyle: React.CSSProperties = {
  fontSize: "11px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px",
};
const descStyle: React.CSSProperties = {
  fontSize: "10px", color: "var(--color-text-tertiary)", marginBottom: "6px", lineHeight: 1.5,
};
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "6px 9px", fontSize: "12px",
  border: "1px solid var(--color-border-primary)", borderRadius: "var(--radius-md)",
  background: "var(--color-bg-secondary)", color: "var(--color-text-primary)",
  fontFamily: "inherit", outline: "none",
};
const chipStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "4px",
  fontSize: "11px", padding: "2px 8px",
  background: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "99px", color: "var(--color-text-secondary)",
};
const chipRemoveBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "0", color: "var(--color-text-tertiary)",
  fontSize: "11px", lineHeight: 1, marginLeft: "2px",
};

export function WidgetConfigModal({ title, icon, schema, context, onClose }: Props) {
  const resolved = resolveConfig(schema, context.config);

  const commit = (key: string, value: unknown) => {
    context.setConfig(applyConfigChange(context.config, key, value));
  };

  return (
    // 背景クリックで閉じる（マウス操作の補助）。閉じる操作自体は✕ボタンでキーボードから可能
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="animate-overlay"
      style={{ ...modalOverlayStyle(260), background: "rgba(0,0,0,0.5)", padding: "20px" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="panel-slide-up" style={{
        ...modalBoxStyle("min(420px, 100%)"),
        background: "var(--color-bg-primary)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
      }}>
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid var(--color-border-primary)",
          display: "flex", alignItems: "center", gap: "8px",
        }}>
          <span style={{ fontSize: "14px" }}>{icon}</span>
          <span style={{ flex: 1, fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            {title} の設定
          </span>
          <button
            onClick={onClose} aria-label="閉じる"
            style={{ background: "transparent", border: "none", fontSize: "16px", cursor: "pointer", color: "var(--color-text-tertiary)" }}
          >✕</button>
        </div>
        <div style={{ padding: "14px 18px", overflow: "auto" }}>
          {schema.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>設定項目はありません</div>
          ) : (
            schema.map(field => (
              <ConfigFieldRow
                key={field.key}
                field={field}
                value={resolved[field.key]}
                context={context}
                onCommit={v => commit(field.key, v)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigFieldRow({
  field, value, context, onCommit,
}: {
  field: WidgetConfigField;
  value: unknown;
  context: WidgetContext;
  onCommit: (v: unknown) => void;
}) {
  if (field.type === "boolean") {
    return (
      <div style={{ marginBottom: "14px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "7px", cursor: "pointer" }}>
          <input type="checkbox" checked={!!value} onChange={e => onCommit(e.target.checked)} />
          <span style={{ fontSize: "12px", color: "var(--color-text-primary)" }}>{field.label}</span>
        </label>
        {field.description && <div style={{ ...descStyle, marginTop: "4px", marginBottom: 0 }}>{field.description}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={labelStyle}>{field.label}</div>
      {field.description && <div style={descStyle}>{field.description}</div>}
      <FieldControl field={field} value={value} context={context} onCommit={onCommit} />
    </div>
  );
}

function FieldControl({
  field, value, context, onCommit,
}: {
  field: WidgetConfigField;
  value: unknown;
  context: WidgetContext;
  onCommit: (v: unknown) => void;
}) {
  switch (field.type) {
    case "text":
    case "textarea":
      return <DebouncedTextControl field={field} value={typeof value === "string" ? value : ""} onCommit={onCommit} />;

    case "number": {
      const n = typeof value === "number" ? value : 0;
      return (
        <input
          type="number"
          value={n}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          onChange={e => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) onCommit(parsed);
          }}
          style={inputStyle}
        />
      );
    }

    case "select": {
      // options が明示されていればそれを使う（静的な列挙）。無指定なら PJ 一覧から
      // 動的に組み立てる（唯一の一般化ルール。上部ヘッダコメント参照）。
      const options = field.options && field.options.length > 0
        ? field.options
        : [{ label: "（なし）", value: "" }, ...context.data.projects.map(p => ({ label: p.name, value: p.id }))];
      return (
        <CustomSelect
          value={typeof value === "string" ? value : ""}
          onChange={v => onCommit(v)}
          options={options}
          searchable={options.length > 6}
        />
      );
    }

    case "projectMultiSelect":
    case "memberMultiSelect": {
      const isProjects = field.type === "projectMultiSelect";
      const selected = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
      const pool: { id: string; label: string }[] = isProjects
        ? context.data.projects.map(p => ({ id: p.id, label: p.name }))
        : context.data.members.map(m => ({ id: m.id, label: m.display_name }));
      return (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "6px" }}>
            {selected.map(id => {
              const item = pool.find(p => p.id === id);
              if (!item) return null;
              return (
                <span key={id} style={chipStyle}>
                  {item.label}
                  <button
                    onClick={() => onCommit(selected.filter(x => x !== id))}
                    aria-label={`${item.label} を外す`}
                    style={chipRemoveBtn}
                  >×</button>
                </span>
              );
            })}
            {selected.length === 0 && (
              <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>未選択</span>
            )}
          </div>
          <CustomSelect
            multi
            value=""
            onChange={() => {}}
            selectedValues={selected}
            onToggle={id => onCommit(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])}
            options={pool.map(p => ({ value: p.id, label: p.label }))}
            placeholder={isProjects ? "＋ プロジェクトを追加..." : "＋ メンバーを追加..."}
            searchable
          />
        </div>
      );
    }

    default:
      return null;
  }
}

function DebouncedTextControl({
  field, value, onCommit,
}: {
  field: WidgetConfigField;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 外部から config が更新された場合（別タブでの編集後の再取得等）に追従する。
  // 自分自身の setConfig 呼び出し（デバウンス経由）を追いかけて再同期しないよう、
  // value（文字列プリミティブ）の変化だけを見る。
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleChange = (v: string) => {
    setText(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCommit(v), TEXT_DEBOUNCE_MS);
  };

  if (field.type === "textarea") {
    return (
      <textarea
        value={text}
        onChange={e => handleChange(e.target.value)}
        placeholder={field.placeholder}
        rows={3}
        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
      />
    );
  }
  return (
    <input
      type="text"
      value={text}
      onChange={e => handleChange(e.target.value)}
      placeholder={field.placeholder}
      style={inputStyle}
    />
  );
}
