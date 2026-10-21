/*
 * The command menu (⌘K / Ctrl+K): go anywhere, start the things a parent
 * does (a new message, an absence report), switch children or language, and
 * find any message, bulletin or teacher's note by its words. Arrow keys and
 * Enter, Escape to close.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { FeedItem } from "../data/feed";
import type { Child } from "../data/model";
import { isDemo, syncNow } from "../data/engine";
import { updateSettings, useViewer } from "../data/store";
import { whenShort } from "../data/dates";
import { t } from "../i18n";
import { Icon, Tab } from "./bits";
import { go, openItem, setSegment, useChildFilter, type Segment } from "./shared";

interface Command {
  id: string;
  group: string;
  label: string;
  /** More words it's found by. */
  keywords?: string;
  hint?: string;
  icon?: string;
  child?: Child;
  run: () => void;
}

/** Ask Today to open the absence card for one child (Today listens; it may mount after this). */
export function requestAbsenceReport(child: string): void {
  pendingAbsence = child;
  window.dispatchEvent(new CustomEvent("wilmai:report-absence", { detail: child }));
}
let pendingAbsence: string | null = null;
/** For Today: an absence report asked for before it was showing (consumed once). */
export function takePendingAbsence(child: string): boolean {
  if (pendingAbsence !== child) return false;
  pendingAbsence = null;
  return true;
}

const matches = (text: string, words: string[]) => words.every((w) => text.includes(w));

export function CommandMenu({ open, onClose, feed, family, onShortcuts }: { open: boolean; onClose: () => void; feed: FeedItem[]; family: Child[]; onShortcuts: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { set: setFilter } = useChildFilter();
  const demo = isDemo();
  const student = useViewer() === "student";

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setActive(0);
      dialog.showModal();
      setTimeout(() => input.current?.focus(), 0);
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go_ = t("Go to");
    const act = t("Actions");
    const list: Command[] = [
      { id: "today", group: go_, label: t("Today"), icon: "today", hint: "G T", run: () => go("today") },
      { id: "inbox", group: go_, label: t("Inbox"), icon: "inbox", hint: "G I", run: () => go("inbox") },
      { id: "week", group: go_, label: t("Week"), icon: "week", hint: "G W", run: () => go("week") },
      { id: "calendar", group: go_, label: t("Calendar"), icon: "calendar", hint: "G C", keywords: "kalenteri calendar google tapahtumat events loma holiday", run: () => go("calendar") },
      { id: "homework", group: go_, label: t("Homework"), icon: "book", hint: "G H", keywords: "läksyt kotitehtävät homework", run: () => go("homework") },
      { id: "notes", group: go_, label: t("Notes"), icon: "note", hint: "G N", keywords: "teacher notes tuntimerkinnät merkinnät poissaolot absence attendance", run: () => go("notes") },
      { id: "exams", group: go_, label: t("Exams"), icon: "exam", hint: "G E", keywords: "exam test koe kokeet arvosana grade", run: () => go("exams") },
      { id: "grades", group: go_, label: t("Grades"), icon: "grades", hint: "G R", keywords: "grades arvosanat arvosana suoritukset keskiarvo average", run: () => go("grades") },
      { id: "settings", group: go_, label: t("Settings"), icon: "settings", hint: "G S", keywords: "jev language kieli", run: () => go("settings") },
    ];
    // The inbox's lists, Done included.
    const lists: [Segment, string, string][] = [
      ["all", "Inbox: all", "kaikki"],
      ["needs", "Inbox: needs you", "odottaa"],
      ["message", "Inbox: messages", "viestit"],
      ["news", "Inbox: bulletins", "tiedotteet"],
      ["done", "Inbox: done", "hoidetut archive valmis"],
    ];
    for (const [segment, label, keywords] of lists) {
      list.push({ id: `list:${segment}`, group: go_, label: t(label), keywords, icon: segment === "done" ? "check" : "inbox", run: () => (setSegment(segment), go("inbox")) });
    }
    for (const child of family) {
      list.push({
        id: `new:${child.number}`,
        group: act,
        label: family.length > 1 ? t("New message about {name}", { name: child.first }) : t("New message"),
        keywords: "write message teacher viesti opettaja",
        icon: "pen",
        child,
        run: () => go("inbox", `new:${child.number}`),
      });
      if (!student)
        list.push({
          id: `absent:${child.number}`,
          group: act,
          label: t("Report {name} absent", { name: child.first }),
          keywords: "sick ill absence poissa sairas poissaolo",
          icon: "calendar",
          child,
          run: () => {
            go("today");
            requestAbsenceReport(child.number);
          },
        });
    }
    if (family.length > 1) {
      list.push({ id: "everyone", group: act, label: t("Show everyone"), icon: "today", run: () => setFilter([]) });
      for (const child of family) {
        list.push({ id: `only:${child.number}`, group: act, label: t("Show only {name}", { name: child.first }), child, run: () => setFilter([child.number]) });
      }
    }
    if (!demo) list.push({ id: "sync", group: act, label: t("Check Wilma now"), keywords: "refresh sync update päivitä", icon: "refresh", run: () => void syncNow() });
    list.push({ id: "keys", group: act, label: t("Keyboard shortcuts"), keywords: "keys help ? näppäin pikanäppäimet", hint: "?", run: onShortcuts });
    list.push({ id: "lang-fi", group: act, label: "Suomeksi", keywords: "language kieli finnish", run: () => updateSettings({ language: "fi" }) });
    list.push({ id: "lang-en", group: act, label: "In English", keywords: "language kieli english", run: () => updateSettings({ language: "en" }) });
    return list;
  }, [family, demo, student, setFilter, onShortcuts]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => {
    const cmds = words.length ? commands.filter((c) => matches(`${c.label} ${c.keywords ?? ""} ${c.child?.name ?? ""}`.toLowerCase(), words)) : commands;
    // Messages, bulletins and notes, by their words (only when searching).
    const items: Command[] = words.length
      ? feed
          .filter((i) => matches(`${i.title} ${i.from ?? ""} ${i.text ?? i.preview}`.toLowerCase(), words))
          .slice(0, 8)
          .map((i) => ({
            id: `item:${i.key}`,
            group: t("Messages and bulletins"),
            label: i.title,
            hint: whenShort(i.at),
            icon: i.kind === "news" ? "bulletin" : i.kind === "note" ? "note" : "message",
            child: family.find((c) => c.number === i.children[0]),
            run: () => openItem(i),
          }))
      : [];
    return [...cmds, ...items];
  }, [commands, feed, family, words.join(" ")]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.querySelector(`.cmdk [data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  let lastGroup = "";
  return (
    <dialog
      ref={ref}
      className="cmdk"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={t("Command menu")}
    >
      <div className="cmdk-box">
        <label className="cmdk-search">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Type a command or search…")}
            aria-label={t("Type a command or search…")}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(shown.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[active]);
              }
            }}
          />
          <kbd>esc</kbd>
        </label>
        <div className="cmdk-list" role="listbox">
          {shown.length ? (
            shown.map((c, i) => {
              const head = c.group !== lastGroup ? <div className="cmdk-group">{c.group}</div> : null;
              lastGroup = c.group;
              return (
                <div key={c.id}>
                  {head}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-index={i}
                    className="cmdk-item"
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(c)}
                  >
                    {c.child && family.length > 1 ? <Tab child={c.child} /> : c.icon ? <Icon name={c.icon} /> : <span className="cmdk-dot" />}
                    <span className="cmdk-label">{c.label}</span>
                    {c.hint ? <small>{c.hint}</small> : null}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="cmdk-empty">{t("Nothing matches “{query}”.", { query })}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}
