// モバイル判定の唯一の正本。PC は「画面幅の 1/3 以下」、スマホ・タブレットは従来どおり 768px 以下。
// PC でブラウザを半分に寄せただけ（倍率125%の1920px画面で768px）でスマホ表示になるのを避けるため。
// スマホは screen.width とビューポート幅がほぼ同じで、1/3 ルールを当てると永久にモバイルにならない。
// そのため screen.width ≤ PC_SCREEN_MIN の端末には 1/3 ルールを適用しない。

export const LEGACY_MOBILE_MAX = 768;
export const PC_SCREEN_MIN = 1024;

export function computeIsMobile(screenWidth: number, viewportWidth: number): boolean {
  if (screenWidth > PC_SCREEN_MIN) return viewportWidth <= Math.round(screenWidth / 3);
  return viewportWidth <= LEGACY_MOBILE_MAX;
}

export function currentIsMobile(): boolean {
  return computeIsMobile(window.screen.width, window.innerWidth);
}

const listeners = new Set<(v: boolean) => void>();
let last: boolean | null = null;
let installed = false;

function evaluate(): void {
  const next = currentIsMobile();
  if (next === last) return;
  last = next;
  document.documentElement.toggleAttribute("data-mobile", next);
  listeners.forEach((l) => l(next));
}

/** アプリ起動時（描画前）に1回呼ぶ。<html data-mobile> を同期し、resize で再評価する。 */
export function installViewportSync(): void {
  if (installed) return;
  installed = true;
  evaluate();
  window.addEventListener("resize", evaluate);
}

export function subscribeIsMobile(listener: (v: boolean) => void): () => void {
  installViewportSync();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
