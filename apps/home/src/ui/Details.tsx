/*
 * The details panel on the right: what a view knows beside its content (the
 * week at a glance, a lesson picked in it). A view renders <DetailsPanel>;
 * the shell gives it a column beside the content when the window is wide
 * enough (DOCK_QUERY). Narrower, the panel slides over the content as a
 * sheet, which closes on Escape or a click beside it. A panel without
 * `onClose` stays (it has no close button).
 */
import { useContext, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DOCK_QUERY, DetailsHost, useMedia } from "./shared";
import { Icon } from "./bits";
import { t } from "../i18n";

export function DetailsPanel({
  title,
  onClose,
  closeOnEscape = true,
  children,
}: {
  title: ReactNode;
  onClose?: () => void;
  /** Off where Escape already means something else (the inbox: back to the list). */
  closeOnEscape?: boolean;
  children: ReactNode;
}) {
  const { host, change } = useContext(DetailsHost);
  const docked = useMedia(DOCK_QUERY);
  const closeButton = useRef<HTMLButtonElement>(null);

  // The shell makes room while a docked panel shows.
  useEffect(() => {
    if (!docked) return;
    change(1);
    return () => change(-1);
  }, [docked, change]);

  useEffect(() => {
    if (!onClose || (!closeOnEscape && docked)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target instanceof Element && e.target.closest("input, textarea, select, dialog"))) return;
      e.preventDefault();
      onClose();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [closeOnEscape, docked, onClose]);

  // A sheet takes the focus (it covers the content); a docked panel leaves it where the parent is working.
  useEffect(() => {
    if (!docked) closeButton.current?.focus();
  }, [docked]);

  const body = (
    <>
      <div className="details-head">
        <h3>{title}</h3>
        {onClose ? (
          <button ref={closeButton} className="btn btn-quiet btn-sm" onClick={onClose} aria-label={t("Close details")} title={closeOnEscape ? t("Close (Esc)") : t("Close")}>
            <Icon name="close" />
          </button>
        ) : null}
      </div>
      <div className="details-body">{children}</div>
    </>
  );
  if (docked) return host ? createPortal(body, host) : null;
  return createPortal(
    <div className="details-layer">
      <div className="details-backdrop" onClick={onClose} />
      <aside className="details details-sheet" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : t("Details")}>
        {body}
      </aside>
    </div>,
    document.body
  );
}
