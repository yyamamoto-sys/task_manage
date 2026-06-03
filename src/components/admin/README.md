# モジュール F：管理・設定（admin）

> ⚙設定（全画面オーバーレイ）。アプリの「構造（誰・何・どこ）」を管理する。
> 全体像は [`docs/dev/module-map.md`](../../../docs/dev/module-map.md)「F 管理/設定」。ガイドは `docs/guides/05_admin/`。

## 主なファイル
| ファイル | 役割 |
|---|---|
| `AdminView.tsx` | 7タブ：`tasks / okr / tf / pj / members / tags / ai_usage`。各セクションは同ファイル内のサブコンポーネント |
| `TodoDecomposeModal.tsx` | ToDoをAIでタスク分解（`lib/ai/todoDecomposeClient`） |

## 改修・バグ探しの注意点
- メンバー/Objective/KR/TF/PJ/タグの**登録・編集・論理削除**の入口。物理削除は禁止（`is_deleted`）。
- マイルストーン管理もここ（PJごと）。編集は `components/milestone/MilestoneEditModal`。
- `IconBtn` の onClick は `(e?) => void`（行クリックと削除ボタンの伝播分離に使用）。
- ゲスト（閲覧のみ）では設定ボタン非表示＋オーバーレイ自体を出さない（`MainLayout` 側でガード）。
- 個人情報（氏名・メール）を含むので、外部公開・スクショ時は注意。
