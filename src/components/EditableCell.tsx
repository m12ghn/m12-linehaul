/* Ô sửa tại chỗ dùng chung cho Lịch Tải (Loại Hình / Đến / Rời / Tải trọng / NCC / BKS).
   Chỉ hiện được sửa khi `editable` (đã kiểm tra roleId==="admin" ở nơi gọi) — server vẫn tự
   chặn lại 1 lần nữa (xem functions/api/lichtai-edit.ts), đây chỉ là phía hiển thị. */
import { useEffect, useId, useRef, useState } from "react";
import { TimeInput, normTime } from "./TimeInput";
import { editErrorText, isOverwritable, type SaveResult } from "../lib/lichTaiEdit";

export type CellKind = "time" | "select" | "text";

export function EditableCell({
  value,
  editable,
  kind,
  options,
  emptyLabel = "—",
  onSave,
  className,
}: {
  value: string;
  editable: boolean;
  kind: CellKind;
  options?: string[];
  emptyLabel?: string;
  onSave: (newValue: string, force?: boolean) => Promise<SaveResult>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ msg: string; overwrite: boolean } | null>(null);
  const listId = useId();
  const firstRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) firstRef.current?.focus(); }, [editing]);

  if (!editable) return <span className={className}>{value || emptyLabel}</span>;

  function finalValueOf(): string {
    return kind === "time" ? normTime(draft) : draft.trim();
  }
  function cancel() {
    setDraft(value);
    setEditing(false);
    setErr(null);
  }
  async function commit(force = false) {
    const fv = finalValueOf();
    if (fv === value.trim() && !force) { setEditing(false); setErr(null); return; }
    setBusy(true);
    const r = await onSave(fv, force);
    setBusy(false);
    if (r.ok) { setEditing(false); setErr(null); return; }
    setErr({ msg: editErrorText(r.error, r), overwrite: isOverwritable(r.error) });
  }

  if (!editing) {
    return (
      <span
        className={(className ? className + " " : "") + "rc-edit"}
        title="Bấm để sửa"
        onClick={(e) => { e.stopPropagation(); setEditing(true); setErr(null); }}
      >
        {value || emptyLabel}
      </span>
    );
  }

  return (
    <span
      className={(className ? className + " " : "") + "rc-edit-in" + (busy ? " rc-edit-busy" : "")}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => commit()}
    >
      {kind === "select" ? (
        <select
          ref={firstRef as any}
          className="rc-edit-input"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
        >
          {(options || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : kind === "time" ? (
        <TimeInput value={draft} onChange={setDraft} className="rc-edit-input" />
      ) : (
        <>
          <input
            ref={firstRef as any}
            className="rc-edit-input"
            value={draft}
            list={listId}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
          />
          {options && options.length > 0 && (
            <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
          )}
        </>
      )}
      {err && (
        <span className="rc-edit-err">
          {err.msg}{" "}
          {err.overwrite && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => commit(true)}>Ghi đè</button>
          )}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>Huỷ</button>
        </span>
      )}
    </span>
  );
}
