// src/lib/layout/devOverlapCheck.ts
//
// 【設計意図・v3.94】
// src/lib/layout/__tests__/bottomStack.test.ts は bottomStack.ts の「定数どうし」の整合性
// しか検査できない。「その定数が実際の描画サイズと一致しているか」（ブラウザの拡大率・
// 最小フォントサイズ設定・OSの表示スケール・フォント差異でズレうる）は、そもそも定数の
// テストでは検査不可能。これがv3.91→v3.94と2回同じ問題をすり抜けた理由（CLAUDE.md
// Section 49参照）。
//
// このモジュールは、右下スタックの実在の要素に付けた `data-bottom-stack` 属性を頼りに、
// 開発ビルドでのみ実際の getBoundingClientRect() を測って重なりを検出する。本番ビルドでは
// import.meta.env.DEV が false になり何もしない（利用者には一切影響しない）。
//
// 【v3.95追加：あふれ（切れ）検出】
// v3.94時点はこのファイルが「重なり」しか検出しなかったが、実際にv3.91〜v3.94ですり抜けて
// いた問題の本体は固定heightそのもの（拡大率・最小フォントサイズ設定で中身が箱に収まらず
// 切れる）だった。重なり検査は「2つの要素が同じ場所にいるか」しか見ないため、この種の
// 「切れ」（要素は1つしかそこに無いが、その中身がはみ出している）は原理的に検出できない。
// v3.95で対象要素をすべて固定heightからminHeightへ変更した（切れそのものを構造的に防ぐ）が、
// 将来誰かがminHeightをheightへ戻してしまう回帰を検知できるよう、scrollHeight>clientHeightで
// 「箱の中身が箱よりはみ出していないか」を独立に検査する関数を追加した。
//
// 【使い方】
// MainLayout（右下スタックの要素を描画する場所）が1度だけ startDevBottomStackOverlapCheck()
// を呼ぶ（マウント時のuseEffect）。戻り値のクリーンアップ関数をuseEffectのreturnに渡すこと。
//
// 【山本さんが気づく方法】
// 開発サーバー（npm run dev）で画面を開き、ブラウザの拡大率やOSの文字サイズ設定を変えながら
// タスク詳細（TaskSidePanel）を開閉する。
// - 実際に重なりが起きるとDevToolsのコンソールに
//   `[bottomStack] 実測で重なりを検出: "fab" × "toast"（約12×8px）` のような警告が出る。
// - 実際に中身が箱からあふれる（切れる）とDevToolsのコンソールに
//   `[bottomStack] コンテンツのあふれを検出: "shortcuts"（約6pxぶん高さが不足）` のような
//   警告が出る。
// どちらも1つの問題につき1回だけ警告し（再度発生した場合は再度出る）、解消されると次のポーリング
// で自動的に警告リストから消える（＝コンソールを埋め尽くさない）。
//
// 【なぜsetIntervalによるポーリングにしたか（ResizeObserver/MutationObserverではなく）】
// 対象要素（TaskSidePanelフッター・FAB・ショートカットボタン・Toast・ボトムナビ）は
// 開閉に応じて動的にマウント/アンマウントされ、かつ複数の別ファイル（TaskSidePanel.tsx・
// QuickAddFab.tsx・MainLayout.tsx・Toast.tsx）にまたがる。要素が現れるたびに
// ResizeObserver.observe()を呼び直す仕組みを組むよりも、開発時のみ動く軽量な定期チェックの
// 方が実装・保守コストに見合うと判断した（本番に影響しないため、CPU負荷は許容範囲）。

interface WatchedPair {
  a: string;
  b: string;
}

/** bottomStack.test.ts の ALLOWED_OVERLAPS と同じ考え方：実害の無い組み合わせだけ許容する。 */
const ALLOWED_OVERLAPS: WatchedPair[] = [
  { a: "toast", b: "shortcuts" },
  { a: "toast", b: "fab-menu" },
];

const WATCHED_NAMES = ["side-panel-footer", "fab", "fab-menu", "shortcuts", "toast", "bottom-nav"] as const;

const POLL_INTERVAL_MS = 500;
/** 1px未満の丸め誤差で誤検知しないための許容値 */
const TOLERANCE_PX = 1;

