import release from "./home-release.json";
import type { Lang } from "./i18n";

/**
 * WilmAI Home's downloads, one per platform. A URL is filled in only after that
 * platform's release has been built and tried; until then the page says the
 * download is coming.
 */
export const homeRelease = release;
export const macDownload = release.downloads.find((d) => d.id === "macos-arm64")?.url ?? null;
export const windowsDownload = release.downloads.find((d) => d.id === "windows-x64")?.url ?? null;

interface Feature { title: string; body: string; soon?: string; color: "yellow" | "teal" | "blue" | "pink" }
interface Choice { title: string; badge: string; body: string; detail: string; link?: { label: string; href: string } }
interface KeyStep { title: string; body: string; visual: "signin" | "credit" | "key" | "app"; link?: { label: string; href: string } }
/** Words in the key steps' sketches (components/KeyVisual.tsx) that aren't OpenAI's own labels. */
export interface KeyVisualLabels { window: string; off: string; local: string; turnOn: string; once: string; reloadOff: string }
interface Faq { q: string; a: string }

export interface HomeCopy {
  meta: { title: string; description: string };
  back: string;
  hero: {
    tapedNote: string;
    disclaimerShort: string;
    disclaimer: string;
    tagline: string;
    sub: string;
    download: string;
    coming: string;
    more: string;
    requirements: string;
    sample: string;
  };
  why: { eyebrow: string; title: string; lines: string[] };
  features: { eyebrow: string; title: string; items: Feature[] };
  ai: { eyebrow: string; title: string; lead: string; choices: Choice[] };
  /** Getting an OpenAI API key, for someone who has never made one. Facts from OpenAI's help centre, 21 October 2026. */
  key: { eyebrow: string; title: string; lead: string; steps: KeyStep[]; note: string; visual: KeyVisualLabels };
  beta: { eyebrow: string; title: string; items: string[]; feedback: string; link: string };
  faq: { eyebrow: string; title: string; items: Faq[] };
  get: {
    title: string;
    mac: string;
    macDetail: string;
    includes: string;
    /** macOS blocks an app that isn't notarized: how to open it the first time. */
    macNote: string;
    windows: string;
    windowsDetail: string;
    /** Windows warns about an unsigned installer: what to click, and what a school computer may do. */
    windowsNote: string;
    /** Captions of the first-start sketches (components/FirstStartVisual.tsx). */
    firstMac: string;
    firstWindows: string;
    /** The two Windows steps' labels: the browser's download warning (Edge), then the first start. */
    windowsSteps: { download: string; start: string };
    pending: string;
    others: string;
    cliLink: string;
  };
  closing: { eyebrow: string; text: string; signature: string; button: string };
  /** The banner across the very top of the front page. `more` and `cta` are left out on phones. */
  announce: { badge: string; text: string; more: string; cta: string };
  /** The card about Home on the front page, after the setup guides. */
  card: { eyebrow: string; text: string; link: string };
}

