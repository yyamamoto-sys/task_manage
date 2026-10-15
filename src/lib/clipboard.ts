// src/lib/clipboard.ts
//
// クリップボードへの書き込み（2段のフォールバック。v3.157）。navigator.clipboard → 非表示 textarea＋execCommand("copy")。
// どちらも失敗したら false を返す（呼び出し側が、選択済みの textarea を出して手動コピーを促す）。
// ErrorCopyPanel（v3.151）・VersionHistoryModal にも同型の関数があるが、既存の画面は触らず、新しい画面だけがこれを使う。

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
