"use client";
/**
 * The order of service, from Planning Center, with a clock column counted from the first service
 * time. Press Edit and it changes like it does in Planning Center: item names, headers, lengths and
 * descriptions right in place (each saves when you leave the field), notes, songs, arrangements and
 * keys in the item window (the pencil), add anything anywhere, move items up and down, delete.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Film, Music2, Pencil, Plus, Trash2, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PlanDetail, PlanItem } from "@shared/types";
import { Api, qk } from "@/lib/api";
import { clock, mmss } from "@/lib/format";
import { parseMinutes } from "@/lib/itemTime";
import { Expandable } from "@/components/Expandable";
import { ItemModal } from "./ItemModal";

export function ServiceOrder({ plan, editing, onEdit }: { plan: PlanDetail; editing: boolean; onEdit: (on: boolean) => void }) {
  const qc = useQueryClient();
  const key = qk.plan(plan.serviceTypeId, plan.id);
  const st = plan.serviceTypeId;
  const [saving, setSaving] = useState(0);
  // Editing moves the order of service to the full width of the page: bring it into view.
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (editing) box.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [editing]);
  const [modal, setModal] = useState<{ item?: PlanItem; after?: string | null } | null>(null);
  const cats = useQuery({ queryKey: qk.noteCategories(st), queryFn: () => Api.noteCategories(st), staleTime: 10 * 60_000, retry: false, enabled: editing || Boolean(modal) });

  const items = plan.items;
  const firstService = plan.times.find((t) => t.kind === "service");
  const during = items.filter((i) => i.servicePosition === "during");
  const runtime = during.reduce((n, i) => n + i.lengthSec, 0);
  const pre = items.filter((i) => i.servicePosition === "pre").reduce((n, i) => n + i.lengthSec, 0);
  const start = firstService ? Date.parse(firstService.startsAt) - pre * 1000 : null;

  /** Planning Center sends back the new order after every change. */
  const apply = (next: PlanItem[]) => {
    qc.setQueryData<PlanDetail>(key, (p) => p && { ...p, items: next });
    void qc.invalidateQueries({ queryKey: key });
  };
  const save = async (label: string, fn: () => Promise<PlanItem[]>) => {
    setSaving((n) => n + 1);
    try { apply(await fn()); return true; }
    catch (e) { toast.error(`Couldn’t save the ${label}`, { description: (e as Error).message }); return false; }
    finally { setSaving((n) => n - 1); }
  };
  const saveItem = (item: PlanItem, input: { title?: string; lengthSec?: number; description?: string | null }, label: string) =>
    save(label, () => Api.editItem(st, plan.id, item.id, input));
  const move = (idx: number, d: -1 | 1) => {
    const ids = items.map((i) => i.id);
    const j = idx + d;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    const byId = new Map(items.map((i) => [i.id, i]));
    qc.setQueryData<PlanDetail>(key, (p) => p && { ...p, items: ids.map((id) => byId.get(id)!) }); // moves right away
    void save("order", () => Api.reorderItems(st, plan.id, ids));
  };
  const remove = (item: PlanItem) => {
    if (!confirm(`Delete “${item.title}” from the service in Planning Center?`)) return;
    void save("change", () => Api.deleteItem(st, plan.id, item.id));
  };

  let offset = 0;
  return (
    <section ref={box} className={clsx("panel self-start scroll-mt-4 overflow-hidden", editing && "ring-1 ring-accent/40")}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Order of service</div>
          <div className="text-[11px] text-ink-muted">
            {editing ? (saving ? "Saving to Planning Center…" : "Click any name, length or description to change it · saves when you leave the field")
              : `${items.length} items · service runs ${mmss(runtime)}${firstService ? ` · clock for ${firstService.name || clock(firstService.startsAt)}` : ""}`}
          </div>
        </div>
        <button className={clsx("shrink-0 py-1 text-xs", editing ? "btn-primary" : "btn-outline")} onClick={() => onEdit(!editing)}>
          {editing ? "Done" : <><Pencil size={13} /> Edit</>}
        </button>
      </header>
      <ol>
        {editing && <li><AddRow label="Add at the top" onAdd={() => setModal({ after: null })} /></li>}
        {items.map((item, idx) => {
          const at = start !== null ? new Date(start + offset * 1000).toISOString() : null;
          offset += item.lengthSec;
          const tools = editing && (
            <div className="flex shrink-0 items-start gap-0.5 pt-0.5">
              <button className="btn-ghost p-1" title="Move up" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp size={12} /></button>
              <button className="btn-ghost p-1" title="Move down" disabled={idx === items.length - 1} onClick={() => move(idx, 1)}><ArrowDown size={12} /></button>
              <button className="btn-ghost p-1" title={item.kind === "song" ? "Arrangement, key, notes and more" : "Notes and more"} onClick={() => setModal({ item })}><Pencil size={12} /></button>
              <button className="btn-ghost p-1 hover:text-bad" title="Delete" onClick={() => remove(item)}><Trash2 size={12} /></button>
            </div>
          );
          const add = editing && <AddRow onAdd={() => setModal({ after: item.id })} />;
          if (item.kind === "header") {
            return (
              <li key={item.id}>
                <div className="flex items-center gap-2 bg-canvas/60 px-4 py-1.5">
                  {editing
                    ? <Inline value={item.title} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted" onSave={(v) => v.trim() ? saveItem(item, { title: v.trim() }, "header") : Promise.resolve(false)} />
                    : <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{item.title}</span>}
                  {tools}
                </div>
                {add}
              </li>
            );
          }
          const Icon = item.kind === "song" ? Music2 : item.kind === "media" ? Film : Type;
          return (
            <li key={item.id}>
              <div className={clsx("flex gap-3 border-t border-line/60 px-4 py-2.5", item.servicePosition !== "during" && !editing && "opacity-60")}>
                <div className="w-14 shrink-0 pt-0.5 text-right font-mono text-[11px] text-ink-muted">{at ? clock(at) : ""}</div>
                <Icon size={14} className={clsx("mt-0.5 shrink-0", item.kind === "song" ? "text-violet" : "text-ink-faint")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    {editing
                      ? <Inline wrap value={item.title} className="text-sm font-medium" onSave={(v) => v.trim() ? saveItem(item, { title: v.trim() }, "name") : Promise.resolve(false)} />
                      : <span className="min-w-0 break-words text-sm font-medium">{item.title}</span>}
                    {item.songKey && <span className="mt-0.5 shrink-0 rounded bg-violet-soft px-1.5 font-mono text-[10px] text-violet">{item.songKey}</span>}
                  </div>
                  {editing ? (
                    <Inline multiline value={item.description ?? ""} placeholder="Add a description" className="mt-0.5 text-xs leading-relaxed text-ink-muted"
                      onSave={(v) => saveItem(item, { description: v.trim() || null }, "description")} />
                  ) : item.description && (
                    <Expandable lines={2} className="mt-0.5 text-xs leading-relaxed">
                      <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted">{item.description}</div>
                    </Expandable>
                  )}
                  {item.notes.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {item.notes.map((n, i) => (
                        <Expandable key={i} lines={2} className="rounded-md border border-line px-2 py-1 text-[11px] leading-relaxed">
                          <div className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-soft"><span className="font-medium text-ink-muted">{n.category}:</span> {n.body}</div>
                        </Expandable>
                      ))}
                    </div>
                  )}
                  {editing && item.servicePosition !== "during" && <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-faint">{item.servicePosition === "pre" ? "Before the service" : "After the service"}</div>}
                </div>
                <div className="w-12 shrink-0 pt-0.5 text-right font-mono text-[11px] tabular-nums text-ink-muted">
                  {editing ? (
                    <Inline value={item.lengthSec ? mmss(item.lengthSec) : ""} placeholder="0:00" className="text-right font-mono text-[11px]" onSave={(v) => {
                      const sec = parseMinutes(v);
                      if (sec == null) { toast.error("Lengths look like 4:30, or just minutes (5)"); return Promise.resolve(false); }
                      return sec === item.lengthSec ? Promise.resolve(true) : saveItem(item, { lengthSec: sec }, "length");
                    }} />
                  ) : item.lengthSec ? mmss(item.lengthSec) : ""}
                </div>
                {tools}
              </div>
              {add}
            </li>
          );
        })}
        {!items.length && !editing && <li className="px-4 py-8 text-center text-sm text-ink-faint">Nothing in the order of service yet. Press Edit to add items.</li>}
      </ol>
      {modal && (
        <ItemModal st={st} planId={plan.id} items={items} item={modal.item} afterItemId={modal.after}
          categories={cats.data ?? []} onClose={() => setModal(null)} onDone={(next) => { apply(next); setModal(null); }} />
      )}
    </section>
  );
}

