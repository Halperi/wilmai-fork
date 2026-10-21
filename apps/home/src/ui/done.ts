/*
 * "Done": the parent's own mark that an item is handled. It lives only in
 * this app on this computer (Wilma has nothing like it), takes the item out
 * of the lists and "Needs you", and can be undone from the note it leaves.
 */
import type { FeedItem } from "../data/feed";
import { toggleDone } from "../data/store";
import { t } from "../i18n";
import { showToast } from "./Toast";

const HINT_KEY = "wilmai.doneHintShown";

function note(wasDone: boolean): string {
  if (wasDone) return t("Moved back to open");
  let first = false;
  try {
    first = !localStorage.getItem(HINT_KEY);
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // no storage: the short note
  }
  return first ? t("Marked done. Only this app keeps it; nothing changes in Wilma.") : t("Marked done");
}

/** Mark done (or back to open) where it is, with Undo. `undoAlso` runs after undoing (e.g. going back to the item). */
export function toggleDoneWithUndo(item: FeedItem, undoAlso?: () => void): void {
  const wasDone = item.done;
  toggleDone(item.key);
  showToast(note(wasDone), () => {
    toggleDone(item.key);
    undoAlso?.();
  });
}