const en: HomeCopy = {
  meta: {
    title: "WilmAI Home — Wilma, rethought with AI built in",
    description:
      "A desktop app for students and parents: Wilma in one place, a notification when something needs you, and optional AI that picks out what matters. Beta, for Mac and Windows."
  },
  back: "WilmAI for AI assistants",
  hero: {
    tapedNote: "A desktop app for students and parents. Beta.",
    disclaimerShort: "Independent project, not affiliated with Visma",
    disclaimer:
      "WilmAI Home is an independent hobby project by a parent. It is not affiliated with, endorsed by, or connected to Visma or the official Wilma service.",
    tagline: "Wilma, rethought with AI built in.",
    sub: "Messages, timetables, homework, exams and grades in one app, a notification when something new needs you, and AI that picks out what matters.",
    download: "Download",
    coming: "Download coming soon",
    more: "What it does",
    requirements: "For Mac (Apple Silicon, macOS 13.3 or later) and Windows 10 or 11. Free.",
    sample: "The app with a made-up sample family."
  },
  why: {
    eyebrow: "why it exists",
    title: "What would Wilma be like with AI built in?",
    lines: [
      "Everything is in Wilma. Finding what matters takes digging.",
      "WilmAI Home reads each new message for you and puts what needs you first.",
      "Then you can act on it right there: reply, sign up, report an absence.",
      "I built it over a weekend. My family uses it every day."
    ]
  },
  features: {
    eyebrow: "for the whole family",
    title: "What it does",
    items: [
      { title: "What needs you, first", body: "AI reads each new message, bulletin and teacher's note, picks out what needs you and by when, and highlights it. The rest is there when you want it.", color: "yellow" },
      { title: "Notifications", body: "A notification when something new needs you, and the evening before a deadline. The app keeps checking from the menu bar when its window is closed. On Mac for now.", color: "teal" },
      { title: "Stays signed in", body: "Wilma signs you out often. If you want, the app signs itself back in, so notifications keep coming.", color: "blue" },
      { title: "Reply and sign up", body: "Answer teachers, write new messages, sign up for parents' evenings and report an absence, without opening Wilma.", color: "pink" },
      { title: "All of school, side by side", body: "Timetables, homework, exams, grades and teachers' notes for all your children in one place.", color: "yellow" },
      { title: "Google Calendar", soon: "coming next", body: "Exams, events and deadlines straight into your family's shared calendar.", color: "teal" }
    ]
  },
  ai: {
    eyebrow: "AI is optional",
    title: "Three ways to use it",
    lead: "You choose in Settings, and you can change your mind any time. The app starts with no AI.",
    choices: [
      {
        title: "No AI",
        badge: "Default",
        body: "Everything Wilma has, in one app. But nothing picks out what needs you or by when, which is most of what the app is for, and notifications come only for what Wilma itself flags, like sign-ups.",
        detail: "Free"
      },
      {
        title: "OpenAI",
        badge: "Recommended",
        body: "Fast and accurate. You add your own OpenAI API key, so it runs with your permission and on your account: OpenAI bills you directly, usually tens of cents a month for a family. You set a monthly limit in the app.",
        detail: "Your own API key · tens of cents a month",
        link: { label: "How to get a key", href: "#openai-key" }
      },
      {
        title: "Local AI",
        badge: "On your Mac",
        body: "Everything is read on your Mac, and nothing goes to an AI service. But it's a big download, and it works the computer hard. It's also slower than OpenAI and makes more mistakes, especially with dates.",
        detail: "Apple Silicon with 16 GB of memory · 9.1 GB download"
      }
    ]
  },
  key: {
    eyebrow: "if you choose OpenAI",
    title: "How to get an OpenAI API key",
    lead: "An API key is like a password that lets the app use OpenAI on your account. Getting one takes about five minutes and a payment card. A ChatGPT subscription doesn't cover it: OpenAI bills its API separately.",
    steps: [
      {
        title: "Sign in to OpenAI's developer site",
        body: "Use your ChatGPT login if you have one, or create an account.",
        visual: "signin",
        link: { label: "platform.openai.com", href: "https://platform.openai.com/" }
      },
      {
        title: "Add $5 of credit",
        body: "Under Billing, add a payment card and buy credit. $5 is the smallest amount, and for a family it usually lasts many months; unused credit expires after a year. Turn off auto-reload, which is on at first, so nothing more is charged without you.",
        visual: "credit",
        link: { label: "Billing", href: "https://platform.openai.com/account/billing" }
      },
      {
        title: "Create a key",
        body: "On the API keys page, choose Create new secret key, name it WilmAI Home, and copy it. OpenAI shows the whole key only once. Leave Permissions on All (a read-only key won't work), and if it asks when the key expires, pick the longest time or none; an expired key just needs a new one, made the same way.",
        visual: "key",
        link: { label: "API keys", href: "https://platform.openai.com/api-keys" }
      },
      {
        title: "Paste it into the app",
        body: "In WilmAI Home, open Settings, choose OpenAI, paste the key and choose Turn on. The app tries it right away, keeps it on your computer, and sends it only to OpenAI.",
        visual: "app"
      }
    ],
    note: "If the key ever gets out, delete it on the same page and make a new one. OpenAI's Billing page shows what you've spent, and the app stops at the monthly limit you set.",
    visual: { window: "WilmAI Home · Settings", off: "No AI", local: "Local AI", turnOn: "Turn on", once: "The whole key is shown only once: copy it now.", reloadOff: "Turn auto-reload off." }
  },
  beta: {
    eyebrow: "it's a beta",
    title: "Before you try it",
    items: [
      "It's a beta, and I built it on my own. Some things are missing, and some will break.",
      "For Mac (Apple Silicon, M1 or newer, and macOS 13.3 or later) and for Windows 10 or 11. Linux may come later.",
      "On Windows, notifications and local AI aren't there yet.",
      "To check Wilma and notify you, the app needs to be running and the computer awake. Closing the window keeps it in the menu bar, or on Windows in the taskbar's notification area.",
      "AI can misread things, dates especially. Check anything important in the message itself.",
      "New versions arrive in the app, and you choose when to install them."
    ],
    feedback: "Found a bug? When you report it, please leave out messages, children's names and logins.",
    link: "Report a problem on GitHub"
  },
  faq: {
    eyebrow: "good questions",
    title: "FAQ",
    items: [
      {
        q: "Do I need to use AI?",
        a: "No. The app starts without AI and shows everything Wilma has. Without AI, though, nothing picks out what needs you or by when, and notifications come only for what Wilma itself flags, like sign-ups. You can turn AI on or off any time in Settings."
      },
      {
        q: "Can I run local AI?",
        a: "If your Mac has Apple Silicon (M1 or newer) and at least 16 GB of memory, yes. Choose Local AI in Settings, and the app downloads the models once, 9.1 GB. It works the Mac hard, and it's slower and less accurate than OpenAI, especially with dates. On other computers the choice is greyed out."
      },
      {
        q: "Can students use it?",
        a: "Yes. Sign in with the student's own Wilma account and choose “A student”. The app then reads things from the student's side: what they need to do themselves, not what's meant for their guardians. Sign-ups and absence reports stay with the guardians."
      },
      {
        q: "What does it cost?",
        a: "The app is free. If you choose OpenAI, OpenAI bills your own key: in my family it has been tens of cents a month, even with me testing it all the time. The app stops at a monthly limit you set, from 50 cents to $3."
      },
      {
        q: "What does OpenAI see?",
        a: "Only if you choose OpenAI: one message, bulletin or note at a time, with your children's first names and classes so it can tell who it's about. Your Wilma password never goes there. With local AI or no AI, nothing goes to an AI service."
      },
      {
        q: "Where is my data?",
        a: "On your computer. Messages, timetables and AI answers are stored in the app so it opens instantly. There is no WilmAI server. Your Wilma password goes only to your school's Wilma; the app can remember it on your computer, scrambled, so signing in again takes one click."
      },
      {
        q: "Why isn't it a website?",
        a: "I'd like it to be. But a website can talk to Wilma only if Visma allows it, and I don't have Visma's permission, so browsers block those requests. An app on your own computer can talk to Wilma directly, the way your browser does when you use Wilma, and your login stays with you."
      },
      {
        q: "Why not a phone app?",
        a: "I'd like to make one, and maybe I will. But a phone app has to go through the App Store, and Visma could ask for it to be taken down, because it uses Wilma without their permission. A desktop app needs no store. It's my way of showing what a modern Wilma with AI built in could look like."
      },
      {
        q: "How is it different from WilmAI for AI assistants?",
        a: "WilmAI for assistants lets Claude, ChatGPT or another assistant read Wilma for you, and it only reads. WilmAI Home is an app you use yourself, with AI built in, and it can also send replies, sign-ups and absence reports. You can use either, or both."
      }
    ]
  },
  get: {
    title: "Download WilmAI Home",
    mac: "Mac",
    macDetail: "Apple Silicon (M1 or newer) · macOS 13.3 or later",
    includes: "The Mac download includes optional local AI. Its 9.1 GB of models download only if you turn local AI on.",
    macNote: "The Mac app isn't signed by Apple yet, so macOS stops it the first time: choose Done, then open System Settings → Privacy & Security and choose Open Anyway for WilmAI Home. After that it opens normally.",
    windows: "Windows",
    windowsDetail: "Windows 10 or 11 · 64-bit",
    windowsNote: "The Windows installer isn't signed yet, so your browser may hold the download as not commonly downloaded. In Edge, point at the download and choose … → Keep, then Show more → Keep anyway. Windows warns once more before the first start: choose More info, then Run anyway. It installs for you only, with no administrator rights, but a school computer's settings may still block it.",
    firstMac: "On a Mac, the first time",
    firstWindows: "On Windows, the first time",
    windowsSteps: { download: "Downloading, in Edge", start: "Starting it" },
    pending: "The first downloads are on their way. They'll be here when they're ready.",
    others: "No Linux version yet.",
    cliLink: "WilmAI for AI assistants works there →"
  },
  closing: {
    eyebrow: "a note from me",
    text: "WilmAI Home is my experiment in what Wilma could be. It's a beta, and all feedback helps: what breaks, what's confusing, and what you'd want next.",
    signature: "— Antti",
    button: "Give feedback on GitHub"
  },
  announce: { badge: "New", text: "WilmAI Home", more: ": a desktop app for students and parents, with AI built in", cta: "See the app" },
  card: {
    eyebrow: "new: a desktop app",
    text: "Rather have an app of your own? WilmAI Home is Wilma rethought with AI built in, for students and parents: everything in one place, and a notification when something needs you. In beta, for Mac and Windows.",
    link: "Meet WilmAI Home"
  }
};