/**
 * A field you click into and type. Saves when you leave it (or press Enter on a one-line field);
 * Esc puts it back. Keeps what you typed if Planning Center refuses it.
 */
function Inline({ value, onSave, multiline, wrap, placeholder, className }: {
  value: string; onSave: (v: string) => Promise<boolean>; multiline?: boolean; /** one line that wraps (Enter saves) */ wrap?: boolean; placeholder?: string; className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { if (!focused && !busy) setDraft(value); }, [value, focused, busy]);
  useEffect(() => {
    const el = ref.current;
    if ((multiline || wrap) && el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [draft, multiline, wrap]);
  const commit = async () => {
    setFocused(false);
    if (draft === value) return;
    setBusy(true);
    const ok = await onSave(draft);
    setBusy(false);
    if (!ok) ref.current?.focus();
  };
  const common = {
    ref, value: draft, placeholder,
    onFocus: () => setFocused(true), onBlur: () => void commit(),
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(wrap ? e.target.value.replace(/\n/g, " ") : e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { setDraft(value); setTimeout(() => ref.current?.blur()); }
      else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); ref.current?.blur(); }
    },
    className: clsx("-mx-1 w-full flex-1 resize-none rounded border border-transparent bg-transparent px-1 outline-none transition placeholder:text-ink-faint/60 hover:border-line focus:border-accent/60 focus:bg-surface",
      busy && "opacity-60", className),
  };
  return multiline || wrap ? <textarea rows={1} {...common} /> : <input {...common} />;
}

function AddRow({ onAdd, label }: { onAdd: () => void; label?: string }) {
  return (
    <button onClick={onAdd} className="group flex w-full items-center gap-2 px-4 py-0.5 text-[11px] text-ink-faint hover:text-accent">
      <span className="h-px flex-1 bg-line group-hover:bg-accent/50" />
      <span className="flex items-center gap-1"><Plus size={11} /> {label ?? "Add here"}</span>
      <span className="h-px flex-1 bg-line group-hover:bg-accent/50" />
    </button>
  );
}
