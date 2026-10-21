import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { togglePinned, useApp } from "../data/store";
import { forChildren, needsYou, priority, type FeedItem } from "../data/feed";
import { dateOf, daysBetween, today } from "../data/dates";
import { Icon, ItemRow } from "./bits";
import { go, hrefFor, setSegment, tSense, useChildFilter, useSegment, type Segment } from "./shared";
import { toggleDoneWithUndo } from "./done";
import { Reader } from "./Reader";
import { NewMessage } from "./NewMessage";
import { t, tx } from "../i18n";
import { intelligenceOn } from "../data/model";


const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you" },
  { id: "message", label: "Messages" },
  { id: "news", label: "Bulletins" },
  { id: "done", label: "Done" },
];

/** "Done" is also a button (Finnish "Hoidettu"); as this list it's plural in Finnish ("Hoidetut"). */
const segmentLabel = (s: { id: Segment; label: string }) => (s.id === "done" ? tSense("Done", "list") : t(s.label));

function matches(item: FeedItem, query: string): boolean {
  if (!query) return true;
  const hay = `${item.title} ${item.from ?? ""} ${item.text ?? item.preview} ${item.note?.subjects.join(" ") ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/* The list's width: dragged on the handle between list and reader, remembered here. */
const LIST_WIDTH_KEY = "wilmai.listWidth";
const LIST_WIDTH_DEFAULT = 400;
const LIST_MIN = 280;
const READER_MIN = 380;

function savedListWidth(): number {
  try {
    return Number(localStorage.getItem(LIST_WIDTH_KEY)) || LIST_WIDTH_DEFAULT;
  } catch {
    return LIST_WIDTH_DEFAULT;
  }
}

function useListWidth() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(savedListWidth);
  const clamp = (w: number) => {
    const total = box.current?.getBoundingClientRect().width ?? 1200;
    return Math.round(Math.max(LIST_MIN, Math.min(w, total - READER_MIN)));
  };
  const keep = (w: number) => {
    setWidth(w);
    try {
      localStorage.setItem(LIST_WIDTH_KEY, String(w));
    } catch {
      // the width just isn't remembered
    }
  };
  const handle = {
    role: "separator",
    "aria-orientation": "vertical" as const,
    "aria-label": t("Resize the list"),
    "aria-valuenow": width,
    tabIndex: 0,
    title: t("Drag to resize · double-click to reset"),
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const left = box.current?.getBoundingClientRect().left ?? 0;
      let next = width;
      const move = (ev: PointerEvent) => {
        next = clamp(ev.clientX - left);
        box.current?.style.setProperty("--list-w", `${next}px`);
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        target.removeEventListener("pointercancel", up);
        keep(next);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
      target.addEventListener("pointercancel", up);
    },
    onDoubleClick: () => keep(LIST_WIDTH_DEFAULT),
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        keep(clamp(width + (e.key === "ArrowLeft" ? -24 : 24)));
      }
    },
  };
  return { box, style: { "--list-w": `${width}px` } as CSSProperties, handle };
}

/** A part of a "new:<child>:<teacher>:<subject>" key (teacher and subject come encoded). */
function decodePart(part: string | undefined): string | null {
  if (!part) return null;
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The group's English name (shown with groupLabel). */
function groupOf(item: FeedItem): string {
  const days = daysBetween(dateOf(item.at), today());
  if (item.pinnedAt) return "Pinned";
  // The school's permanent bulletins (Wilma's "pysyvät"), where they fall by date.
  if (item.pinned) return "Permanent";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return "Earlier";
}

/** "This week" is also the Week view's button (Finnish "Tämä viikko"); as a heading it's "Tällä viikolla". */
const groupLabel = (group: string) => (group === "This week" || group === "Pinned" ? tSense(group, "heading") : t(group));

export function Inbox({ feed, query, itemKey }: { feed: FeedItem[]; query: string; itemKey: string | null }) {
  const snap = useApp((s) => s.snapshot)!;
  const jevOn = useApp((s) => intelligenceOn(s.settings));
  const { selected } = useChildFilter();
  const segment = useSegment();
  const pick = (s: Segment) => setSegment(s);

  // Messages and bulletins: teacher notes are in Notes.
  const scoped = useMemo(() => forChildren(feed, selected).filter((i) => i.kind !== "note" && matches(i, query)), [feed, selected, query]);
  const counts = useMemo(
    () => ({
      all: scoped.filter((i) => !i.done).length,
      needs: needsYou(scoped).length,
      message: scoped.filter((i) => i.kind === "message" && !i.done).length,
      news: scoped.filter((i) => i.kind === "news" && !i.done).length,
      done: scoped.filter((i) => i.done).length,
    }),
    [scoped]
  );
  const list = useMemo(() => {
    // What's pinned comes first, the newest pin on top, also when it's marked done: it's kept to be found again.
    const pins = (kind: FeedItem["kind"] | null) =>
      scoped.filter((i) => i.pinnedAt && (!kind || i.kind === kind)).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
    switch (segment) {
      case "needs":
        return needsYou(scoped);
      case "done":
        return scoped.filter((i) => i.done);
      case "all":
        return [...pins(null), ...scoped.filter((i) => !i.done && !i.pinnedAt)];
      default:
        return [...pins(segment), ...scoped.filter((i) => i.kind === segment && !i.done && !i.pinnedAt)];
    }
  }, [scoped, segment]);

  const ordered = segment === "needs" ? [...list].sort((a, b) => priority(b) - priority(a)) : list;
  const split = useListWidth();
  // "new" or "new:<child>": writing a new message instead of reading.
  const composing = itemKey === "new" || Boolean(itemKey?.startsWith("new:"));
  const current = itemKey && !composing ? feed.find((i) => i.key === itemKey) ?? null : null;

  /**
   * Done (or back to open) from the reader, like archiving in a mail app: the
   * item leaves this list, so move to the next one (or the previous, or back
   * to the list) in the same step, and leave a note with Undo.
   */
  const doneAndNext = (item: FeedItem) => {
    const index = ordered.findIndex((i) => i.key === item.key);
    if (index >= 0) {
      const next = ordered[index + 1] ?? ordered[index - 1];
      go("inbox", next ? next.key : null);
    }
    toggleDoneWithUndo(item, () => go("inbox", item.key));
  };

  // j/k (or arrows) to move, e to mark done or back to open, p to pin or unpin, u or Escape back to the list, c to write.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const index = ordered.findIndex((i) => i.key === itemKey);
      if (e.key === "j" || e.key === "ArrowDown") {
        const next = ordered[Math.min(ordered.length - 1, index + 1)];
        if (next) {
          e.preventDefault();
          go("inbox", next.key);
        }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        const prev = ordered[Math.max(0, index - 1)];
        if (prev) {
          e.preventDefault();
          go("inbox", prev.key);
        }
      } else if (e.key === "e" && current) {
        e.preventDefault();
        doneAndNext(current);
      } else if (e.key === "p" && current && current.kind !== "note") {
        e.preventDefault();
        togglePinned(current.key);
      } else if ((e.key === "Escape" || e.key === "u") && itemKey) {
        go("inbox");
      } else if (e.key === "c" && !composing) {
        e.preventDefault();
        go("inbox", "new");
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [ordered, itemKey, current, segment, composing]);

  // Keep the open item in view while moving with the keyboard.
  useEffect(() => {
    if (itemKey) document.querySelector(`[data-key="${CSS.escape(itemKey)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [itemKey]);

  let lastGroup = "";
  return (
    <div ref={split.box} className={`inbox${current || composing ? " reading" : ""}`} style={split.style}>
      <div className="inbox-list">
        <div className="inbox-tools" role="group" aria-label={t("Show")}>
          <a className="btn btn-primary btn-sm write-btn" href={hrefFor("inbox", "new")} title={t("New message (c)")}>
            <Icon name="pen" /> {tSense("New", "button")}
          </a>
          {SEGMENTS.filter((s) => s.id !== "needs" || jevOn || counts.needs > 0).map((s) => (
            <button key={s.id} className="seg" aria-pressed={segment === s.id} onClick={() => pick(s.id)}>
              {segmentLabel(s)}
              {counts[s.id] ? <span className="n">{counts[s.id]}</span> : null}
            </button>
          ))}
        </div>
        {segment === "done" ? (
          <p className="done-note">{t("Done is your own list in this app. Nothing changes in Wilma, and teachers don't see it.")}</p>
        ) : null}
        {ordered.length ? (
          <div className="list">
            {ordered.map((item, i) => {
              const group = segment === "needs" ? "" : groupOf(item);
              const head = group && group !== lastGroup ? <div className="group-head">{groupLabel(group)}</div> : null;
              lastGroup = group || lastGroup;
              return (
                <Fragment key={item.key}>
                  {head}
                  <ItemRow item={item} snap={snap} current={item.key === itemKey} index={i} href={hrefFor("inbox", item.key)} />
                </Fragment>
              );
            })}
          </div>
        ) : (
          <p style={{ padding: "18px 16px", color: "var(--ink-3)" }}>
            {query ? t("Nothing matches “{query}”.", { query }) : segment === "done" ? t("Items you mark done go here.") : t("Nothing here.")}
          </p>
        )}
      </div>
      <div className="inbox-split" {...split.handle} />
      <div className="reader-wrap">
        {composing ? (
          <NewMessage
            key={itemKey}
            initialChild={itemKey?.split(":")[1] || null}
            initialTeacher={decodePart(itemKey?.split(":")[2])}
            initialSubject={decodePart(itemKey?.split(":").slice(3).join(":"))}
          />
        ) : current ? (
          <Reader item={current} snap={snap} onDone={() => doneAndNext(current)} />
        ) : (
          <div className="reader-empty">
            <div>
              <p>{t("Pick something to read.")}</p>
              <p>
                {tx("{j} {k} to move · {e} done · {p} pin · {r} reply · {c} new message · {slash} search", {
                  j: <kbd>j</kbd>,
                  k: <kbd>k</kbd>,
                  e: <kbd>e</kbd>,
                  p: <kbd>p</kbd>,
                  r: <kbd>r</kbd>,
                  c: <kbd>c</kbd>,
                  slash: <kbd>/</kbd>,
                })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
