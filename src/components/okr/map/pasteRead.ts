// 貼り付けた文章を「ファイル選択と同じ経路」で読ませるための純粋部分（v3.222）。
// 読み取りの経路は新設しない：貼った本文から File を作り、DocDrawer の readFiles（aiClient の読み込み・checkReadable・抽出・保存）へ渡す。
export const COPILOT_SUMMARY_MARK = "■KR";

const pad = (n: number) => String(n).padStart(2, "0");

/** 資料名。Copilot 用プロンプトの出力の形（「■KR」見出しを含む）なら「Copilot要約」、そうでなければ「貼り付け」 */
export function pastedFileName(text: string, now: Date): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${text.includes(COPILOT_SUMMARY_MARK) ? "Copilot要約" : "貼り付け"}_${stamp}.txt`;
}

/** 空白だけのときは読ませられない */
export const canReadPasted = (text: string): boolean => text.trim() !== "";

export type ReadFilesFn = (files: File[]) => Promise<{ errors: string[]; notices: string[] }>;

/** 貼った本文を File にして readFiles へ渡す。成功（エラーなし）のときだけ true＝欄を空にしてよい */
export async function readPastedText(text: string, now: Date, readFiles: ReadFilesFn): Promise<boolean> {
  if (!canReadPasted(text)) return false;
  const file = new File([text], pastedFileName(text, now), { type: "text/plain" });
  const { errors } = await readFiles([file]);
  return errors.length === 0;
}
