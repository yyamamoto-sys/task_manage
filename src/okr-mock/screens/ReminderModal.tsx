import { useState } from "react";
import { members } from "../fixtures";
import { buildReminderText, TODAY } from "../logic";
import type { Task } from "../types";
import { Modal } from "../ui";

export function ReminderModal({
  selected,
  checkin,
  onClose,
  onSend,
}: {
  selected: Task[];
  checkin: string;
  onClose: () => void;
  onSend: () => void;
}) {
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
  return (
    <Modal
      title="催促を送る"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="mk-btn" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="mk-btn mk-btn-primary" onClick={onSend}>
            {recipients.length}人に送る
          </button>
        </>
      }
    >
      <p className="mk-muted">宛先ごとに文面を自動で作りました。送る前に自由に直せます（モックなので実際には送られません）。</p>
      {recipients.map((m) => (
        <div key={m.id} style={{ marginBottom: 12 }}>
          <label className="mk-small" htmlFor={`rm-${m.id}`}>
            <strong>送信先：{m.name}</strong>（{selected.filter((t) => t.assigneeId === m.id).length}件）
          </label>
          <textarea id={`rm-${m.id}`} className="mk-textarea" value={texts[m.id]} onChange={(e) => setTexts((p) => ({ ...p, [m.id]: e.target.value }))} />
        </div>
      ))}
    </Modal>
  );
}
