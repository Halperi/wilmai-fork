/*
 * School days as a strip, two weeks to a row (Exams, Homework): each day with
 * chips for what's on it, today ringed, the days gone this week dimmed. A day
 * opens what's on it right under its row, pointing up at the day; clicking it
 * again closes it.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { addDays, dayName, dayNameLong, isoWeek, shortDate, today } from "../data/dates";
import { t } from "../i18n";

export function DayStrip({
  start,
  rows,
  chips,
  canOpen,
  describe,
  picked,
  onPick,
  renderDay,
  after,
}: {
  /** The Monday the strip starts on. */
  start: string;
  /** Two-week rows. */
  rows: number;
  /** What's on a day, as chips (the strip's own small labels). */
  chips: (date: string) => ReactNode;
  /** A day that opens (others are shown, not clickable). */
  canOpen: (date: string) => boolean;
  /** What's on a day, in words, for screen readers. */
  describe: (date: string) => string;
  picked: string | null;
  onPick: (date: string | null) => void;
  renderDay: (date: string) => ReactNode;
  /** Under the strip (e.g. "+3 later"). */
  after?: ReactNode;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // Where the picked day is in its row, for the pointer (measured, so it follows a resize).
  const [x, setX] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!picked) return;
    const measure = () => {
      const day = strip.current?.querySelector<HTMLElement>(`[data-day="${picked}"]`);
      if (day) setX(day.offsetLeft + day.offsetWidth / 2);
    };
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [picked]);
  const now = today();

  return (
    <div className="ex-strip" ref={strip} aria-label={t("School days")}>
      {Array.from({ length: rows }, (_, r) => {
        const monday = addDays(start, r * 14);
        const days = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((i) => addDays(monday, i));
        return (
          <div className="ex-strip-row" key={monday}>
            <span className="ex-strip-weeks">{t("Weeks {a}–{b}", { a: isoWeek(monday), b: isoWeek(addDays(monday, 7)) })}</span>
            <div className="hw-strip">
              {days.map((d, i) => {
                const open = canOpen(d);
                const cls = `hw-sday${d === now ? " today" : ""}${d < now ? " past" : ""}${i === 5 ? " next-week" : ""}${open ? "" : " empty-day"}`;
                const body = (
                  <>
                    <span className="wd">{dayName(d)}</span>
                    <span className="dn">{Number(d.slice(8))}.</span>
                    <span className="hw-counts">{chips(d)}</span>
                  </>
                );
                return open ? (
                  <button
                    type="button"
                    key={d}
                    data-day={d}
                    className={cls}
                    aria-expanded={picked === d}
                    aria-pressed={picked === d}
                    aria-label={`${dayNameLong(d)} ${shortDate(d)}${describe(d) ? `: ${describe(d)}` : ""}`}
                    onClick={() => onPick(picked === d ? null : d)}
                  >
                    {body}
                  </button>
                ) : (
                  <span key={d} data-day={d} className={cls}>
                    {body}
                  </span>
                );
              })}
            </div>
            {picked && days.includes(picked) ? (
              <div className="ex-open" style={{ ["--x" as string]: x === null ? "50%" : `${x}px` }}>
                <span className="ex-open-arrow" aria-hidden="true" />
                {renderDay(picked)}
              </div>
            ) : null}
          </div>
        );
      })}
      {after}
    </div>
  );
}
