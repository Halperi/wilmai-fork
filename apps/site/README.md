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
- `public/home-today-en.png`, `public/home-today-fi.png` — the app's Today in its light theme with the
  made-up sample family, never real children's data. To retake them: run the app in a browser
  (`pnpm dev` in `experiments/wilma-app`) and open it in a fresh browser profile with the light colour
  scheme, the language's locale, Helsinki's time zone and 2× pixels, with the clock frozen on a school-day
  morning (Playwright's `page.clock.setFixedTime`, e.g. a Wednesday at 09:40): the sample family is built
  around today, so a weekend shows no school. Choose the sample family, then No AI in Settings (so the
  menu's "Choose AI" cue is gone); open Today in a 1305×950 window and capture the top 1305×870 (that
  leaves out the menu's "Only in this browser" corner). The banner's `home-thumb-*.png` are the same
  shots at 480×320 (`sips -z 320 480`).
- `public/_headers` — security and cache headers
- `public/_redirects` — `/get/claude` (the Claude Desktop extension) and `/changes` (release notes, linked from the update notices)
- `public/og-en.png`, `public/og-fi.png` — the share images (what a link shows in WhatsApp, Facebook and the like), made from `og/card.html`: open it with `?lang=en` or `?lang=fi` at 1200×630 and screenshot it. Its copy follows the hero; update both together
- `worker/index.ts` — sends `/` to `/en` or `/fi` (the EN/FI choice, else the browser's language), and `/home` and `/app` to the same language's Home page, and answers `/api/stats`: the CLI's npm downloads (the counter in the hero, `lib/npm-downloads.ts`) and the repository's GitHub stars (the chip in the top bar, `lib/github-stars.ts`), plus `/api/badge/downloads`, the download count as a shields.io endpoint badge for the GitHub README. A cron job fetches both once a day (04:00 UTC) and keeps them in the `STATS` KV namespace (`wilmai-site-stats`); the page starts with the numbers from build time. A failed fetch keeps the last value, is logged, and fails that day's cron run: see it in Workers Logs and Workers Issues (the Worker's Observability tab), which can alert through an Issues automation
- `wrangler.jsonc` — the Cloudflare Worker (account Wilm.ai)

Home's update feed is one JSON file, `/app/latest.json`, added only after a signed build and an
upgrade from one version to the next are verified. `/home` and `/app` (the app's link to its
page) go to `/en/home` or `/fi/home` like `/` does. See
`experiments/wilma-app/docs/local-releases.md` for the Mac release process.

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
