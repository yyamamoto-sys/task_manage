import { useState } from "react";
import { members } from "../fixtures";
import { buildReminderText, TODAY } from "../logic";
import { useMock } from "../state";
import type { Task } from "../types";
import { Modal } from "../ui";

/** 文面を作ってコピーするところまで。送るのは利用者本人（アプリからは送信しない） */
export function ReminderModal({
  selected,
  checkin,
  onClose,
  onCopied,
}: {
  selected: Task[];
  checkin: string;
  onClose: () => void;
  onCopied: (taskIds: string[]) => void;
}) {
  const { showToast } = useMock();
  const manager = members.find((m) => m.isManager)!;
  const recipients = members.filter((m) => selected.some((t) => t.assigneeId === m.id));
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      recipients.map((m) => [
        m.id,
        buildReminderText({
          toName: m.name.split(" ")[0],
          fromName: manager.name,
          checkin,
          today: TODAY,
          tasks: selected.filter((t) => t.assigneeId === m.id),
        }),
      ]),
    ),
  );
  const copy = async (ids: string[]) => {
    try {
      await navigator.clipboard.writeText(ids.map((id) => texts[id]).join("\n\n----------\n\n"));
      onCopied(selected.filter((t) => ids.includes(t.assigneeId)).map((t) => t.id));
      showToast("文面をコピーしました。メールやチャットに貼って、あなたが送ってください");
    } catch {
      showToast("コピーできませんでした。ブラウザの許可を確認してください");
    }
  };
  return (
    <Modal
      title="催促の文面を作る"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="mk-btn" onClick={onClose}>
            閉じる
          </button>
          <button type="button" className="mk-btn mk-btn-primary" onClick={() => copy(recipients.map((m) => m.id))}>
            全員分をまとめてコピー
          </button>
        </>
      }
    >
      <p className="mk-chip mk-chip-yellow" style={{ display: "block" }}>
        このアプリからは送信されません。文面をコピーして、メールやチャットで送るのはあなたです。
      </p>
      <p className="mk-muted">宛先ごとに文面を自動で作りました。コピーする前に自由に直せます。</p>
      {recipients.map((m) => (
        <div key={m.id} style={{ marginBottom: 12 }}>
          <div className="mk-row">
            <label className="mk-small" htmlFor={`rm-${m.id}`}>
              <strong>宛先：{m.name}</strong>（{selected.filter((t) => t.assigneeId === m.id).length}件）
            </label>
            <span className="mk-spacer" />
            <button type="button" className="mk-btn mk-btn-sm" onClick={() => copy([m.id])}>
              この文面をコピー
            </button>
          </div>
          <textarea id={`rm-${m.id}`} className="mk-textarea" value={texts[m.id]} onChange={(e) => setTexts((p) => ({ ...p, [m.id]: e.target.value }))} />
        </div>
      ))}
    </Modal>
  );
}
