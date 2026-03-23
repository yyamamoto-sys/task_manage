// src/components/consultation/SimulationBanner.tsx
//
// 【設計意図】
// シミュレーションモード（is_simulation=true）時の青い警告バナー。
// 「このデータはDBに反映されない仮想シナリオです」を明示する。

export function SimulationBanner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px",
        background: "var(--color-bg-info)",
        border: "1px solid var(--color-border-info)",
        borderRadius: "var(--radius-md)",
        fontSize: "11px",
        color: "var(--color-text-info)",
      }}
    >
      <span>🔵</span>
      <span>シミュレーション — この提案はDBに反映されません</span>
    </div>
  );
}
