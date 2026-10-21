/*
 * A short note at the bottom after an action, with Undo (Z) when it can be
 * undone, as in Gmail or Superhuman. One at a time; gone after a few seconds.
 */
import { useEffect, useSyncExternalStore } from "react";
import { t } from "../i18n";

interface Toast {
  id: number;
  text: string;
  undo?: () => void;
}

let current: Toast | null = null;
let counter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(text: string, undo?: () => void): void {
  current = { id: ++counter, text, undo };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    emit();
  }, 6000);
  emit();
}

/** Undo the latest action, if the note offering it is still showing. Returns whether it did. */
export function undoLatest(): boolean {
  if (!current?.undo) return false;
  const undo = current.undo;
  current = null;
  emit();
  undo();
  return true;
}

export function Toaster() {
  const toast = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current
  );
  // Z (or ⌘Z outside text fields) undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      if (e.key.toLowerCase() === "z" && !e.altKey && !e.shiftKey) {
        if (undoLatest()) e.preventDefault();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.text}</span>
      {toast.undo ? (
        <button className="toast-undo" onClick={() => undoLatest()}>
          {t("Undo")} <kbd>Z</kbd>
        </button>
      ) : null}
    </div>
  );
}
