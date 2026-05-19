// src/components/tour/TourProvider.tsx
//
// ツアー（オンボーディング・チュートリアル）の実行エンジン。
//
// 【設計方針：機能・UI変更に強く】
// - ターゲット要素は data-tour-id="..." 属性で指定する（CSSセレクタや React refに依存しない）
// - 対象が DOM に存在しなければ skipIfMissing で透過的に次へ
// - ツアー定義は src/components/tour/tours/*.ts にデータとして外出し
// - UI 側は data-tour-id を付けるだけ。スタイル・構造を変えてもツアーは壊れない

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Tour, TourStep } from "./tours/types";

interface TourContextValue {
  /** 指定 id のツアーを開始（既完了でも呼べば再生される） */
  start: (tourId: string) => void;
  /** 現在のツアーを終了 */
  end: () => void;
  /** 指定ツアーが localStorage 上で完了済みか */
  isCompleted: (tourId: string) => boolean;
  /** ツアーが進行中か */
  isRunning: boolean;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within <TourProvider>");
  return ctx;
}

const LS_KEY = "tour_completed_v1";

function loadCompleted(): Record<string, true> {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Record<string, true>; }
  catch { return {}; }
}

function saveCompleted(map: Record<string, true>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

interface Props {
  tours: Record<string, Tour>;  // tours/index.ts から渡す
  children: ReactNode;
}

export function TourProvider({ tours, children }: Props) {
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const activeTour = activeTourId ? tours[activeTourId] : null;
  const activeStep = activeTour ? activeTour.steps[stepIdx] : null;

  // ターゲット要素を data-tour-id で取得（存在しなければ null）
  const findTarget = useCallback((target?: string): HTMLElement | null => {
    if (!target) return null;
    return document.querySelector<HTMLElement>(`[data-tour-id="${CSS.escape(target)}"]`);
  }, []);

  // ステップ変更時：ターゲット位置を測る・skipIfMissing 自動進行
  useEffect(() => {
    if (!activeStep) return;
    const el = findTarget(activeStep.target);
    if (!el) {
      if (activeStep.skipIfMissing) {
        // 次のステップへ自動で進める（次のターゲットも無ければ連鎖）
        setStepIdx(i => i + 1);
        return;
      }
      setTargetRect(null); // 中央表示扱い
      return;
    }
    // スクロールで可視化してから測位
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    // 描画反映を待つため次フレームで rect を測る
    const r = requestAnimationFrame(() => setTargetRect(el.getBoundingClientRect()));
    return () => cancelAnimationFrame(r);
  }, [activeStep, findTarget]);

  // リサイズ時に再測位
  useEffect(() => {
    if (!activeStep) return;
    const onResize = () => {
      const el = findTarget(activeStep.target);
      setTargetRect(el?.getBoundingClientRect() ?? null);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [activeStep, findTarget]);

  // ステップ範囲外なら終了
  useEffect(() => {
    if (activeTour && stepIdx >= activeTour.steps.length) {
      const map = loadCompleted();
      map[activeTour.id] = true;
      saveCompleted(map);
      setActiveTourId(null);
      setStepIdx(0);
    }
  }, [activeTour, stepIdx]);

  const start = useCallback((tourId: string) => {
    if (!tours[tourId]) {
      console.warn(`[tour] unknown tour id: ${tourId}`);
      return;
    }
    setStepIdx(0);
    setActiveTourId(tourId);
  }, [tours]);

  const end = useCallback(() => {
    if (activeTour) {
      const map = loadCompleted();
      map[activeTour.id] = true;
      saveCompleted(map);
    }
    setActiveTourId(null);
    setStepIdx(0);
  }, [activeTour]);

  const isCompleted = useCallback((tourId: string) => !!loadCompleted()[tourId], []);

  const value = useMemo<TourContextValue>(() => ({
    start, end, isCompleted, isRunning: !!activeTour,
  }), [start, end, isCompleted, activeTour]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {activeTour && activeStep && (
        <TourOverlay
          step={activeStep}
          targetRect={targetRect}
          stepIdx={stepIdx}
          totalSteps={activeTour.steps.length}
          tourTitle={activeTour.title}
          onPrev={() => setStepIdx(i => Math.max(0, i - 1))}
          onNext={() => setStepIdx(i => i + 1)}
          onSkip={end}
        />
      )}
    </TourContext.Provider>
  );
}

// ===== オーバーレイ + 吹き出し =====

interface OverlayProps {
  step: TourStep;
  targetRect: DOMRect | null;
  stepIdx: number;
  totalSteps: number;
  tourTitle: string;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}

function TourOverlay({ step, targetRect, stepIdx, totalSteps, tourTitle, onPrev, onNext, onSkip }: OverlayProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);

  // 吹き出しの位置を計算
  const bubblePos = calcBubblePos(targetRect, step.placement);

  // ハイライト用の窓（targetRect があれば穴あき、なければ全画面暗幕）
  const cutoutPadding = 6;
  const showCutout = !!targetRect;
  const cutout = targetRect ? {
    top: targetRect.top - cutoutPadding,
    left: targetRect.left - cutoutPadding,
    width: targetRect.width + cutoutPadding * 2,
    height: targetRect.height + cutoutPadding * 2,
  } : null;

  return (
    <>
      {/* 4分割の暗幕（targetRect の周りをくり抜く）。CSS clip-path を避けて互換性高く */}
      {showCutout && cutout ? (
        <>
          <DimBox style={{ top: 0,                                left: 0,                                  right: 0,                                          height: cutout.top }} onClick={onSkip} />
          <DimBox style={{ top: cutout.top,                       left: 0,                                  width: cutout.left,                                height: cutout.height }} onClick={onSkip} />
          <DimBox style={{ top: cutout.top,                       left: cutout.left + cutout.width,         right: 0,                                          height: cutout.height }} onClick={onSkip} />
          <DimBox style={{ top: cutout.top + cutout.height,       left: 0,                                  right: 0,                                          bottom: 0 }} onClick={onSkip} />
          {/* ハイライト枠 */}
          <div style={{
            position: "fixed",
            top: cutout.top, left: cutout.left,
            width: cutout.width, height: cutout.height,
            border: "2px solid var(--color-brand)",
            borderRadius: "6px",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
            pointerEvents: "none",
            zIndex: 9998,
            transition: "all 0.2s ease",
          }} />
        </>
      ) : (
        <DimBox style={{ inset: 0 }} onClick={onSkip} />
      )}

      {/* 吹き出し */}
      <div
        ref={bubbleRef}
        style={{
          position: "fixed",
          zIndex: 10000,
          ...bubblePos,
          maxWidth: "360px", width: "calc(100vw - 24px)",
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border-primary)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "14px 16px",
          fontSize: "12px",
          color: "var(--color-text-primary)",
          lineHeight: 1.6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", flex: 1 }}>
            👋 {tourTitle}　{stepIdx + 1} / {totalSteps}
          </span>
          <button onClick={onSkip} aria-label="スキップ" style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--color-text-tertiary)", fontSize: "14px", padding: "2px 4px",
          }}>✕</button>
        </div>
        <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px", color: "var(--color-text-primary)" }}>
          {step.title}
        </div>
        <div style={{ whiteSpace: "pre-wrap", color: "var(--color-text-secondary)" }}>
          {step.body}
        </div>
        <div style={{ display: "flex", gap: "6px", marginTop: "12px", justifyContent: "flex-end" }}>
          {stepIdx > 0 && (
            <button onClick={onPrev} style={ghostBtn}>← 戻る</button>
          )}
          <button onClick={onSkip} style={ghostBtn}>スキップ</button>
          <button onClick={onNext} style={primaryBtn}>
            {stepIdx + 1 < totalSteps ? "次へ →" : "完了"}
          </button>
        </div>
      </div>
    </>
  );
}

