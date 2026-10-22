import type { Metadata } from "next";
import { Footer, TopBar } from "../../../components/SiteChrome";
import { GITHUB_URL, githubStars } from "../../../lib/github-stars";
import { privacyCopy } from "../../../lib/privacy";
import { dictionaries, isLang, type Lang } from "../../../lib/i18n";

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang: requested } = await params;
  const lang: Lang = isLang(requested) ? requested : "en";
  const { title, description } = privacyCopy[lang].meta;
  return {
    title,
    description,
    alternates: { canonical: `/${lang}/privacy`, languages: { en: "/en/privacy", fi: "/fi/privacy", "x-default": "/en/privacy" } },
    openGraph: { title, description, url: `/${lang}/privacy` },
    twitter: { title, description }
  };
}

/** What WilmAI, the site and WilmAI Home do with data; the copy is in lib/privacy.ts. */
export default async function PrivacyPage({ params }: Props) {
  const { lang: requested } = await params;
  const lang: Lang = isLang(requested) ? requested : "en";
  const t = privacyCopy[lang];
  const stars = await githubStars({ signal: AbortSignal.timeout(5000) }).catch(() => null);

  return (
    <main>
      <TopBar lang={lang} stars={stars} section="/privacy" />
      <a className="home-back" href={`/${lang}`}>← {t.back}</a>

      <section className="privacy-head">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <p className="privacy-lead">{t.lead}</p>
        <p className="privacy-updated">{t.updated}</p>
      </section>

      {t.sections.map((section) => (
        <section className="section privacy-section" id={section.id} key={section.id}>
          <div className="section-head">
            <h2>{section.title}</h2>
          </div>
          {section.paragraphs.map((p) => <p key={p}>{p}</p>)}
        </section>
      ))}

      <section className="section privacy-section" id="questions">
        <div className="section-head">
          <h2>{t.questions.title}</h2>
        </div>
        <p>
          {t.questions.text}{" "}
          <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">{t.questions.link} →</a>
        </p>
      </section>

      <section className="section privacy-section" id="changes">
        <div className="section-head">
          <h2>{t.changes.title}</h2>
        </div>
        <p>
          {t.changes.text}{" "}
          <a href={`${GITHUB_URL}/commits/main/apps/site/lib/privacy.ts`} target="_blank" rel="noreferrer">{t.changes.link} →</a>
        </p>
      </section>

      <Footer t={dictionaries[lang]} lang={lang} />
    </main>
  );
}