const fi: HomeCopy = {
  meta: {
    title: "WilmAI Home — uudenlainen Wilma, johon tekoäly on rakennettu sisään",
    description:
      "Työpöytäsovellus oppilaille ja vanhemmille: Wilma yhdessä paikassa, ilmoitus, kun jokin vaatii sinua, ja vapaaehtoinen tekoäly, joka poimii olennaisen. Beta, Macille ja Windowsille."
  },
  back: "Tekoälyavustajien WilmAI",
  hero: {
    tapedNote: "Työpöytäsovellus oppilaille ja vanhemmille. Beta.",
    disclaimerShort: "Itsenäinen projekti, ei liity Vismaan",
    disclaimer:
      "WilmAI Home on vanhemman tekemä itsenäinen harrastusprojekti. Se ei ole Visman tai virallisen Wilma-palvelun tekemä, tukema tai hyväksymä.",
    tagline: "Uudenlainen Wilma, johon tekoäly on rakennettu sisään.",
    sub: "Viestit, lukujärjestykset, läksyt, kokeet ja arvosanat yhdessä sovelluksessa, ilmoitus, kun jokin uusi vaatii sinua, ja tekoäly, joka poimii olennaisen.",
    download: "Lataa",
    coming: "Lataus tulossa pian",
    more: "Mitä se tekee",
    requirements: "Macille (Apple Silicon, macOS 13.3 tai uudempi) ja Windows 10:lle tai 11:lle. Maksuton.",
    sample: "Sovellus kuvitteellisen esimerkkiperheen tiedoilla."
  },
  why: {
    eyebrow: "miksi tämä on olemassa",
    title: "Millainen Wilma olisi, jos tekoäly olisi rakennettu sisään?",
    lines: [
      "Wilmassa on kaikki. Olennaisen löytäminen vaatii kaivamista.",
      "WilmAI Home lukee jokaisen uuden viestin puolestasi ja nostaa ensimmäiseksi sen, mikä vaatii sinua.",
      "Sitten voit hoitaa asian heti: vastata, ilmoittautua tai ilmoittaa poissaolon.",
      "Tein sen viikonlopun aikana. Perheessäni sitä käytetään joka päivä."
    ]
  },
  features: {
    eyebrow: "koko perheelle",
    title: "Mitä se tekee",
    items: [
      { title: "Tärkein ensin", body: "Tekoäly lukee jokaisen uuden viestin, tiedotteen ja opettajan merkinnän, poimii, mikä vaatii sinulta jotain ja mihin mennessä, ja nostaa sen esiin. Muu odottaa, kunnes haluat katsoa.", color: "yellow" },
      { title: "Ilmoitukset", body: "Ilmoitus, kun jokin uusi vaatii sinua, ja määräajan edellisenä iltana. Sovellus tarkistaa Wilmaa valikkoriviltä, vaikka ikkuna olisi kiinni. Toistaiseksi Macilla.", color: "teal" },
      { title: "Pysyy kirjautuneena", body: "Wilma kirjaa ulos usein. Halutessasi sovellus kirjautuu itse takaisin, joten ilmoitukset jatkuvat.", color: "blue" },
      { title: "Vastaa ja ilmoittaudu", body: "Vastaa opettajalle, kirjoita uusi viesti, ilmoittaudu vanhempainiltaan ja ilmoita poissaolo avaamatta Wilmaa.", color: "pink" },
      { title: "Kaikki yhdessä paikassa", body: "Kaikkien lasten lukujärjestykset, läksyt, kokeet, arvosanat ja opettajien merkinnät rinnakkain.", color: "yellow" },
      { title: "Google-kalenteri", soon: "tulossa seuraavaksi", body: "Kokeet, tapahtumat ja määräajat suoraan perheen yhteiseen kalenteriin.", color: "teal" }
    ]
  },
  ai: {
    eyebrow: "tekoäly on vapaaehtoinen",
    title: "Kolme vaihtoehtoa",
    lead: "Valitset asetuksista ja voit vaihtaa milloin tahansa. Aluksi tekoäly ei ole käytössä.",
    choices: [
      {
        title: "Ei tekoälyä",
        badge: "Oletus",
        body: "Kaikki, mitä Wilmassa on, yhdessä sovelluksessa. Mikään ei kuitenkaan poimi, mikä vaatii sinulta jotain ja mihin mennessä, ja juuri sitä varten sovellus on tehty. Ilmoitukset tulevat vain siitä, minkä Wilma itse merkitsee, kuten ilmoittautumisista.",
        detail: "Maksuton"
      },
      {
        title: "OpenAI",
        badge: "Suositeltu",
        body: "Nopea ja tarkka. Lisäät oman OpenAI-avaimesi, joten se toimii sinun luvallasi ja sinun tililläsi: OpenAI laskuttaa suoraan, perheen käytössä yleensä kymmeniä senttejä kuussa. Kuukausirajan asetat sovelluksessa.",
        detail: "Oma API-avain · kymmeniä senttejä kuussa",
        link: { label: "Näin saat avaimen", href: "#openai-key" }
      },
      {
        title: "Paikallinen tekoäly",
        badge: "Omalla Macilla",
        body: "Kaikki luetaan omalla Macillasi, eikä mitään lähetetä tekoälypalveluun. Lataus on kuitenkin iso, ja tekoäly kuormittaa konetta paljon. Se on myös OpenAI:ta hitaampi ja tekee enemmän virheitä, varsinkin päivämäärissä.",
        detail: "Apple Silicon ja 16 Gt muistia · 9,1 Gt:n lataus"
      }
    ]
  },
  key: {
    eyebrow: "jos valitset OpenAI:n",
    title: "Näin saat OpenAI-avaimen",
    lead: "API-avain on kuin salasana, jolla sovellus käyttää OpenAI:ta sinun tililläsi. Sen hankkimiseen menee noin viisi minuuttia, ja tarvitset maksukortin. ChatGPT-tilaus ei kata sitä: OpenAI laskuttaa API-käytön erikseen.",
    steps: [
      {
        title: "Kirjaudu OpenAI:n kehittäjäsivustolle",
        body: "Käytä ChatGPT-tunnuksiasi, jos sinulla on sellaiset, tai luo tili.",
        visual: "signin",
        link: { label: "platform.openai.com", href: "https://platform.openai.com/" }
      },
      {
        title: "Lisää 5 dollaria saldoa",
        body: "Lisää Billing-sivulla maksukortti ja osta saldoa. Pienin summa on 5 dollaria, ja perheen käytössä se riittää yleensä monta kuukautta; käyttämätön saldo vanhenee vuodessa. Kytke pois automaattinen lisäys (auto-reload), joka on aluksi päällä, niin mitään ei veloiteta lisää ilman sinua.",
        visual: "credit",
        link: { label: "Billing", href: "https://platform.openai.com/account/billing" }
      },
      {
        title: "Luo avain",
        body: "Valitse API keys -sivulla Create new secret key, anna nimeksi WilmAI Home ja kopioi avain. OpenAI näyttää koko avaimen vain kerran. Jätä Permissions-kohtaan All (pelkkä lukuoikeus ei toimi), ja jos sivu kysyy vanhenemista, valitse pisin aika tai ei vanhenemista; vanhentuneen tilalle tehdään uusi samalla tavalla.",
        visual: "key",
        link: { label: "API keys", href: "https://platform.openai.com/api-keys" }
      },
      {
        title: "Liitä se sovellukseen",
        body: "Avaa WilmAI Homessa Asetukset, valitse OpenAI, liitä avain ja valitse Ota käyttöön. Sovellus kokeilee avainta heti, säilyttää sen tietokoneellasi ja lähettää sen vain OpenAI:lle.",
        visual: "app"
      }
    ],
    note: "Jos avain joskus päätyy vääriin käsiin, poista se samalla sivulla ja luo uusi. OpenAI:n Billing-sivulta näet, paljonko olet käyttänyt, ja sovellus pysähtyy asettamaasi kuukausirajaan.",
    visual: { window: "WilmAI Home · Asetukset", off: "Ei tekoälyä", local: "Paikallinen", turnOn: "Ota käyttöön", once: "Koko avain näytetään vain kerran: kopioi se heti.", reloadOff: "Kytke auto-reload pois." }
  },
  beta: {
    eyebrow: "beta-versio",
    title: "Ennen kuin kokeilet",
    items: [
      "Tämä on beta, jonka olen tehnyt yksin. Jotain puuttuu vielä, ja jotain menee rikki.",
      "Macille (Apple Silicon, M1 tai uudempi, ja macOS 13.3 tai uudempi) ja Windows 10:lle tai 11:lle. Linux voi tulla myöhemmin.",
      "Windowsissa ilmoituksia ja paikallista tekoälyä ei vielä ole.",
      "Jotta sovellus voi tarkistaa Wilmaa ja ilmoittaa, sen pitää olla käynnissä ja tietokoneen hereillä. Kun suljet ikkunan, sovellus jää valikkoriville, Windowsissa tehtäväpalkin ilmoitusalueelle.",
      "Tekoäly voi lukea asioita väärin, varsinkin päivämääriä. Tarkista tärkeät asiat itse viestistä.",
      "Uudet versiot tulevat sovellukseen, ja päätät itse, milloin asennat ne."
    ],
    feedback: "Löysitkö virheen? Jätä ilmoituksesta pois viestit, lasten nimet ja tunnukset.",
    link: "Kerro ongelmasta GitHubissa"
  },
  faq: {
    eyebrow: "hyviä kysymyksiä",
    title: "UKK",
    items: [
      {
        q: "Pitääkö tekoälyä käyttää?",
        a: "Ei. Sovellus alkaa ilman tekoälyä ja näyttää kaiken, mitä Wilmassa on. Ilman tekoälyä mikään ei kuitenkaan poimi, mikä vaatii sinulta jotain ja mihin mennessä, ja ilmoitukset tulevat vain siitä, minkä Wilma itse merkitsee, kuten ilmoittautumisista. Voit ottaa tekoälyn käyttöön tai pois asetuksista milloin tahansa."
      },
      {
        q: "Voinko käyttää paikallista tekoälyä?",
        a: "Jos Macissasi on Apple Silicon (M1 tai uudempi) ja vähintään 16 Gt muistia, voit. Valitse asetuksista Paikallinen tekoäly, niin sovellus lataa mallit kerran, 9,1 Gt. Se kuormittaa Macia paljon ja on OpenAI:ta hitaampi ja epätarkempi, varsinkin päivämäärissä. Muilla koneilla vaihtoehto näkyy harmaana."
      },
      {
        q: "Voiko oppilas käyttää sitä?",
        a: "Voi. Kirjaudu oppilaan omilla Wilma-tunnuksilla ja valitse Oppilas. Sovellus lukee silloin asiat oppilaan näkökulmasta: mitä hänen pitää itse tehdä, ei sitä, mikä on tarkoitettu huoltajille. Ilmoittautumiset ja poissaoloilmoitukset jäävät huoltajille."
      },
      {
        q: "Mitä se maksaa?",
        a: "Sovellus on maksuton. Jos valitset OpenAI:n, OpenAI laskuttaa omaa avaintasi: perheessäni se on maksanut kymmeniä senttejä kuussa, vaikka olen testannut sitä koko ajan. Sovellus pysähtyy asettamaasi kuukausirajaan, 50 sentistä 3 dollariin."
      },
      {
        q: "Mitä OpenAI näkee?",
        a: "Vain jos valitset OpenAI:n: yhden viestin, tiedotteen tai merkinnän kerrallaan sekä lasten etunimet ja luokat, jotta se tietää, ketä asia koskee. Wilma-salasanasi ei koskaan mene sinne. Paikallisella tekoälyllä tai ilman tekoälyä mitään ei lähetetä tekoälypalveluun."
      },
      {
        q: "Missä tietoni ovat?",
        a: "Omalla tietokoneellasi. Viestit, lukujärjestykset ja tekoälyn vastaukset tallennetaan sovellukseen, jotta se aukeaa heti. WilmAI-palvelinta ei ole. Wilma-salasanasi menee vain koulusi Wilmaan; sovellus voi muistaa sen tietokoneellasi peitettynä, jotta uudelleen kirjautuminen on yksi klikkaus."
      },
      {
        q: "Miksi tämä ei ole verkkosivusto?",
        a: "Haluaisin, että olisi. Verkkosivusto voi kuitenkin olla yhteydessä Wilmaan vain, jos Visma sallii sen, eikä minulla ole Visman lupaa, joten selain estää pyynnöt. Omalla koneellasi toimiva sovellus voi olla yhteydessä Wilmaan suoraan, samaan tapaan kuin selaimesi, kun käytät Wilmaa, ja tunnuksesi pysyvät sinulla."
      },
      {
        q: "Miksi ei puhelinsovellusta?",
        a: "Haluaisin tehdä sellaisen, ja ehkä teenkin. Puhelinsovellus on kuitenkin julkaistava App Storessa, ja Visma voisi vaatia sen poistamista, koska se käyttää Wilmaa ilman Visman lupaa. Työpöytäsovellus ei tarvitse sovelluskauppaa. Sillä näytän, millainen moderni Wilma voisi olla, kun tekoäly on rakennettu sisään."
      },
      {
        q: "Miten tämä eroaa tekoälyavustajien WilmAI:sta?",
        a: "Avustajien WilmAI antaa Clauden, ChatGPT:n tai muun avustajan lukea Wilmaa puolestasi, ja se vain lukee. WilmAI Home on sovellus, jota käytät itse ja johon tekoäly on rakennettu sisään, ja se osaa myös lähettää vastauksia, ilmoittautumisia ja poissaoloilmoituksia. Voit käyttää kumpaa tahansa tai molempia."
      }
    ]
  },
  get: {
    title: "Lataa WilmAI Home",
    mac: "Mac",
    macDetail: "Apple Silicon (M1 tai uudempi) · macOS 13.3 tai uudempi",
    includes: "Macin latauksessa on mukana vapaaehtoinen paikallinen tekoäly. Sen 9,1 Gt:n mallit latautuvat vain, jos otat paikallisen tekoälyn käyttöön.",
    macNote: "Mac-sovellusta ei ole vielä allekirjoitettu Applen kautta, joten macOS pysäyttää sen ensimmäisellä kerralla: valitse Valmis, avaa sitten Järjestelmäasetukset → Tietosuoja ja turvallisuus ja valitse WilmAI Homen kohdalla Avaa silti. Sen jälkeen sovellus aukeaa normaalisti.",
    windows: "Windows",
    windowsDetail: "Windows 10 tai 11 · 64-bittinen",
    windowsNote: "Windows-asennusohjelmaa ei ole vielä allekirjoitettu, joten selain voi pysäyttää latauksen, koska tiedostoa ei ladata usein. Vie Edgessä osoitin latauksen päälle ja valitse … → Säilytä ja sitten Näytä lisää → Säilytä silti. Windows varoittaa vielä ennen ensimmäistä käynnistystä: valitse Lisätietoja ja sitten Suorita silti. Se asentuu vain sinulle eikä tarvitse ylläpitäjän oikeuksia, mutta koulun tietokoneen asetukset voivat silti estää sen.",
    firstMac: "Macilla ensimmäisellä kerralla",
    firstWindows: "Windowsissa ensimmäisellä kerralla",
    windowsSteps: { download: "Lataus Edgessä", start: "Käynnistys" },
    pending: "Ensimmäiset lataukset ovat tulossa. Ne ilmestyvät tähän, kun ne ovat valmiita.",
    others: "Linux-versiota ei vielä ole.",
    cliLink: "Tekoälyavustajien WilmAI toimii siinäkin →"
  },
  closing: {
    eyebrow: "muutama sana minulta",
    text: "WilmAI Home on kokeiluni siitä, millainen Wilma voisi olla. Se on beta, ja kaikki palaute auttaa: mikä menee rikki, mikä on epäselvää ja mitä toivoisit seuraavaksi.",
    signature: "— Antti",
    button: "Anna palautetta GitHubissa"
  },
  announce: { badge: "Uutta", text: "WilmAI Home", more: ": työpöytäsovellus oppilaille ja vanhemmille, tekoäly sisäänrakennettuna", cta: "Katso sovellus" },
  card: {
    eyebrow: "uutta: työpöytäsovellus",
    text: "Haluaisitko mieluummin oman sovelluksen? WilmAI Home on uudenlainen Wilma oppilaille ja vanhemmille, ja tekoäly on rakennettu sisään: kaikki yhdessä paikassa ja ilmoitus, kun jokin vaatii sinua. Beta-vaiheessa, Macille ja Windowsille.",
    link: "Tutustu WilmAI Homeen"
  }
};

export const homeCopy: Record<Lang, HomeCopy> = { en, fi };