function DimBox({ style, onClick }: { style: React.CSSProperties; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "fixed",
        background: "rgba(0,0,0,0.5)",
        zIndex: 9997,
        ...style,
      }}
    />
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px", fontSize: "12px", fontWeight: 600,
  background: "var(--color-brand)", color: "#fff",
  border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "6px 12px", fontSize: "11px",
  background: "transparent", color: "var(--color-text-tertiary)",
  border: "1px solid var(--color-border-primary)",
  borderRadius: "var(--radius-md)", cursor: "pointer",
};

// ===== 吹き出しの位置計算 =====

function calcBubblePos(target: DOMRect | null, placement?: TourStep["placement"]): React.CSSProperties {
  const margin = 12;
  const bubbleH = 200; // 概算（実測しなくても見切れにくい）
  const bubbleW = 360;

  // ターゲット無し or center 指定なら画面中央
  if (!target || placement === "center") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  // auto：上下に空きがある方を選択
  const pick: TourStep["placement"] = placement && placement !== "auto"
    ? placement
    : (window.innerHeight - target.bottom > target.top ? "bottom" : "top");

  switch (pick) {
    case "top":
      return {
        bottom: window.innerHeight - target.top + margin,
        left: clamp(target.left + target.width / 2 - bubbleW / 2, 8, window.innerWidth - bubbleW - 8),
      };
    case "bottom":
      return {
        top: target.bottom + margin,
        left: clamp(target.left + target.width / 2 - bubbleW / 2, 8, window.innerWidth - bubbleW - 8),
      };
    case "left":
      return {
        right: window.innerWidth - target.left + margin,
        top: clamp(target.top + target.height / 2 - bubbleH / 2, 8, window.innerHeight - bubbleH - 8),
      };
    case "right":
      return {
        left: target.right + margin,
        top: clamp(target.top + target.height / 2 - bubbleH / 2, 8, window.innerHeight - bubbleH - 8),
      };
    default:
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
