import Image from "next/image";
import type { Metadata } from "next";
import { Footer, TopBar } from "../../../components/SiteChrome";
import { KeyVisual } from "../../../components/KeyVisual";
import { FirstStartVisual } from "../../../components/FirstStartVisual";
import { GITHUB_URL, githubStars } from "../../../lib/github-stars";
import { homeCopy, homeRelease, macDownload, windowsDownload } from "../../../lib/home";
import { dictionaries, isLang, type Lang } from "../../../lib/i18n";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang: requested } = await params;
  const lang: Lang = isLang(requested) ? requested : "en";
  const { title, description } = homeCopy[lang].meta;
  return {
    title,
    description,
    alternates: { canonical: `/${lang}/home`, languages: { en: "/en/home", fi: "/fi/home", "x-default": "/en/home" } },
    openGraph: { title, description, url: `/${lang}/home`, images: [{ url: `/home-today-${lang}.png`, width: 2610, height: 1740, alt: homeCopy[lang].hero.sample }] },
    twitter: { title, description, images: [`/home-today-${lang}.png`] }
  };
}

/** WilmAI Home, the desktop app: what it is, why it exists, and its download. */
export default async function WilmAIHomePage({ params }: Props) {
  const { lang: requested } = await params;
  const lang: Lang = isLang(requested) ? requested : "en";
  const t = homeCopy[lang];
  const stars = await githubStars({ signal: AbortSignal.timeout(5000) }).catch(() => null);
  const beta = <span className="home-beta">{homeRelease.version} Beta</span>;

  return (
    <main>
      <TopBar lang={lang} stars={stars} section="/home" />
      <a className="home-back" href={`/${lang}`}>← {t.back}</a>

      <section className="hero">
        <p className="taped-note">{t.hero.tapedNote}</p>
        <h1>
          WilmAI <span className="marker">Home</span>
        </h1>
        <details className="disclaimer">
          <summary>{t.hero.disclaimerShort}</summary>
          <p>{t.hero.disclaimer}</p>
        </details>
        <p className="home-tagline">{t.hero.tagline}</p>
        <p className="hero-sub">{t.hero.sub}</p>
        <div className="hero-actions">
          <a className="button primary" href="#download">{t.hero.download} ↓</a>
          <a className="button secondary" href="#features">{t.hero.more}</a>
        </div>
        <p className="home-requirements">{t.hero.requirements}</p>
        <figure className="home-preview">
          {/* The app in its light theme with the sample family; how to retake it is in the site's README. */}
          <Image src={`/home-today-${lang}.png`} alt={t.hero.sample} width={1305} height={870} priority />
          <figcaption>{t.hero.sample}</figcaption>
        </figure>
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">{t.why.eyebrow}</p>
          <h2>{t.why.title}</h2>
        </div>
        <div className="home-story">
          {t.why.lines.map((line) => <p key={line}>{line}</p>)}
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-head">
          <p className="eyebrow">{t.features.eyebrow}</p>
          <h2>{t.features.title}</h2>
        </div>
        <div className="cards">
          {t.features.items.map((item) => (
            <div className={`note note-${item.color}`} key={item.title}>
              <h3>
                {item.title}
                {item.soon ? <span className="home-soon">{item.soon}</span> : null}
              </h3>
              <p className="home-note-body">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="ai">
        <div className="section-head">
          <p className="eyebrow">{t.ai.eyebrow}</p>
          <h2>{t.ai.title}</h2>
        </div>
        <p className="lead">{t.ai.lead}</p>
        <div className="home-choices">
          {t.ai.choices.map((choice, i) => (
            <article className={`home-choice home-choice-${["off", "openai", "local"][i]}`} key={choice.title}>
              <span className="home-choice-badge">{choice.badge}</span>
              <h3>{choice.title}</h3>
              <p>{choice.body}</p>
              <p className="home-choice-detail">{choice.detail}</p>
              {choice.link ? <a className="home-choice-link" href={choice.link.href}>{choice.link.label} ↓</a> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="openai-key">
        <div className="section-head">
          <p className="eyebrow">{t.key.eyebrow}</p>
          <h2>{t.key.title}</h2>
        </div>
        <p className="lead">{t.key.lead}</p>
        <ol className="setup-steps numbered home-key-steps">
          {t.key.steps.map((step, i) => (
            <li className="setup-step home-key-step" key={step.title}>
              <span className="step-num" aria-hidden="true">{i + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>
                  {step.body}
                  {step.link ? (
                    <>
                      {" "}
                      <a href={step.link.href} target="_blank" rel="noreferrer">{step.link.label}{"\u00a0"}↗</a>
                    </>
                  ) : null}
                </p>
              </div>
              <KeyVisual kind={step.visual} labels={t.key.visual} />
            </li>
          ))}
        </ol>
        <p className="home-download-note">{t.key.note}</p>
      </section>

      <section className="section" id="beta">
        <div className="section-head">
          <p className="eyebrow">{t.beta.eyebrow}</p>
          <h2>{t.beta.title}</h2>
        </div>
        <ul className="home-list">
          {t.beta.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="home-feedback">
          {t.beta.feedback}{" "}
          <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">{t.beta.link} →</a>
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <p className="eyebrow">{t.faq.eyebrow}</p>
          <h2>{t.faq.title}</h2>
        </div>
        <div className="faq">
          {t.faq.items.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section home-download" id="download">
        <Image src="/wilmai-mascot.png" width={96} height={96} alt="" />
        <h2>{t.get.title}</h2>
        {[
          { name: t.get.mac, detail: t.get.macDetail, url: macDownload },
          { name: t.get.windows, detail: t.get.windowsDetail, url: windowsDownload }
        ].map((installer) => (
          <div className="home-installer" key={installer.name}>
            <div>
              <h3>{installer.name} {beta}</h3>
              <p>{installer.detail}</p>
            </div>
            {installer.url ? (
              <a className="button primary" href={installer.url}>{t.hero.download} ↓</a>
            ) : (
              <span className="button secondary is-disabled" aria-disabled="true">{t.hero.coming}</span>
            )}
          </div>
        ))}
        <p>{t.get.includes}</p>
        <p>{t.get.macNote}</p>
        <p>{t.get.windowsNote}</p>
        <div className="first-starts">
          <FirstStartVisual kind="mac" title={t.get.firstMac} />
          <FirstStartVisual kind="windows" title={t.get.firstWindows} />
        </div>
        {macDownload && windowsDownload ? null : <p className="home-download-note">{t.get.pending}</p>}
        <p className="home-download-note">
          {t.get.others} <a href={`/${lang}#quickstart`}>{t.get.cliLink}</a>
        </p>
      </section>

      <section className="closing">
        <p className="eyebrow">{t.closing.eyebrow}</p>
        <p className="closing-text">{t.closing.text}</p>
        <p className="closing-signature">{t.closing.signature}</p>
        <a className="button primary" href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">
          {t.closing.button}
        </a>
      </section>

      <Footer t={dictionaries[lang]} lang={lang} />
    </main>
  );
}
