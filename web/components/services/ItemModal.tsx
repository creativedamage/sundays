"use client";
/**
 * Add or change an item in the order of service: headers, items, media, and songs from the Planning Center song
 * catalog (arrangement + key), with notes in any Planning Center note category. Saves to Planning
 * Center.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Film, Heading, Music2, Search, Type } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { NoteCategory, PlanItem, SongHit } from "@shared/types";
import { Api } from "@/lib/api";
import { mmssAny, parseMinutes } from "@/lib/itemTime";
import { Modal, Spinner } from "@/components/ui";

type Kind = PlanItem["kind"];
const KINDS: { kind: Kind; label: string; icon: typeof Type }[] = [
  { kind: "song", label: "Song", icon: Music2 }, { kind: "item", label: "Item", icon: Type },
  { kind: "header", label: "Header", icon: Heading }, { kind: "media", label: "Media", icon: Film },
];

export function ItemModal({ st, planId, items, item, afterItemId, categories, onClose, onDone }: {
  st: string; planId: string; items: PlanItem[];
  /** Editing this item; otherwise adding a new one after `afterItemId` (null = at the top). */
  item?: PlanItem; afterItemId?: string | null;
  categories: NoteCategory[];
  onClose: () => void;
  onDone: (items: PlanItem[]) => void;
}) {
  const editing = Boolean(item);
  const [kind, setKind] = useState<Kind>(item?.kind ?? "item");
  const [title, setTitle] = useState(item?.title ?? "");
  const [length, setLength] = useState(item?.lengthSec ? mmssAny(item.lengthSec) : "");
  const [desc, setDesc] = useState(item?.description ?? "");
  const [position, setPosition] = useState<PlanItem["servicePosition"]>(item?.servicePosition ?? "during");
  const [song, setSong] = useState<SongHit | null>(null);
  const [q, setQ] = useState("");
  const songId = song?.id ?? item?.songId ?? null;
  const [arrId, setArrId] = useState<string | null>(item?.arrangementId ?? null);
  const [keyId, setKeyId] = useState<string | null>(item?.keyId ?? null);
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, item?.notes.find((n) => n.categoryId === c.id || n.category === c.name)?.body ?? ""])));
  const [busy, setBusy] = useState(false);

  const songs = useQuery({ queryKey: ["songs", q], queryFn: () => Api.songs(q), enabled: kind === "song" && !editing, staleTime: 60_000 });
  const arrs = useQuery({ queryKey: ["arrangements", songId], queryFn: () => Api.arrangements(songId!), enabled: Boolean(songId), staleTime: 300_000 });
  const arr = arrs.data?.find((a) => a.id === arrId) ?? arrs.data?.[0];
  const noteRows = useMemo(() => categories.filter((c) => c.name), [categories]);

  async function submit() {
    const len = parseMinutes(length);
    if (len === null) return toast.error("Length should look like 4:30");
    if (kind === "song" && !editing && !song) return toast.error("Pick a song from the catalog");
    if (kind !== "song" && !title.trim()) return toast.error("Give it a title");
    setBusy(true);
    try {
      const base = {
        title: title.trim() || undefined,
        ...(kind !== "header" ? { lengthSec: len || (kind === "song" ? arr?.lengthSec : 0) || 0, description: desc.trim() || null, servicePosition: position } : {}),
      };
      let latest: PlanItem[];
      let id: string;
      if (editing) {
        latest = await Api.editItem(st, planId, item!.id, { ...base, ...(item!.songId ? { arrangementId: arr?.id ?? null, keyId } : {}) });
        id = item!.id;
      } else {
        const before = new Set(items.map((i) => i.id));
        latest = await Api.addItem(st, planId, {
          kind, ...base, afterItemId: afterItemId ?? null,
          ...(kind === "song" ? { songId: song!.id, arrangementId: arr?.id ?? null, keyId: keyId ?? null, title: title.trim() || undefined } : {}),
        });
        id = latest.find((i) => !before.has(i.id))?.id ?? "";
      }
      // Notes, one category at a time (Planning Center keeps a note per category).
      if (id && kind !== "header") {
        const current = latest.find((i) => i.id === id);
        for (const c of noteRows) {
          const text = (notes[c.id] ?? "").trim();
          const existing = current?.notes.find((n) => n.categoryId === c.id || n.category === c.name);
          if (existing?.id && !text) latest = await Api.deleteNote(st, planId, id, existing.id);
          else if (existing?.id && text !== existing.body.trim()) latest = await Api.saveNote(st, planId, id, { noteId: existing.id, categoryId: c.id, content: text });
          else if (!existing && text) latest = await Api.saveNote(st, planId, id, { categoryId: c.id, content: text });
        }
      }
      toast.success(editing ? "Saved to Planning Center" : "Added to Planning Center");
      onDone(latest);
    } catch (e) {
      toast.error("Planning Center didn’t accept that", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} width={720} title={editing ? `Edit · ${item!.title}` : "Add to the order of service"}>
      <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
        {!editing && (
          <div className="flex gap-1.5">
            {KINDS.map(({ kind: k, label, icon: Icon }) => (
              <button key={k} onClick={() => setKind(k)}
                className={clsx("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm", kind === k ? "border-accent/60 bg-accent-soft text-accent" : "border-line text-ink-muted hover:text-ink-soft")}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        )}

        {kind === "song" && !editing && (
          <div>
            <span className="label">Song (Planning Center catalog)</span>
            {song ? (
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <Music2 size={14} className="text-violet" />
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{song.title}</div>{song.author && <div className="text-[11px] text-ink-muted">{song.author}</div>}</div>
                <button className="btn-ghost py-1 text-xs" onClick={() => { setSong(null); setArrId(null); setKeyId(null); }}>Change</button>
              </div>
            ) : (
              <>
                <div className="relative mt-1">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input className="input pl-8" autoFocus placeholder="Search your songs" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <ul className="mt-2 max-h-56 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line">
                  {songs.isLoading && <li className="px-3 py-2 text-xs text-ink-muted"><Spinner size={11} /> Searching…</li>}
                  {songs.data?.length === 0 && <li className="px-3 py-2 text-xs text-ink-muted">No songs match.</li>}
                  {songs.data?.map((s) => (
                    <li key={s.id}>
                      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover/60" onClick={() => { setSong(s); setArrId(null); setKeyId(null); }}>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{s.title}</span><span className="block truncate text-[11px] text-ink-muted">{s.author ?? ""}</span></span>
                        {s.lastScheduledAt && <span className="text-[10px] text-ink-faint">last used {new Date(s.lastScheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {(kind === "song" && songId) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Arrangement</span>
              <select className="input mt-1" value={arr?.id ?? ""} disabled={!arrs.data} onChange={(e) => { setArrId(e.target.value); setKeyId(null); }}>
                {arrs.data?.map((a) => <option key={a.id} value={a.id}>{a.name}{a.lengthSec ? ` · ${mmssAny(a.lengthSec)}` : ""}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Key</span>
              <select className="input mt-1" value={keyId ?? ""} disabled={!arr} onChange={(e) => setKeyId(e.target.value || null)}>
                <option value="">{arr?.keys.length ? "Choose a key" : "No keys on this arrangement"}</option>
                {arr?.keys.map((k) => <option key={k.id} value={k.id}>{k.name}{k.startingKey && k.startingKey !== k.name ? ` (${k.startingKey})` : ""}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_110px_140px]">
          <label className="block"><span className="label">{kind === "song" ? "Title (optional)" : "Title"}</span>
            <input className="input mt-1" value={title} placeholder={kind === "song" ? song?.title ?? item?.title ?? "" : kind === "header" ? "Worship" : "Welcome"} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {kind !== "header" && <>
            <label className="block"><span className="label">Length</span>
              <input className="input mt-1 font-mono" value={length} placeholder={arr?.lengthSec ? mmssAny(arr.lengthSec) : "4:30"} onChange={(e) => setLength(e.target.value)} />
            </label>
            <label className="block"><span className="label">When</span>
              <select className="input mt-1" value={position} onChange={(e) => setPosition(e.target.value as PlanItem["servicePosition"])}>
                <option value="pre">Before service</option><option value="during">During service</option><option value="post">After service</option>
              </select>
            </label>
          </>}
        </div>

        {kind !== "header" && (
          <label className="block"><span className="label">Description</span>
            <textarea className="input mt-1 h-20 resize-y text-sm" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
        )}

        {kind !== "header" && noteRows.length > 0 && (
          <div>
            <span className="label">Notes</span>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {noteRows.map((c) => (
                <label key={c.id} className="block">
                  <span className="text-[11px] font-medium text-ink-muted">{c.name}</span>
                  <textarea className="input mt-0.5 h-16 resize-y text-[13px]" value={notes[c.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))} />
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="text-[11px] text-ink-faint">Saves straight to Planning Center.</span>
        <button className="btn-ghost ml-auto" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={() => void submit()}>{busy && <Spinner />} {editing ? "Save" : "Add"}</button>
      </footer>
    </Modal>
  );
}
