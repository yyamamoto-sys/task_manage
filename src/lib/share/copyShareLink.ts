// src/lib/share/copyShareLink.ts
//
// 共有リンクをクリップボードへコピーしてトーストで知らせる（v3.192）。コピー手段は src/lib/clipboard.ts。
import { copyTextToClipboard } from "../clipboard";
import { showToast } from "../../components/common/Toast";

export async function copyShareLink(url: string, t: (key: string) => string): Promise<void> {
  const ok = await copyTextToClipboard(url);
  showToast(ok ? t("layout.shareLink.copied") : t("layout.shareLink.copyFailed"), ok ? "success" : "error");
}
