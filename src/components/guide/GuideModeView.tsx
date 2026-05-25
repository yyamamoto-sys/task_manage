// src/components/guide/GuideModeView.tsx
//
// 【設計意図】
// サイドバー「📖 ガイド」モードの本体。左に目次（トップ→ツアー→セクション→記事）、右に本文。
// 開いた直後は「ガイドトップ」を表示する（大きなツアー導線＋クリックでジャンプできる目次）。
// docs/guides/**/*.md を import.meta.glob で取り込んだマニフェストから直接描画する。

import { useMemo, useState, useEffect } from "react";
import { MarkdownLite } from "../common/MarkdownLite";
import { groupedDocs, getDocBySlug } from "../../lib/docs/manifest";
import type { DocEntry } from "../../lib/docs/types";
import { TOUR_LIST } from "../tour/tours";

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

// 記事ではなく「ガイドトップ」を表す内部 slug
const HOME_SLUG = "__home__";

const STORAGE_KEY = "guide_last_slug_v1";

interface GuideModeViewProps {
  /** 「オンボーディングを見直す」ボタンから呼ばれる（MainLayout で OnboardingHome をオーバーレイ表示） */
  onShowOnboarding?: () => void;
  /** 指定 tour id のツアーを再生する（MainLayout 側で TourProvider.start に橋渡し） */
  onStartTour?: (tourId: string) => void;
}

export function GuideModeView({ onShowOnboarding, onStartTour }: GuideModeViewProps = {}) {
  const groups = useMemo(() => groupedDocs(), []);
  const allEntries = useMemo(() => groups.flatMap(g => g.entries), [groups]);

  // 開いた直後は必ずトップを表示する
  const [currentSlug, setCurrentSlug] = useState<string>(HOME_SLUG);

  useEffect(() => {
    if (currentSlug && currentSlug !== HOME_SLUG) localStorage.setItem(STORAGE_KEY, currentSlug);
  }, [currentSlug]);

  const isHome = currentSlug === HOME_SLUG;
  const current: DocEntry | undefined = !isHome && currentSlug ? getDocBySlug(currentSlug) : undefined;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: "var(--color-bg-primary)" }}>
      {/* 目次（サイドバー） */}
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
          {/* 🏠 ガイドトップへ戻る */}
          <button
            onClick={() => setCurrentSlug(HOME_SLUG)}
            style={{
              marginTop: "10px", width: "100%", textAlign: "left",
              padding: "7px 10px", fontSize: "12px", fontWeight: 600,
              background: isHome ? "var(--color-brand-light)" : "transparent",
              color: isHome ? "var(--color-brand)" : "var(--color-text-secondary)",
              border: `1px solid ${isHome ? "var(--color-brand-border)" : "var(--color-border-primary)"}`,
              borderRadius: "var(--radius-md)", cursor: "pointer",
            }}
          >
            🏠 ガイドトップ
          </button>
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
        {isHome ? (
          <GuideHome
            groups={groups}
            onOpenDoc={setCurrentSlug}
            onStartTour={onStartTour}
            onShowOnboarding={onShowOnboarding}
          />
        ) : !current ? (
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

// ===== ガイドトップページ =====
//
// 大きなツアー導線 ＋ クリックでジャンプできる目次。ガイドを開いた直後に表示する。

interface GuideHomeProps {
  groups: { section: string; entries: DocEntry[] }[];
  onOpenDoc: (slug: string) => void;
  onStartTour?: (tourId: string) => void;
  onShowOnboarding?: () => void;
}

function GuideHome({ groups, onOpenDoc, onStartTour, onShowOnboarding }: GuideHomeProps) {
  const mainTour = TOUR_LIST[0];
  const totalArticles = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div style={{ maxWidth: "880px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* ヘッダー */}
      <div>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
          📖 ガイドへようこそ
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: "8px 0 0", lineHeight: 1.7 }}>
          まずはツアーで全体像をつかみ、詳しく知りたいときは下の目次から各マニュアルへどうぞ。
        </p>
      </div>

      {/* 大きなツアー導線 */}
      {onStartTour && mainTour && (
        <button
          onClick={() => onStartTour(mainTour.id)}
          style={{
            display: "flex", alignItems: "center", gap: "18px", textAlign: "left",
            width: "100%", padding: "22px 24px",
            background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
            border: "none", borderRadius: "var(--radius-lg)",
            cursor: "pointer", color: "#fff",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <span style={{
            fontSize: "30px", flexShrink: 0,
            width: "56px", height: "56px", borderRadius: "50%",
            background: "rgba(255,255,255,0.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>▶</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: "17px", fontWeight: 700 }}>
              {mainTour.title}を再生する
            </span>
            <span style={{ display: "block", fontSize: "12px", opacity: 0.9, marginTop: "5px", lineHeight: 1.6 }}>
              主要画面と AI 機能を吹き出しで実演しながら案内します（約 {Math.round((mainTour.estimatedSeconds ?? 150) / 60)} 分）。
              AI への相談も実際にやってみせます。
            </span>
          </span>
          <span style={{ fontSize: "13px", fontWeight: 700, opacity: 0.9, flexShrink: 0 }}>開始 →</span>
        </button>
      )}

      {/* オンボーディング（3ステップ）導線 */}
      {onShowOnboarding && (
        <button
          onClick={onShowOnboarding}
          style={{
            alignSelf: "flex-start",
            padding: "8px 14px", fontSize: "12px", fontWeight: 600,
            background: "var(--color-brand-light)", color: "var(--color-brand)",
            border: "1px solid var(--color-brand-border)",
            borderRadius: "var(--radius-md)", cursor: "pointer",
          }}
        >
          👋 オンボーディング（3ステップ）を見直す
        </button>
      )}

      {/* 目次 */}
      <div>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "4px" }}>
          📑 ガイド目次
        </div>
        <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginBottom: "14px" }}>
          全 {totalArticles} 記事。タイトルをクリックすると本文へジャンプします。
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "14px",
        }}>
          {groups.filter(g => g.entries.length > 0).map(g => (
            <div key={g.section || "_root"} style={{
              border: "1px solid var(--color-border-primary)",
              borderRadius: "var(--radius-md)",
              background: "var(--color-bg-secondary)",
              padding: "12px 14px",
            }}>
              <div style={{
                fontSize: "11px", fontWeight: 700, color: "var(--color-text-tertiary)",
                letterSpacing: "0.05em", textTransform: "uppercase",
                marginBottom: "8px",
              }}>
                {sectionLabel(g.section)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                {g.entries.map(e => (
                  <button
                    key={e.slug}
                    onClick={() => onOpenDoc(e.slug)}
                    style={{
                      display: "flex", alignItems: "center", gap: "6px",
                      width: "100%", textAlign: "left",
                      padding: "6px 8px", fontSize: "12px",
                      background: "transparent", border: "none",
                      borderRadius: "var(--radius-sm)", cursor: "pointer",
                      color: "var(--color-text-secondary)",
                    }}
                    onMouseEnter={ev => { (ev.currentTarget as HTMLButtonElement).style.background = "var(--color-brand-light)"; (ev.currentTarget as HTMLButtonElement).style.color = "var(--color-brand)"; }}
                    onMouseLeave={ev => { (ev.currentTarget as HTMLButtonElement).style.background = "transparent"; (ev.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)"; }}
                  >
                    <span style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }}>›</span>
                    <span style={{ flex: 1 }}>{e.title}</span>
                    {e.deprecated && <span style={{ fontSize: "9px", color: "var(--color-text-tertiary)", flexShrink: 0 }}>旧</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
