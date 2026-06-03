# モジュール C：会議読み込み（meeting）

> 議事メモ/文字起こしから ToDo・タスクを抽出して登録する（AIツールの「🎙️会議」モード）。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「C 会議読み込み」。ガイドは `docs/guides/02_modes/meeting-import.md`。

## 主なファイル
| ファイル | 役割 |
|---|---|
| `MeetingImportPanel.tsx` | 貼り付け/ファイル添付（VTT/Word/PDF/画像）→ AI抽出 → 候補レビュー → 登録 |
| `src/lib/ai/meetingExtractor.ts` | 抽出ロジック（AI基盤 `invokeAI` 経由） |
| `src/lib/docxText.ts` | Word本文のテキスト抽出 |

## 改修・バグ探しの注意点
- OKRの②セッションとは別物（こちらは普段の会議→タスク化）。役割を混同しない。
- 登録は **`appStore.saveTask`** 経由（`todo_ids`→`todo_id` 変換を通る）＝直接 insert ではない。
- 入力上限あり（長文はファイル添付か要約）。
