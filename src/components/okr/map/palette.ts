/** KRを色で区別するための色。KRの並びから順に割り当てる。足りなくなったら同じ色に模様（pattern）を重ねて区別する */
export const KR_PALETTE = ["#3b6fd4", "#1a9a6b", "#e0782a", "#8a4fd0", "#b3392f", "#2a8fa8", "#7a6a1e", "#6b7b8c"];

/** KRの並び番号から、色と模様の番号を決める（データから作る。KR数が増えても決め打ちしない） */
export function krStyleAt(index: number): { color: string; pattern: number } {
  return { color: KR_PALETTE[index % KR_PALETTE.length], pattern: Math.floor(index / KR_PALETTE.length) };
}
