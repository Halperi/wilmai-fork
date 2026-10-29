"use client";

import { gsap } from "gsap";
import { useEffect, useRef } from "react";
import tour from "../lib/home-tour.json";

/*
 * The hero's tour of WilmAI Home, made the way the product tours in my decks are: screens of the app, put in motion
 * with GSAP. scripts/capture-home-tour.mjs takes the screens from the app itself, with where their parts are
 * (lib/home-tour.json), so a new capture keeps the tour right; nothing is edited or measured by hand.
 *
 * Everything inside the window is laid out in the screens' own pixels (2×, "plate px") and scaled once to the
 * window's width. A section's moving parts are windows onto its screen (sprites), views change by moving their
 * content, never with a cursor, and the detail that matters lifts out of the window as a card. A line under the
 * window says what each part shows, changing with it.
 *
 * - It plays only while it's on screen (and the tab is shown). The button by the timeline (or a click on the window)
 *   pauses and resumes it,
 *   and the timeline jumps to a section.
 * - With less motion asked for, each section is one still frame, and the timeline steps between them. Without
 *   JavaScript, the first screen shows.
 * - Phones load the 1× screens.
 */

export const TOUR_SECTIONS = ["today", "message", "search", "week", "grades"] as const;
type Section = (typeof TOUR_SECTIONS)[number];
/** The timeline's labels, and the line under the window: Today and the inbox have two each. */
export type TourLabels = Record<Section, string> & {
  sections: string;
  paused: string;
  play: string;
  pause: string;
  captions: { today: [string, string]; message: [string, string]; search: string; week: string; grades: string };
};
type Lang = "en" | "fi";
type Rect = number[];
type Plate = { w: number; h: number; rects: Record<string, Rect[]> };

const [WW, WH] = tour.window;

export function HomeTour({ lang, label, labels }: { lang: Lang; label: string; labels: TourLabels }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => buildTour(root.current!, lang, labels), [lang, labels]);
  return (
    <div className="ht" ref={root}>
      <div className="ht-frame" role="img" aria-label={label}>
        {/* The first screen, until the tour is built (and for anyone without JavaScript). */}
        <img className="ht-poster" src={`/home-tour/${lang}/today.webp`} alt="" width={WW / 2} height={WH / 2} />
        <div className="ht-scaled" aria-hidden="true">
          <div className="ht-screen" />
          <div className="ht-pop" />
        </div>
        <span className="ht-paused" aria-hidden="true">{labels.paused}</span>
      </div>
      <div className="ht-controls">
        <button type="button" className="ht-play" aria-label={labels.pause} />
        <nav className="ht-timeline" aria-label={labels.sections}>
          {TOUR_SECTIONS.map((id) => (
            <button type="button" className="ht-seg" key={id}>
              <span className="ht-bar">
                <i />
              </span>
              <span className="ht-lbl">{labels[id]}</span>
            </button>
          ))}
        </nav>
      </div>
      {/* What each part shows (the window's label says it all for screen readers). */}
      <p className="ht-caption" aria-hidden="true">
        {labels.captions.today[0]}
      </p>
    </div>
  );
}

interface View {
  v: HTMLDivElement;
  mv: HTMLDivElement;
}
interface Step {
  id: Section;
  view: string;
  /** The line under the window, from these seconds into the section's build. */
  heads: [number, string][];
  /** Seconds into the section's build that its still frame shows. */
  still: number;
  reset?: () => void;
  build: (tl: gsap.core.Timeline, t: number) => void;
}

