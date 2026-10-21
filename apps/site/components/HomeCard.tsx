import Image from "next/image";
import { homeCopy, homeRelease } from "../lib/home";
import type { Lang } from "../lib/i18n";

/** WilmAI Home on the front page: one card after the setup guides, with a picture of the app. */
export default function HomeCard({ lang }: { lang: Lang }) {
  const t = homeCopy[lang].card;
  return (
    <section className="section home-card" aria-labelledby="home-card-title">
      <a className="home-card-shot" href={`/${lang}/home`} tabIndex={-1} aria-hidden="true">
        <Image src={`/home-today-${lang}.png`} alt="" width={1305} height={870} />
      </a>
      <div className="home-card-copy">
        <p className="eyebrow">{t.eyebrow}</p>
        <h2 id="home-card-title">
          WilmAI Home <span className="home-beta">{homeRelease.version} Beta</span>
        </h2>
        <p>{t.text}</p>
        <a className="button secondary small" href={`/${lang}/home`}>{t.link} →</a>
      </div>
    </section>
  );
}
