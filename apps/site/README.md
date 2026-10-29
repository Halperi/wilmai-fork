# wilm.ai

The WilmAI website: bilingual agent/CLI pages (`/en`, `/fi`) and experimental
WilmAI Home pages (`/en/home`, `/fi/home`), built with Next.js as
static files and served by Cloudflare Workers.

- `app/`, `components/`, `lib/` — the page; all copy is in `lib/i18n.tsx` and `lib/agents.ts`
- `lib/home.ts`, `lib/home-release.json` — WilmAI Home's page copy (both languages) and its downloads: a
  Mac build for Apple Silicon (with local AI included) and a Windows build, from the `home-v<version>`
  GitHub release. A null URL shows "Download coming soon". `public/app/latest.json` is the app's update
  feed: the version there is what the installed apps compare themselves with.
- `components/HomeCard.tsx` — Home's card on the front page, after the setup guides; with the top bar's
  "WilmAI Home" link and an FAQ answer, that's how people find it. The front page's hero stays about
  assistants.
- `public/home-today-*.png`, `public/home-student-*.png`, `public/home-parent-*.png` — the app in its light theme
  with the made-up sample family, never real children's data: Today for the hero (the whole page, no scroll
  bar), and for the two-column section a student's Today (Kiia only) and a parent's Week (both children). To
  retake them: run the app in a browser (the `wilma-app-review` launch config, or `pnpm dev` in `apps/home`) and
  open it in a fresh browser profile with the light colour scheme, the language's locale, Helsinki's time zone
  and 2× pixels, with the clock frozen on a school-day morning (Playwright's `page.clock.setFixedTime`, e.g.
  Wednesday 21 Oct 2026 at 09:40): the sample family is built around today, so a weekend shows no school.
  Choose "Look around with a sample family" (never a saved login), then No AI in Settings (so the menu's
  "Choose AI" cue is gone), and hide the menu's corner (`.nav-foot`, `.nav-version`: in a browser it says
  "Only in this browser"). In a window 1305 wide and as tall as the page (`document.documentElement.scrollHeight`):
  Today whole (1318 now), and the Week's top 816. For the student, set `viewAs: "student"` in the app's saved
  `local` state (IndexedDB `keyval-store`; Settings hides "Who uses this account" for the sample family),
  reload, pick Kiia, and take Today's top 816. The page's `<Image>` sizes and the Open Graph size follow the
  pictures. The banner's `home-thumb-*.png` are Today's top 1305×870 at 480×320, and the main README's
  `assets/readme-home-top.png` its top 1305×372 at 2×.
- `public/home-tour/<lang>/*.webp`, `lib/home-tour.json` — the hero's tour (components/HomeTour.tsx), made the
  way the product tours in Antti's decks are: screens of the app put in motion with GSAP, in code, so it stays
  up to date with a new capture instead of a new recording. `pnpm --filter @wilm-ai/site capture:home-tour`
  (scripts/capture-home-tour.mjs) starts the app's dev server and takes them with Google Chrome the same way as the
  screenshots (sample family, clock frozen, No AI, the menu's foot left out), 1305×816 at 2×: Today (the whole
  page), the inbox where messages and bulletins mix with an answer being written, ⌘K search over Today, the
  Week with a lesson's day open beside it, Grades. It writes each screen at 2×
  (lossless) and 1× (phones), and in `lib/home-tour.json` where each screen's parts are (Today's school days and
  Needs you, the inbox's rows and the answer, the search menu's field and results, the week's days and the open
  day's schedule, the grade rows), which the
  tour moves and lifts out as cards. A line under the window says what each part shows (`hero.tour.captions` in
  `lib/home.ts`; on phones every caption must fit two lines, or the window moves). After a capture, check each section's still (`window.__homeTour.showStill(i)`
  in the browser): a part that moved in the app moves in the tour with it, but a new part needs a line in the tour.
- `public/_headers` — security and cache headers
- `public/_redirects` — `/get/claude` (the Claude Desktop extension) and `/changes` (release notes, linked from the update notices)
- `public/og-en.png`, `public/og-fi.png` — the share images (what a link shows in WhatsApp, Facebook and the like), made from `og/card.html`: open it with `?lang=en` or `?lang=fi` at 1200×630 and screenshot it. Its copy follows the hero; update both together
- `worker/index.ts` — sends `/` to `/en` or `/fi` (the EN/FI choice, else the browser's language), and `/home` and `/app` to the same language's Home page, and answers `/api/stats`: the CLI's npm downloads (the counter in the hero, `lib/npm-downloads.ts`) and the repository's GitHub stars (the chip in the top bar, `lib/github-stars.ts`), plus `/api/badge/downloads`, the download count as a shields.io endpoint badge for the GitHub README. A cron job fetches both once a day (04:00 UTC) and keeps them in the `STATS` KV namespace (`wilmai-site-stats`); the page starts with the numbers from build time. A failed fetch keeps the last value, is logged, and fails that day's cron run: see it in Workers Logs and Workers Issues (the Worker's Observability tab), which can alert through an Issues automation
- `wrangler.jsonc` — the Cloudflare Worker (account Wilm.ai)

Home's update feed is one JSON file, `/app/latest.json`, added only after a signed build and an
upgrade from one version to the next are verified. `/home` and `/app` (the app's link to its
page) go to `/en/home` or `/fi/home` like `/` does. See
`apps/home/docs/local-releases.md` for the Mac release process.

## Run locally

```bash
pnpm --filter @wilm-ai/site dev        # Next.js dev server; open /en or /fi
pnpm --filter @wilm-ai/site preview    # the real build on Cloudflare's runtime (wrangler dev)
```

`dev` doesn't apply `_headers`, `_redirects`, the `/` redirect, `/api/stats` or `/api/badge/downloads` (the counters keep the numbers from the build); `preview` does. Before the first daily job has run, `/api/stats` fetches the numbers itself; to run the job by hand, start `wrangler dev --test-scheduled` and open `/cdn-cgi/handler/scheduled`.

GitHub limits anonymous API requests per IP address, and Cloudflare's addresses are shared. If the star count stops updating, give the Worker a GitHub token (a fine-grained token with public read-only access and no permissions): `pnpm --filter @wilm-ai/site exec wrangler secret put GITHUB_TOKEN`.

## Deploy

Cloudflare builds and deploys the site from GitHub (Workers Builds). It's
connected in the dashboard: Workers & Pages → `wilmai-site` → Settings → Build.
Every push to `main` deploys wilm.ai; other branches get their own preview link.
The build settings live in the dashboard, so here they are:

| Setting | Value |
|---|---|
| Git repository | `aikarjal/wilmai`, production branch `main` |
| Root directory | `apps/site` |
| Build command | `pnpm run build` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths | `apps/site/*` |
| Preview builds | on: other branches and pull requests get a public preview link on workers.dev |
| Build cache | on: keeps pnpm downloads and Next's build cache between builds; clear it there if a build acts oddly |

By hand, from this computer (needs `wrangler login` with access to the Wilm.ai account):

```bash
pnpm --filter @wilm-ai/site run deploy
```

wilm.ai is the Worker's custom domain (`routes` in `wrangler.jsonc`). www.wilm.ai →
wilm.ai is a redirect rule on the Cloudflare zone (not in this repository): Rules →
Redirect Rules, "Redirect from WWW to root", `https://www.*` → `https://${1}`,
301, query string kept. It needs the `www` DNS record to stay proxied.
