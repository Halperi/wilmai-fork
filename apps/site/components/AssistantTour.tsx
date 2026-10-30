"use client";

import { gsap } from "gsap";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import type { AssistantTourText } from "../lib/i18n";
import { playTour, timeline, type TourStep } from "./tour-engine";

/*
 * The front page's tour: an assistant at work, with the made-up family. Each part is one question in the chat
 * window, the assistant reading Wilma, and its answer line by line, the words that matter highlighted. It plays the
 * way the Home page's tour does (tour-engine.ts), but the window is the page's own text, not screens: the questions
 * and answers are in lib/i18n.tsx, so changing them is all it takes.
 *
 * Without JavaScript, or before it runs, the first question shows answered; that's where the tour starts too.
 */

/** "==words==" highlighted, as a marker would. */
function marked(text: string): ReactNode {
  return text.split(/==(.+?)==/).map((part, i) => (i % 2 ? <mark className="at-mark" key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

export function AssistantTour({ title, tour }: { title: string; tour: AssistantTourText }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => buildTour(root.current!, tour), [tour]);
  const n = tour.scenes.length;
  return (
    <div className="at" ref={root}>
      <div className="chat at-window" role="img" aria-label={tour.label}>
        <div className="chat-chrome">
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
          <span className="chat-title">{title}</span>
        </div>
        {/* Every question in one place: the window is as tall as the longest answer, so nothing moves. */}
        <div className="chat-body at-body" aria-hidden="true">
          {tour.scenes.map((scene, i) => (
            <div className={`at-turn${i ? "" : " at-first"}`} key={scene.id}>
              <p className="chat-bubble chat-user">{scene.question}</p>
              <p className="at-tool">
                <span className="at-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="at-tick">✓</span>
                <span className="at-tool-text">
                  <span className="at-reading">{scene.tool[0]}</span>
                  <span className="at-read">{scene.tool[1]}</span>
                </span>
              </p>
              <div className="chat-bubble chat-assistant">
                {scene.answer.map((line) => (
                  <p className="at-line" key={line.text}>
                    {line.name ? <strong>{line.name}: </strong> : null}
                    {marked(line.text)}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <span className="ht-paused" aria-hidden="true">
          {tour.paused}
        </span>
      </div>
      <div className="ht-controls">
        <button type="button" className="ht-play" aria-label={tour.pause} />
        <nav className="ht-timeline" aria-label={tour.sections} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {tour.scenes.map((scene) => (
            <button type="button" className="ht-seg" key={scene.id}>
              <span className="ht-bar">
                <i />
              </span>
              <span className="ht-lbl">{scene.tab}</span>
            </button>
          ))}
        </nav>
      </div>
      <p className="ht-caption" aria-hidden="true">
        {tour.scenes[0].caption}
      </p>
    </div>
  );
}

function buildTour(host: HTMLElement, tour: AssistantTourText): () => void {
  const frame = host.querySelector<HTMLElement>(".at-window")!;
  const turns = [...host.querySelectorAll<HTMLElement>(".at-turn")];
  host.classList.add("at-live");

  // The turn on show; a new question takes the last one's place, which goes up and out.
  let shown: HTMLElement | null = null;
  const switchTurn = (turn: HTMLElement) => {
    const tl = timeline();
    turns.forEach((t) => {
      if (t !== turn && t !== shown) gsap.set(t, { autoAlpha: 0 });
    });
    if (shown && shown !== turn) {
      tl.to(shown, { autoAlpha: 0, y: -28, duration: 0.4, ease: "power2.in" }, 0);
      tl.set(turn, { autoAlpha: 1, y: 0 }, 0.42);
    } else gsap.set(turn, { autoAlpha: 1, y: 0 });
    shown = turn;
    return tl;
  };

  const steps: TourStep[] = tour.scenes.map((scene, i) => {
    const turn = turns[i];
    const q = <T extends Element>(sel: string) => [...turn.querySelectorAll<T>(sel)];
    const [ask] = q<HTMLElement>(".chat-user");
    const [tool] = q<HTMLElement>(".at-tool");
    const [dots] = q<HTMLElement>(".at-dots"), [tick] = q<HTMLElement>(".at-tick");
    const [reading] = q<HTMLElement>(".at-reading"), [read] = q<HTMLElement>(".at-read");
    const [answer] = q<HTMLElement>(".chat-assistant");
    const lines = q<HTMLElement>(".at-line");
    // Timings: the question, Wilma read, then the answer a line at a time, its highlights drawn as each line lands.
    const asked = 0, reads = 0.7, done = 2.0, answers = 2.3, each = 0.55;
    const end = answers + 0.2 + lines.length * each;
    return {
      id: scene.id,
      heads: [[0, scene.caption]],
      still: end + 0.5,
      enter: () => switchTurn(turn),
      reset() {
        gsap.set(ask, { autoAlpha: 0, y: 14, scale: 0.97, transformOrigin: "100% 100%" });
        gsap.set(tool, { autoAlpha: 0, y: 8 });
        gsap.set([dots, reading], { autoAlpha: 1 });
        gsap.set([tick, read], { autoAlpha: 0 });
        gsap.set(answer, { autoAlpha: 0, y: 12 });
        gsap.set(lines, { autoAlpha: 0, y: 10 });
        gsap.set(turn.querySelectorAll(".at-mark"), { backgroundSize: "0% 45%" });
      },
      build(tl, t) {
        tl.to(ask, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: "expo.out" }, t + asked);
        tl.to(tool, { autoAlpha: 1, y: 0, duration: 0.35, ease: "expo.out" }, t + reads);
        tl.to([dots, reading], { autoAlpha: 0, duration: 0.2 }, t + done);
        tl.to([tick, read], { autoAlpha: 1, duration: 0.3 }, t + done + 0.1);
        tl.to(answer, { autoAlpha: 1, y: 0, duration: 0.45, ease: "expo.out" }, t + answers);
        lines.forEach((line, k) => {
          const at = t + answers + 0.2 + k * each;
          tl.to(line, { autoAlpha: 1, y: 0, duration: 0.4, ease: "expo.out" }, at);
          const marks = line.querySelectorAll(".at-mark");
          if (marks.length) tl.to(marks, { backgroundSize: "100% 45%", duration: 0.5, ease: "power2.inOut", stagger: 0.15 }, at + 0.35);
        });
        tl.to({}, { duration: 2.6 }, t + end);
      },
    };
  });

  const stop = playTour(host, {
    steps,
    frame,
    labels: tour,
    transients: [],
    // The words are in the page already: only the fonts, so lines don't move once they're laid out.
    ready: document.fonts ? document.fonts.ready.then(() => undefined) : Promise.resolve(),
    firstFromStill: true,
    name: "__assistantTour",
  });

  return () => {
    stop();
    host.classList.remove("at-live");
    gsap.killTweensOf(turns);
    gsap.set(turns, { clearProps: "all" });
    turns.forEach((turn) => gsap.set(turn.querySelectorAll("*"), { clearProps: "all" }));
  };
}
