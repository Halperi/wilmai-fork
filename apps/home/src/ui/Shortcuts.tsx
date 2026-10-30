/* Every keyboard shortcut in one place (opened with "?"). */
import { useEffect, useRef } from "react";
import { t } from "../i18n";

const KEYS: [keys: string[], what: string][] = [
  [["⌘", "K"], "Command menu"],
  [["/"], "Search"],
  [["J", "K"], "Next / previous"],
  [["E"], "Done, or back to open"],
  [["P"], "Pin to the top of Messages, or unpin"],
  [["Z"], "Undo"],
  [["R"], "Reply"],
  [["C"], "New message"],
  [["U"], "Back to the list (or Esc)"],
  [["⌘", "\\"], "Fold the menu to icons"],
  [["G", "T"], "Go to Today"],
  [["G", "M"], "Go to Messages"],
  [["G", "W"], "Go to Week"],
  [["G", "E"], "Go to Exams"],
  [["G", "R"], "Go to Grades"],
  [["G", "N"], "Go to Notes"],
  [["G", "H"], "Go to Homework"],
  [["G", "S"], "Go to Settings"],
  [["G", "D"], "Go to the Done list"],
  [["0", "1", "2"], "Everyone, or one child"],
  [["?"], "These shortcuts"],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog ref={ref} className="lesson-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="keys-title">
      <div className="lesson-card">
        <div className="lesson-top">
          <h2 id="keys-title" style={{ margin: 0 }}>
            {t("Keyboard shortcuts")}
          </h2>
          <span style={{ flex: 1 }} />
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label={t("Close")}>
            ✕
          </button>
        </div>
        <dl className="keys">
          {KEYS.map(([keys, what]) => (
            <div key={what}>
              <dt>
                {keys.map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </dt>
              <dd>{t(what)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  );
}