function buildTour(host: HTMLElement, lang: Lang, labels: TourLabels): () => void {
  const plates = tour[lang] as Record<string, Plate>;
  const small = matchMedia("(max-width: 760px)").matches;
  const src = (plate: string) => `/home-tour/${lang}/${plate}${small ? "-1x" : ""}.webp`;
  const q = <T extends Element>(sel: string) => host.querySelector<T>(sel)!;
  const frame = q<HTMLDivElement>(".ht-frame"), scaled = q<HTMLDivElement>(".ht-scaled");
  const screen = q<HTMLDivElement>(".ht-screen"), pop = q<HTMLDivElement>(".ht-pop");
  const poster = q<HTMLImageElement>(".ht-poster"), pausedTag = q<HTMLSpanElement>(".ht-paused");
  const headline = q<HTMLParagraphElement>(".ht-caption");
  const said = labels.captions;
  const playBtn = q<HTMLButtonElement>(".ht-play");
  const segs = [...host.querySelectorAll<HTMLButtonElement>(".ht-seg")];
  const fills = segs.map((s) => s.querySelector("i")!);

  // ---------------------------------------------------------------- the window's scale
  const fit = () => {
    scaled.style.transform = `scale(${frame.clientWidth / WW})`;
  };
  const sized = new ResizeObserver(fit);
  sized.observe(frame);
  fit();

  // ---------------------------------------------------------------- building blocks (plate px)
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: Element) => {
    const n = document.createElement(tag);
    n.className = cls;
    parent.appendChild(n);
    return n;
  };
  const place = <T extends HTMLElement>(n: T, [x0, y0, x1, y1]: Rect) => {
    Object.assign(n.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    (n as T & { _rect: Rect })._rect = [x0, y0, x1, y1];
    return n;
  };
  // A window onto `plate` at `rect`, drawn at the same spot.
  const sprite = (parent: Element, plate: string, rect: Rect, cls = "ht-sp") => {
    const n = place(el("div", cls, parent), rect);
    n.style.backgroundImage = `url(${src(plate)})`;
    n.style.backgroundPosition = `${-rect[0]}px ${-rect[1]}px`;
    n.style.backgroundSize = `${plates[plate].w}px ${plates[plate].h}px`;
    return n;
  };
  const box = (parent: Element, rect: Rect, color: string, cls = "ht-box") => {
    const n = place(el("div", cls, parent), rect);
    n.style.background = color;
    return n;
  };
  const centre = (r: Rect) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  const union = (rs: Rect[]): Rect => [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))];
  const SHEET = "#ffffff"; // the app's cards, light theme

  const views: Record<string, View> = {};
  // A view: the menu stays put while the page beside it (mv) moves.
  const view = (id: string, plate: string) => {
    const { w, h } = plates[plate];
    const side = plates[plate].rects.main[0][0];
    const v = el("div", "ht-view", screen);
    const img = (parent: Element) => {
      const i = el("img", "", parent);
      i.src = src(plate);
      i.alt = "";
      Object.assign(i.style, { width: `${w}px`, height: `${h}px` });
    };
    img(place(el("div", "ht-side", v), [0, 0, side, WH]));
    const mv = el("div", "ht-mv", place(el("div", "ht-main", v), [side, 0, WW, WH]));
    Object.assign(mv.style, { left: `${-side}px`, width: `${w}px`, height: `${h}px` });
    img(mv);
    return (views[id] = { v, mv });
  };

  // ---------------------------------------------------------------- shared moments
  const transients: HTMLElement[] = [];
  const keep = <T extends HTMLElement>(n: T) => (transients.push(n), n);
  // A card that starts exactly over its source pixels, then lifts out of the window, to the middle of the page
  // beside the menu.
  const card = (plate: string, rect: Rect) => {
    const c = keep(sprite(pop, plate, rect, "ht-sp ht-card"));
    const [x0, , x1] = plates[plate].rects.main[0];
    c.dataset.x = String((x0 + x1) / 2);
    return c;
  };
  const lift = (tl: gsap.core.Timeline, c: HTMLElement, scale: number, at: number) => {
    const [hx, hy] = centre((c as HTMLElement & { _rect: Rect })._rect);
    tl.set(c, { autoAlpha: 1, x: 0, y: 0, scale: 1 }, at);
    tl.to(c, { x: Number(c.dataset.x) - hx, y: WH / 2 - hy, scale, duration: 0.7, ease: "expo.out", boxShadow: "0 0 0 6px rgba(15,23,42,0.06), 0 70px 160px rgba(15,23,42,0.30)" }, at);
  };
  const settle = (tl: gsap.core.Timeline, c: HTMLElement, at: number) => {
    tl.to(c, { x: 0, y: 0, scale: 1, duration: 0.5, ease: "power3.inOut", boxShadow: "0 0 0 6px rgba(15,23,42,0), 0 0 0 rgba(15,23,42,0)" }, at);
    tl.set(c, { autoAlpha: 0 }, at + 0.5);
  };
  const shared = {
    // Under a lifted card, the app dims a little.
    dim: keep(box(screen, [0, 0, WW, WH], "#0f172a", "ht-layer")),
    ring: keep(el("div", "ht-layer ht-ring", screen)),
  };
  const dim = (tl: gsap.core.Timeline, at: number, on: boolean) => tl.to(shared.dim, { autoAlpha: on ? 0.12 : 0, duration: 0.4, ease: "sine.inOut" }, at);
  const ring = (tl: gsap.core.Timeline, r: Rect, at: number, off: number) => {
    const pad = 12;
    tl.set(shared.ring, { left: r[0] - pad, top: r[1] - pad, width: r[2] - r[0] + 2 * pad, height: r[3] - r[1] + 2 * pad }, at);
    tl.fromTo(shared.ring, { autoAlpha: 0, scale: 1.06 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: "expo.out", immediateRender: false }, at);
    tl.to(shared.ring, { autoAlpha: 0, duration: 0.25 }, off);
  };
  // Rows that arrive one by one, each a window onto the screen, over a cover that hides the originals.
  const rowsIn = (v: View, plate: string, rects: Rect[], cover = SHEET) => {
    box(v.mv, union(rects), cover);
    return rects.map((r) => sprite(v.mv, plate, r));
  };

  // ---------------------------------------------------------------- sections
  const STEPS: Step[] = [];

  // Today: each child's school day arrives, what needs you lifts out, then the page runs down to the results.
  (() => {
    const r = plates.today.rects;
    const v = view("today", "today");
    const days = rowsIn(v, "today", r.days);
    const needs = card("today", r.needs[0]);
    const down = Math.max(0, plates.today.h - WH);
    STEPS.push({
      id: "today", view: "today", still: 2.0, heads: [[0, said.today[0]], [1.3, said.today[1]]],
      reset() {
        gsap.set(days, { autoAlpha: 0, y: 24 });
        gsap.set(v.mv, { y: 0 });
      },
      build(tl, t) {
        tl.to(days, { autoAlpha: 1, y: 0, duration: 0.55, ease: "expo.out", stagger: 0.14 }, t);
        dim(tl, t + 1.3, true);
        lift(tl, needs, 1.3, t + 1.3);
        dim(tl, t + 4.0, false);
        settle(tl, needs, t + 4.0);
        tl.to(v.mv, { y: -down, duration: 1.8, ease: "power2.inOut" }, t + 4.7);
      },
    });
  })();

  // The inbox: messages and bulletins arrive in one list, then an answer to a teacher lifts out and is typed.
  (() => {
    const r = plates.message.rects;
    const v = view("message", "message");
    const lines = rowsIn(v, "message", r.lines);
    const [composer] = r.composer, [typed] = r.typed;
    const reply = card("message", composer);
    // the answer, typed into the lifted card: the field starts empty and lets its words in a letter at a time
    const local = (x: Rect): Rect => [x[0] - composer[0], x[1] - composer[1], x[2] - composer[0], x[3] - composer[1]];
    box(reply, local(typed), SHEET);
    const words = place(el("div", "ht-sp", reply), local(typed));
    Object.assign(words.style, { backgroundImage: `url(${src("message")})`, backgroundPosition: `${-typed[0]}px ${-typed[1]}px`, backgroundSize: `${plates.message.w}px ${plates.message.h}px` });
    // and the field under it empty too, until the card settles back with the words in it
    const empty = box(v.mv, typed, SHEET);
    STEPS.push({
      id: "message", view: "message", still: 4.2, heads: [[0, said.message[0]], [2.3, said.message[1]]],
      reset() {
        gsap.set(lines, { autoAlpha: 0, y: 18 });
        gsap.set(words, { clipPath: "inset(0% 100% 0% 0%)" });
        gsap.set(empty, { autoAlpha: 1 });
      },
      build(tl, t) {
        tl.to(lines, { autoAlpha: 1, y: 0, duration: 0.5, ease: "expo.out", stagger: 0.07 }, t);
        if (r.news[0]) ring(tl, r.news[0], t + 1.1, t + 2.1);
        dim(tl, t + 2.4, true);
        lift(tl, reply, 1.12, t + 2.4);
        tl.to(words, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "steps(16)" }, t + 3.1);
        dim(tl, t + 5.2, false);
        settle(tl, reply, t + 5.2);
        tl.set(empty, { autoAlpha: 0 }, t + 5.2);
      },
    });
  })();

  // Search: ⌘K over Today, the query typed, the results in.
  (() => {
    const r = plates.search.rects;
    view("search", "today");
    const backdrop = keep(box(screen, [0, 0, WW, WH], "rgba(15,23,42,0.28)", "ht-layer")); // the app's ::backdrop
    const menu = keep(sprite(screen, "search", r.menu[0], "ht-layer ht-sp ht-menu"));
    const field = r.input[0];
    // the query, typed: the field starts empty and its text is let in a letter at a time
    const blank = keep(box(screen, field, SHEET, "ht-layer"));
    const typed = keep(sprite(screen, "search", field, "ht-layer ht-sp"));
    // its headings and results, in the page's order
    const listCover = keep(box(screen, union(r.lines), SHEET, "ht-layer"));
    const lines = r.lines.map((g) => keep(sprite(screen, "search", g, "ht-layer ht-sp")));
    STEPS.push({
      id: "search", view: "search", still: 2.0, heads: [[0, said.search]],
      reset() {
        gsap.set(typed, { clipPath: "inset(0% 100% 0% 0%)" });
        gsap.set(lines, { y: 16 });
      },
      build(tl, t) {
        tl.fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: "sine.out", immediateRender: false }, t);
        tl.fromTo(menu, { autoAlpha: 0, scale: 0.97, y: 20 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.5, ease: "expo.out", immediateRender: false }, t);
        tl.set([blank, typed, listCover], { autoAlpha: 1 }, t);
        // the query ("koe") is about an eighth of the field: a letter at a time
        tl.to(typed, { clipPath: "inset(0% 96% 0% 0%)", duration: 0.01 }, t + 0.7);
        tl.to(typed, { clipPath: "inset(0% 92% 0% 0%)", duration: 0.01 }, t + 0.85);
        tl.to(typed, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.01 }, t + 1.0);
        tl.to(lines, { autoAlpha: 1, y: 0, duration: 0.45, ease: "expo.out", stagger: 0.09 }, t + 1.15);
      },
    });
  })();

  // The week: both children's days drawn in, a lesson picked, and its day's schedule (beside the week) lifts out.
  (() => {
    const r = plates.week.rects;
    const v = view("week", "week");
    const cols = rowsIn(v, "week", r.cols);
    const day = card("week", union(r.day));
    STEPS.push({
      id: "week", view: "week", still: 2.8, heads: [[0, said.week]],
      reset() {
        gsap.set(cols, { clipPath: "inset(0% 0% 100% 0%)" });
      },
      build(tl, t) {
        tl.to(cols, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "expo.out", stagger: 0.1 }, t);
        ring(tl, r.picked[0], t + 1.0, t + 1.9);
        dim(tl, t + 1.9, true);
        lift(tl, day, 1.15, t + 1.9);
        dim(tl, t + 4.6, false);
        settle(tl, day, t + 4.6);
      },
    });
  })();

  // Grades: each child's results arrive, and the newest lifts out.
  (() => {
    const r = plates.grades.rects;
    const v = view("grades", "grades");
    const rows = rowsIn(v, "grades", r.rows.slice(0, 6)).concat(rowsIn(v, "grades", r.rows.slice(6)));
    const newest = card("grades", r.rows[1]);
    STEPS.push({
      id: "grades", view: "grades", still: 2.1, heads: [[0, said.grades]],
      reset() {
        gsap.set(rows, { autoAlpha: 0, y: 18 });
      },
      build(tl, t) {
        tl.to(rows, { autoAlpha: 1, y: 0, duration: 0.5, ease: "expo.out", stagger: 0.07 }, t);
        dim(tl, t + 1.4, true);
        lift(tl, newest, 1.06, t + 1.4);
        dim(tl, t + 4.0, false);
        settle(tl, newest, t + 4.0);
      },
    });
  })();

  gsap.set(transients, { autoAlpha: 0 });
  gsap.set(Object.values(views).map((x) => x.v), { autoAlpha: 0 });

  // ---------------------------------------------------------------- playback
  // Moves stay 2D: a 3D layer gets its own texture at its unscaled plate size, which a phone runs out of memory for.
  const timeline = (vars?: gsap.TimelineVars) => gsap.timeline({ ...vars, defaults: { force3D: false } });
  let current: gsap.core.Timeline | null = null;
  let index = -1;
  let shown: View | null = null;
  let still = false; // less motion: each section is one frame
  let paused = false; // the viewer paused it
  let seen = false; // on screen
  const running = () => !still && !paused && seen && !document.hidden;

  function clearTransients() {
    const tl = timeline();
    tl.to(transients, { autoAlpha: 0, duration: 0.25, ease: "sine.in" }, 0);
    tl.call(() => gsap.set(transients, { x: 0, y: 0, scale: 1, clearProps: "boxShadow" }), undefined, 0.26);
    return tl;
  }

  function switchView(id: string) {
    const next = views[id];
    const prev = shown;
    const tl = timeline();
    Object.values(views).forEach((x) => {
      if (x !== next && x !== prev) gsap.set(x.v, { autoAlpha: 0 });
    });
    if (prev === next) {
      gsap.set(next.v, { autoAlpha: 1, zIndex: 2 });
      return tl;
    }
    gsap.set(next.v, { zIndex: 2 });
    if (prev) {
      gsap.set(prev.v, { zIndex: 1 });
      tl.to(prev.mv, { y: "-=36", duration: 0.5, ease: "power2.in" }, 0);
      tl.set(prev.v, { autoAlpha: 0 }, 0.6);
    }
    tl.fromTo(next.v, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.45, ease: "sine.inOut" }, prev ? 0.12 : 0);
    tl.fromTo(next.mv, { y: 48 }, { y: 0, duration: 0.8, ease: "expo.out" }, prev ? 0.12 : 0);
    shown = next;
    return tl;
  }

  // The line under the window changes: out upwards, the new words in from below (as in the decks' tours).
  function caption(text: string) {
    const tl = timeline();
    tl.to(headline, { autoAlpha: 0, y: -10, duration: 0.22, ease: "power2.in" }, 0);
    tl.call(() => {
      headline.textContent = text;
    }, undefined, 0.23);
    tl.fromTo(headline, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "expo.out", immediateRender: false }, 0.24);
    return tl;
  }

  function goTo(i: number, { instant = false } = {}) {
    current?.kill();
    const step = STEPS[i];
    index = i;
    segs.forEach((s, j) => {
      s.classList.toggle("active", j === i);
      s.setAttribute("aria-current", j === i ? "step" : "false");
      gsap.set(fills[j], { scaleX: j < i ? 1 : 0 });
    });
    const tl = timeline({
      onUpdate: () => {
        gsap.set(fills[i], { scaleX: tl.progress() });
      },
      onComplete: () => {
        if (running()) goTo((i + 1) % STEPS.length);
      },
    });
    tl.add(clearTransients(), 0);
    tl.call(() => step.reset?.(), undefined, 0.27);
    tl.add(switchView(step.view), 0.28);
    // the first screen stays up until a view is drawn over it (no frames yet: it stays)
    tl.call(() => gsap.set(poster, { autoAlpha: 0 }), undefined, 0.75);
    tl.addLabel("in", 1.0);
    // the section's first line comes with its view; the rest at their moments
    step.heads.forEach(([at, text], j) => {
      if (j > 0 || headline.textContent !== text) tl.add(caption(text), j ? 1.0 + at - 0.24 : 0.1);
    });
    step.build(tl, 1.0);
    tl.to({}, { duration: 1.0 });
    current = tl;
    if (instant) tl.seek("in", false);
    if (!running()) tl.pause();
  }

  // One frame of a section: its key moment, with the section's bar full.
  function showStill(i: number) {
    goTo(i, { instant: true });
    current!.pause();
    current!.seek(current!.labels.in + STEPS[i].still, false);
    gsap.set(fills[i], { scaleX: 1 });
  }

  function paint() {
    host.classList.toggle("ht-still", still);
    playBtn.hidden = still;
    playBtn.classList.toggle("is-paused", paused);
    playBtn.setAttribute("aria-label", paused ? labels.play : labels.pause);
    gsap.to(pausedTag, { autoAlpha: paused && !still ? 1 : 0, duration: 0.2, overwrite: true });
  }

  // Plays when on screen and not paused, from where it was.
  function sync() {
    paint();
    if (!current || still) return;
    if (!running()) current.pause();
    else if (current.progress() === 1) goTo((index + 1) % STEPS.length);
    else current.resume();
  }

  const less = matchMedia("(prefers-reduced-motion: reduce)");
  function start() {
    still = less.matches;
    if (still) showStill(index < 0 ? 0 : index);
    else goTo(index < 0 ? 0 : index, { instant: index >= 0 });
    sync();
  }

  // ---------------------------------------------------------------- controls
  const toggle = () => {
    if (still) return;
    paused = !paused;
    sync();
  };
  playBtn.addEventListener("click", toggle);
  frame.addEventListener("click", toggle);
  const jumps = segs.map((s, i) => {
    const jump = () => {
      if (still) showStill(i);
      else {
        goTo(i, { instant: true });
        sync();
      }
    };
    s.addEventListener("click", jump);
    return jump;
  });

  // On screen or not, from where it is (an IntersectionObserver's first word can be late, or not come at all in a
  // page that isn't being drawn).
  const look = () => {
    const r = host.getBoundingClientRect();
    const now = r.bottom > 0 && r.top < innerHeight;
    if (now !== seen) {
      seen = now;
      sync();
    }
  };
  addEventListener("scroll", look, { passive: true });
  addEventListener("resize", look);
  const onVisibility = () => sync();
  document.addEventListener("visibilitychange", onVisibility);
  less.addEventListener("change", start);

  // For checks: a section's still frame, or a section from its start.
  (window as Window & { __homeTour?: object }).__homeTour = {
    showStill,
    goTo,
    steps: STEPS.map((s) => s.id),
    get state() {
      return { index, still, paused, seen, time: current?.time(), playing: current ? !current.paused() : false };
    },
  };

  // The first screen loaded before anything moves, so the window never shows empty. (Its load, not decode(): that
  // can wait for good in a page that isn't being drawn.) Two seconds at most.
  let alive = true;
  const first = new Image();
  new Promise<void>((loaded) => {
    first.onload = first.onerror = () => loaded();
    setTimeout(loaded, 2000);
    first.src = src("today");
    if (first.complete) loaded();
  }).then(() => {
    if (!alive || index >= 0) return;
    start();
    look();
  });

  return () => {
    alive = false;
    current?.kill();
    gsap.killTweensOf([...transients, pausedTag, ...fills]);
    sized.disconnect();
    removeEventListener("scroll", look);
    removeEventListener("resize", look);
    document.removeEventListener("visibilitychange", onVisibility);
    less.removeEventListener("change", start);
    playBtn.removeEventListener("click", toggle);
    frame.removeEventListener("click", toggle);
    segs.forEach((s, i) => s.removeEventListener("click", jumps[i]));
    screen.replaceChildren();
    pop.replaceChildren();
    gsap.set(poster, { autoAlpha: 1 });
  };
}
