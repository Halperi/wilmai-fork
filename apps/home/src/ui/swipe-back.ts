/** Touch-only back navigation. It deliberately does not use the WebView's page history. */
export class BackSwipe {
  private locked = false;
  private cancelled = false;
  constructor(private x: number, private y: number, private started: number) {}

  move(x: number, y: number, time: number): boolean {
    const dx = x - this.x, dy = Math.abs(y - this.y);
    if (this.cancelled) return false;
    if (time - this.started > 1500 || dx < -10 || (dy > 10 && dy > dx * 0.55)) {
      this.cancelled = true;
      return false;
    }
    if (dx >= 10 && dx >= dy * 1.8) this.locked = true;
    return this.locked;
  }

  finish(x: number, y: number, time: number): boolean {
    return this.move(x, y, time) && x - this.x >= 72;
  }
}

/** Return false for text editing, selection, scrolling widgets and a modal over this view. */
function mayStart(root: HTMLElement, target: EventTarget | null): boolean {
  const doc = root.ownerDocument;
  const modal = [...doc.querySelectorAll('dialog[open], [aria-modal="true"]')].at(-1);
  if (modal && !modal.contains(root)) return false;
  if (doc.getSelection()?.isCollapsed === false) return false;
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="slider"], [data-no-swipe-back]')) return false;
  for (let node: Element | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1) return false;
    if (node === root) break;
  }
  return true;
}

/** One finger from the panel's leftmost 32 CSS pixels. Vertical movement remains native scrolling. */
export function bindSwipeBack(root: HTMLElement, back: () => void): () => void {
  let active: { id: number; swipe: BackSwipe } | null = null;
  const cancel = () => { active = null; };
  const start = (event: TouchEvent) => {
    cancel();
    if (event.defaultPrevented || event.touches.length !== 1 || !mayStart(root, event.target)) return;
    const touch = event.touches[0];
    const edge = touch.clientX - root.getBoundingClientRect().left;
    if (edge < 0 || edge > 32) return;
    active = { id: touch.identifier, swipe: new BackSwipe(touch.clientX, touch.clientY, event.timeStamp) };
  };
  const move = (event: TouchEvent) => {
    if (!active) return;
    if (event.defaultPrevented || event.touches.length !== 1 || root.ownerDocument.getSelection()?.isCollapsed === false) return cancel();
    const touch = [...event.touches].find((t) => t.identifier === active!.id);
    if (!touch) return cancel();
    // A touch that stops native momentum can be non-cancelable; its direction still counts.
    if (active.swipe.move(touch.clientX, touch.clientY, event.timeStamp) && event.cancelable) event.preventDefault();
  };
  const end = (event: TouchEvent) => {
    const gesture = active;
    cancel();
    if (!gesture || event.defaultPrevented || event.touches.length || !mayStart(root, event.target)) return;
    const touch = [...event.changedTouches].find((t) => t.identifier === gesture.id);
    if (!touch || !gesture.swipe.finish(touch.clientX, touch.clientY, event.timeStamp)) return;
    if (event.cancelable) event.preventDefault(); // Do not also click the link or button under the finger.
    event.stopPropagation(); // A sheet consumes the gesture before an underlying reader can go back.
    back();
  };
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchmove', move, { passive: false });
  root.addEventListener('touchend', end, { passive: false });
  root.addEventListener('touchcancel', cancel, { passive: true });
  return () => {
    cancel();
    root.removeEventListener('touchstart', start);
    root.removeEventListener('touchmove', move);
    root.removeEventListener('touchend', end);
    root.removeEventListener('touchcancel', cancel);
  };
}
