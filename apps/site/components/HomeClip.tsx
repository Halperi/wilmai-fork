"use client";

import { useEffect, useRef } from "react";

/**
 * A short silent loop of the app with the sample family (how it's recorded: the site's README). It plays only while
 * it's on screen, and not at all for someone who asks for less motion or to save data: they see its first frame.
 */
export function HomeClip({ lang, label }: { lang: string; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!v || saveData || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already in view when the page opens (the usual case): start now rather than wait for the observer's first word.
    const box = v.getBoundingClientRect();
    if (box.top < innerHeight && box.bottom > 0) void v.play().catch(() => {});
    const seen = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void v.play().catch(() => {});
      else v.pause();
    });
    seen.observe(v);
    return () => seen.disconnect();
  }, []);
  return (
    <video ref={video} className="home-clip" muted loop playsInline preload="metadata" poster={`/home-clip-${lang}.jpg`} width={1280} height={800} aria-label={label}>
      <source src={`/home-clip-${lang}.mp4`} type="video/mp4" />
      <source src={`/home-clip-${lang}.webm`} type="video/webm" />
    </video>
  );
}
