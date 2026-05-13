// src/components/guide/GuideModeView.tsx
//
// 【設計意図】
// サイドバー「📖 ガイド」モードの本体。左に目次（セクション→記事）、右に MD 本文。
// docs/guides/**/*.md を import.meta.glob で取り込んだマニフェストから直接描画する。
// 一覧の見た目は OkrDashboardView の概要オーバーレイのスタイルに揃える。

import { useMemo, useState, useEffect } from "react";
import { MarkdownLite } from "../common/MarkdownLite";
import { groupedDocs, getDocBySlug } from "../../lib/docs/manifest";
import type { DocEntry } from "../../lib/docs/types";

const SECTION_LABELS: Record<string, string> = {
  "": "トップ",
  "_meta": "メタ・規約",
  "01_onboarding": "01 オンボーディング",
  "02_modes": "02 モード別マニュアル",
  "03_roles": "03 役割別ガイド",
  "04_workflows": "04 ルーティン業務",
  "05_admin": "05 管理者作業",
  "06_troubleshooting": "06 トラブルシュート",
};

function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? key;
}

const STORAGE_KEY = "guide_last_slug_v1";

export function GuideModeView() {
  const groups = useMemo(() => groupedDocs(), []);
  const allEntries = useMemo(() => groups.flatMap(g => g.entries), [groups]);

  const [currentSlug, setCurrentSlug] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ?? (allEntries[0]?.slug ?? "");
  });

  useEffect(() => { if (currentSlug) localStorage.setItem(STORAGE_KEY, currentSlug); }, [currentSlug]);

  const current: DocEntry | undefined = currentSlug ? getDocBySlug(currentSlug) : undefined;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: "var(--color-bg-primary)" }}>
      {/* 目次 */}
      <aside style={{
        width: "280px", borderRight: "1px solid var(--color-border-primary)",
        background: "var(--color-bg-secondary)", overflow: "auto", flexShrink: 0,
      }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border-primary)" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "16px" }}>📖</span>ガイド
          </div>
          <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
            記事数：{allEntries.length}
          </div>
        </div>
        <nav>
          {groups.map(g => (
            <div key={g.section || "_root"} style={{ padding: "8px 0" }}>
              <div style={{
                padding: "4px 16px", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)",
                letterSpacing: "0.06em", textTransform: "uppercase",
              }}>{sectionLabel(g.section)}</div>
              {g.entries.map(e => {
                const active = e.slug === currentSlug;
                return (
                  <button
                    key={e.slug}
                    onClick={() => setCurrentSlug(e.slug)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "7px 16px 7px 24px", fontSize: "12px",
                      background: active ? "var(--color-brand-light)" : "transparent",
                      color: active ? "var(--color-brand)" : "var(--color-text-secondary)",
                      border: "none", borderLeft: `3px solid ${active ? "var(--color-brand)" : "transparent"}`,
                      cursor: "pointer", fontWeight: active ? 600 : 400,
                    }}
                  >
                    {e.title}
                    {e.deprecated && <span style={{ fontSize: "9px", marginLeft: "5px", color: "var(--color-text-tertiary)" }}>旧</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {allEntries.length === 0 && (
            <div style={{ padding: "16px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
              docs/guides/ にまだ記事がありません。
            </div>
          )}
        </nav>
      </aside>

      {/* 本文 */}
      <main style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {!current ? (
          <div style={{ fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "60px 0" }}>
            左の目次から記事を選んでください。
          </div>
        ) : (
          <article style={{ maxWidth: "780px", margin: "0 auto" }}>
            <header style={{ marginBottom: "20px", paddingBottom: "12px", borderBottom: "1px solid var(--color-border-primary)" }}>
              <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{current.title}</h1>
              <div style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "6px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <span>パス：<code>{current.path}</code></span>
                <span>最終更新：{current.last_updated || "—"}</span>
                {current.owner && <span>担当：{current.owner}</span>}
                {current.audience.length > 0 && <span>対象：{current.audience.join("・")}</span>}
                {current.deprecated && <span style={{ color: "var(--color-text-danger)" }}>⚠ 旧仕様</span>}
              </div>
            </header>
            <MarkdownLite text={current.body} />
            {current.related && current.related.length > 0 && (
              <div style={{ marginTop: "32px", paddingTop: "12px", borderTop: "1px solid var(--color-border-primary)" }}>
                <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: "6px", letterSpacing: "0.06em" }}>関連</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {current.related.map(r => {
                    const target = allEntries.find(e => e.mode === r);
                    return (
                      <button
                        key={r}
                        onClick={() => target && setCurrentSlug(target.slug)}
                        disabled={!target}
                        style={{
                          fontSize: "11px", padding: "3px 10px",
                          background: target ? "var(--color-brand-light)" : "var(--color-bg-secondary)",
                          color: target ? "var(--color-brand)" : "var(--color-text-tertiary)",
                          borderRadius: "var(--radius-full)",
                          border: `1px solid ${target ? "var(--color-brand)" : "var(--color-border-primary)"}`,
                          cursor: target ? "pointer" : "default",
                        }}
                      >{target?.title ?? r}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  );
}
