import { useEffect, useRef, type RefObject } from "react";
import { isMobileApp } from "../platform";
import { bindSwipeBack } from "./swipe-back";

/** Keep the gesture stable while the current message or panel updates. */
export function useSwipeBack(ref: RefObject<HTMLElement | null>, back: (() => void) | undefined, enabled = true): void {
  const latest = useRef(back);
  useEffect(() => { latest.current = back; }, [back]);
  const available = Boolean(back);
  useEffect(() => {
    if (!isMobileApp || !enabled || !available || !ref.current) return;
    return bindSwipeBack(ref.current, () => latest.current?.());
  }, [ref, enabled, available]);
}
