// src/components/tour/TourProvider.tsx
//
// ⚠ 改修前に必ず読む：docs/dev/tour-guidelines.md（暗さ・モーション・トンマナ・トークンの統一基準）
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
    const measure = () => setTargetRect(el.getBoundingClientRect());
    const r = requestAnimationFrame(measure);
    // パネルのスライドイン等、表示直後にサイズが変化するターゲットに追従して数回測り直す
    const t1 = setTimeout(measure, 200);
    const t2 = setTimeout(measure, 450);
    return () => { cancelAnimationFrame(r); clearTimeout(t1); clearTimeout(t2); };
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

  // アクション付きステップに入ったらアプリ側へ通知（実演などの副作用はアプリが行う）
  useEffect(() => {
    if (activeStep?.action) {
      window.dispatchEvent(new CustomEvent("tour:action", { detail: activeStep.action }));
    }
  }, [activeStep]);

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
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}

// 「動きを減らす」OS設定を尊重するためのフック（インライン transition の出し分けに使う）
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState<boolean>(() =>
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

const srOnly: React.CSSProperties = {
  position: "fixed", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
};

function TourOverlay({ step, targetRect, stepIdx, totalSteps, onPrev, onNext, onSkip }: OverlayProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);   // 内側（実測・出現アニメ）
  const dialogRef = useRef<HTMLDivElement>(null);   // 外側（位置・フォーカス・role=dialog）
  const [bubbleSize, setBubbleSize] = useState<{ w: number; h: number } | null>(null);
  const reduce = usePrefersReducedMotion();

  // 吹き出しの実サイズを測って配置に反映（初回レンダー直後と内容変更時）
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBubbleSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  // ステップが変わるたびにダイアログへフォーカス（キーボード操作の起点・読み上げのトリガ）
  useEffect(() => { dialogRef.current?.focus(); }, [stepIdx]);

  // キーボード操作：Esc=終了 / →・Enter=次へ / ←=戻る（入力欄フォーカス時は奪わない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const inField = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
      if (e.key === "Escape") { e.preventDefault(); onSkip(); return; }
      if (inField) return;
      if (e.key === "ArrowRight") { e.preventDefault(); onNext(); }
      else if (e.key === "ArrowLeft") { if (stepIdx > 0) { e.preventDefault(); onPrev(); } }
      else if (e.key === "Enter" && ae?.tagName !== "BUTTON") { e.preventDefault(); onNext(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onNext, onPrev, onSkip, stepIdx]);

  // フォーカストラップ：Tab はダイアログ内のボタンだけを巡回し、背後のアプリへ抜けない
  const handleTrapKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>("button"));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  // 吹き出しの位置を計算（実測サイズが取れたら利用）
  const bubblePos = calcBubblePos(targetRect, step.placement, bubbleSize);

  // ハイライト用の窓（targetRect があれば穴あき、なければ全画面暗幕）
  // step.dim === false のステップは暗幕を一切描かず吹き出しのみ（実演でアプリ画面を見せる用）
  const showDim = step.dim !== false;
  const cutoutPadding = 8; // --tour-spot-pad
  const showCutout = !!targetRect;
  const cutout = targetRect ? {
    top: targetRect.top - cutoutPadding,
    left: targetRect.left - cutoutPadding,
    width: targetRect.width + cutoutPadding * 2,
    height: targetRect.height + cutoutPadding * 2,
  } : null;

  const move = "var(--tour-duration) var(--tour-ease)";
  const cutoutTransition = reduce ? "none" : `top ${move}, left ${move}, width ${move}, height ${move}`;
  const bubbleTransition  = reduce ? "none" : `top ${move}, left ${move}`;

  return (
    <>
      {/* 暗幕（targetRect の周りをくり抜く・無ければ全画面）。明度は --tour-scrim に統一（二重がけしない）。 */}
      {/* 暗幕クリックではツアーを終了しない（誤操作防止）。終了は ✕ / スキップ / Esc のみ。 */}
      {showDim && (showCutout && cutout ? (
        <>
          <DimBox style={{ top: 0,                          left: 0,                          right: 0,  height: cutout.top }} />
          <DimBox style={{ top: cutout.top,                 left: 0,                          width: cutout.left,                height: cutout.height }} />
          <DimBox style={{ top: cutout.top,                 left: cutout.left + cutout.width, right: 0,  height: cutout.height }} />
          <DimBox style={{ top: cutout.top + cutout.height, left: 0,                          right: 0,  bottom: 0 }} />
          {/* ハイライト枠（暗転はさせない。枠線だけで対象を強調する） */}
          <div style={{
            position: "fixed",
            top: cutout.top, left: cutout.left,
            width: cutout.width, height: cutout.height,
            border: "2px solid var(--color-brand)",
            borderRadius: "var(--radius-md)",
            pointerEvents: "none",
            zIndex: 9991,
            transition: cutoutTransition,
          }} />
        </>
      ) : (
        <DimBox style={{ inset: 0 }} />
      ))}

      {/* 進捗のスクリーンリーダー読み上げ（視覚的には隠す） */}
      <div aria-live="polite" style={srOnly}>ステップ {stepIdx + 1} / {totalSteps}</div>

      {/* 吹き出し：外側＝位置とフォーカス、内側＝見た目と出現アニメ（transform 衝突を避けるため分離） */}
      {/* role=dialog + tabIndex のフォーカストラップとして意図的に onKeyDown を持たせている */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-bubble-title"
        aria-describedby="tour-bubble-body"
        tabIndex={-1}
        onKeyDown={handleTrapKeyDown}
        style={{
          position: "fixed",
          zIndex: 10000,
          ...bubblePos,
          maxWidth: "360px", width: "calc(100vw - 24px)",
          transition: bubbleTransition,
          outline: "none",
        }}
      >
        <div
          ref={bubbleRef}
          key={stepIdx}
          className={reduce ? undefined : "tour-bubble-in"}
          style={{
            // 画面より大きい吹き出しは縦スクロール可能に（「次へ」ボタンが隠れない最終防御線）
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
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
              ステップ {stepIdx + 1} / {totalSteps}
            </span>
            <button onClick={onSkip} aria-label="ツアーを閉じる" style={{
              background: "transparent", border: "none", cursor: "pointer",
              color: "var(--color-text-tertiary)", fontSize: "14px", padding: "2px 4px",
            }}>✕</button>
          </div>
          <div id="tour-bubble-title" style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px", color: "var(--color-text-primary)" }}>
            {step.title}
          </div>
          <div id="tour-bubble-body" style={{ whiteSpace: "pre-wrap", color: "var(--color-text-secondary)" }}>
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
      </div>
    </>
  );
}

function DimBox({ style }: { style: React.CSSProperties }) {
  // 暗幕はクリックを吸収するだけ（背後のアプリ誤操作を防ぐ）。ツアー終了はしない。
  // 明度は --tour-scrim に統一（全ステップ共通・一層）。開始時にフェードイン。
  return (
    <div
      className="tour-scrim-in"
      style={{
        position: "fixed",
        background: "var(--tour-scrim)",
        zIndex: 9990,
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
//
// 画面外にはみ出さないよう、上下左右すべての方向でクランプし、
// 「次へ」ボタンが必ず見えるようにする。吹き出しサイズは実測値を優先。

function calcBubblePos(
  target: DOMRect | null,
  placement: TourStep["placement"] | undefined,
  measured: { w: number; h: number } | null,
): React.CSSProperties {
  const margin = 12;
  const pad = 12;
  const bubbleH = measured?.h ?? 240;
  const bubbleW = measured?.w ?? 360;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ターゲット無し or center 指定なら画面中央
  if (!target || placement === "center") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  // ターゲット周辺の空きスペースから自動配置先を決める（auto も含む）
  const spaceTop    = target.top;
  const spaceBottom = vh - target.bottom;
  const spaceLeft   = target.left;
  const spaceRight  = vw - target.right;

  const pick: TourStep["placement"] = placement && placement !== "auto"
    ? placement
    : (() => {
        // bubbleH+margin 以上の空きがある方向を優先（下→上→右→左→中央）
        if (spaceBottom >= bubbleH + margin) return "bottom";
        if (spaceTop    >= bubbleH + margin) return "top";
        if (spaceRight  >= bubbleW + margin) return "right";
        if (spaceLeft   >= bubbleW + margin) return "left";
        return "center";
      })();

  // 配置先で空きが足りない場合はフォールバックで center に
  const needed = (pick === "top" || pick === "bottom") ? bubbleH : bubbleW;
  const actualSpace = pick === "top" ? spaceTop
                    : pick === "bottom" ? spaceBottom
                    : pick === "left" ? spaceLeft
                    : pick === "right" ? spaceRight
                    : Infinity;
  if (pick !== "center" && actualSpace < needed + margin) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  // 各方向で配置（top/left を画面内に収める clamp 必須）
  switch (pick) {
    case "top": {
      const top  = clamp(target.top - margin - bubbleH, pad, vh - bubbleH - pad);
      const left = clamp(target.left + target.width / 2 - bubbleW / 2, pad, vw - bubbleW - pad);
      return { top, left };
    }
    case "bottom": {
      const top  = clamp(target.bottom + margin, pad, vh - bubbleH - pad);
      const left = clamp(target.left + target.width / 2 - bubbleW / 2, pad, vw - bubbleW - pad);
      return { top, left };
    }
    case "left": {
      const left = clamp(target.left - margin - bubbleW, pad, vw - bubbleW - pad);
      const top  = clamp(target.top + target.height / 2 - bubbleH / 2, pad, vh - bubbleH - pad);
      return { top, left };
    }
    case "right": {
      const left = clamp(target.right + margin, pad, vw - bubbleW - pad);
      const top  = clamp(target.top + target.height / 2 - bubbleH / 2, pad, vh - bubbleH - pad);
      return { top, left };
    }
    default:
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