function isAllowedOverlap(a: string, b: string): boolean {
  return ALLOWED_OVERLAPS.some(p => (p.a === a && p.b === b) || (p.a === b && p.b === a));
}

function rectsOverlap(a: DOMRect, b: DOMRect): { overlaps: boolean; widthPx: number; heightPx: number } {
  const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return { overlaps: overlapWidth > TOLERANCE_PX && overlapHeight > TOLERANCE_PX, widthPx: overlapWidth, heightPx: overlapHeight };
}

/** 前回のポーリングで既に警告済みのキー（重なり・あふれ共通）。解消されたら削除し、
 *  再発したら改めて警告する（同じ問題を毎ポーリングごとに連呼しないため）。 */
const alreadyWarned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (alreadyWarned.has(key)) return;
  alreadyWarned.add(key);
  console.warn(message);
}

function checkOverlapsOnce(): void {
  const rects = new Map<string, DOMRect>();
  for (const name of WATCHED_NAMES) {
    const el = document.querySelector(`[data-bottom-stack="${name}"]`);
    if (el) rects.set(name, el.getBoundingClientRect());
  }
  const entries = [...rects.entries()];
  const currentKeys = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [nameA, rectA] = entries[i];
      const [nameB, rectB] = entries[j];
      if (isAllowedOverlap(nameA, nameB)) continue;
      const { overlaps, widthPx, heightPx } = rectsOverlap(rectA, rectB);
      if (overlaps) {
        const key = `overlap:${nameA}x${nameB}`;
        currentKeys.add(key);
        warnOnce(
          key,
          `[bottomStack] 実測で重なりを検出: "${nameA}" × "${nameB}"（約${Math.round(widthPx)}×${Math.round(heightPx)}px）。` +
          `拡大率・フォント設定を変えて再現するようなら CLAUDE.md Section 49 を確認してください。`
        );
      }
    }
  }
  for (const key of [...alreadyWarned]) {
    if (key.startsWith("overlap:") && !currentKeys.has(key)) alreadyWarned.delete(key);
  }
}

/**
 * 【v3.95新設】要素の中身が箱からあふれていないか（scrollHeight > clientHeight）を検査する。
 * 固定heightの箱に、拡大率・最小フォントサイズ設定で大きくなった文字が収まらず「切れる」
 * 形の不具合は、重なり検査では原理的に検出できない（要素は1つしかそこに無いため）。
 * v3.95でWATCHED_NAMESの要素はすべて固定heightからminHeightへ変えて構造的に防いだが、
 * 将来の回帰（誰かがminHeightをheightへ戻す等）をここで検知する。
 */
function checkOverflowOnce(): void {
  const currentKeys = new Set<string>();
  for (const name of WATCHED_NAMES) {
    const el = document.querySelector(`[data-bottom-stack="${name}"]`);
    if (!el) continue;
    const overflowPx = el.scrollHeight - el.clientHeight;
    if (overflowPx > TOLERANCE_PX) {
      const key = `overflow:${name}`;
      currentKeys.add(key);
      warnOnce(
        key,
        `[bottomStack] コンテンツのあふれを検出: "${name}"（約${Math.round(overflowPx)}pxぶん高さが不足）。` +
        `固定heightがminHeightに戻っていないか、確保する最低高さが足りているかを確認してください（CLAUDE.md Section 49参照）。`
      );
    }
  }
  for (const key of [...alreadyWarned]) {
    if (key.startsWith("overflow:") && !currentKeys.has(key)) alreadyWarned.delete(key);
  }
}

/**
 * 開発ビルドでのみ、右下スタックの実測重なり検査・あふれ検査を開始する。戻り値は停止関数
 * （useEffectのクリーンアップから呼ぶこと）。本番ビルドでは何もせず、no-opの停止関数を返す。
 */
export function startDevBottomStackOverlapCheck(): () => void {
  if (!import.meta.env.DEV) return () => {};
  const timer = window.setInterval(() => {
    checkOverlapsOnce();
    checkOverflowOnce();
  }, POLL_INTERVAL_MS);
  return () => { window.clearInterval(timer); alreadyWarned.clear(); };
}
