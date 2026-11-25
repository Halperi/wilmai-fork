# Mobiilisovellukset ja alkuperäisen projektin seuranta

Mobiilipohja: `aikarjal/wilmai` main, commit `7f14b28`, Home **0.3.0**.
Oma fork: `Halperi/wilmai-fork`. iOS ja Android käyttävät yhteisiä
React-näkymiä, Wilma-asiakaskirjastoa ja tietomalleja. Kotlinissa ja Swiftissä
ovat vain alustojen vaatimat sovitukset.

## Työpöytäsovellus

Täysin alkuperäistä työpöytäsovellusta varten käytetään alkuperäisen projektin
julkaisuja tai puhdasta `upstream/main`-lähdettä erillisessä checkoutissa.
Forkin mobiilihaarassa on myös aiempia yhteisiä tietoturvamuutoksia
(navigointi, CSP, HTTPS ja komentojen käyttöoikeudet), joten tästä haarasta
tehty työpöytäpaketti ei ole täsmälleen alkuperäinen julkaisu.
Tämä päivitys säilyttää alkuperäiset työpöytänäkymät ja tulostuksen.

## Ominaisuuksien valinta mobiiliin

| Ominaisuus | Toteutus puhelimessa |
| --- | --- |
| Oppilaiden koulupäivät | Alkuperäiset oppilaskoosteet; ei erillistä ylimääräistä huomisen korttia |
| Tavallinen viikko | Viikko-näkymän toissijainen valinta; päiväkohtainen lista, kaikkien valittujen lasten kellonajat ja liikunta |
| Jääkaappituloste | Ei painiketta, esikatselua eikä natiivia tulostusoikeutta puhelimissa; työpöydän toiminto säilyy |
| Lasten värit, lempinimet ja emojit | Alkuperäinen asetusten logiikka; puhelimessa suuremmat kosketuskohteet |
| Viesti usealle vastaanottajalle | Alkuperäinen kirjoitusnäkymä ja vastausten näkyvyysvalinta; vastaanottajat saman lapsen koulusta |
| Viestien käännökset | Valinnainen OpenAI-toiminto asetuksissa; vain näytetty käännös lähetetään |
| Tiedotteiden 403-korjaus | Yhteinen asiakaskirjaston ja synkronoinnin korjaus kaikilla alustoilla |

Puhelimen viikkolista käyttää alkuperäistä `usualWeek`-laskentaa, ei omaa
kopiota siitä. Koulupäivän ulkopuolelle rajatut valinnaiset tunnit huomioidaan
myös huomisen ilmoituskoosteen kellonajoissa. Tunti säilyy lukujärjestyksessä.
Tunnussäilöjen avaimia, sovellustunnisteita ja ilmoitusten yksityisyyden
olettamia ei vaihdeta päivityksessä. Taustapäivitys tunnistaa päättyneen
istunnon myös avaamatta viestien sisältöjä.

## Seuraava upstream-päivitys

1. `git fetch upstream` ja vertaa nykyiseen mobiilipohjaan.
2. Yhdistä `upstream/main` omaan kehityshaaraan. Säilytä alkuperäiset
   yhteiset tietomallit ja liiketoimintalogiikka; pidä puhelimen esitystapa
   pienissä alustakohtaisissa komponenteissa ja `.mobile`-tyyleissä.
3. Arvioi uudet ominaisuudet: etusivulle vain päivittäinen tarve,
   toissijaiset toiminnot omiin näkymiinsä, tulostus työpöydälle.
4. Aja Home-tyypitys ja testit, asiakaskirjaston testit sekä molemmat
   natiivikäännökset. Tarkista esimerkkiperheellä 393 px (iPhone 15),
   360/412 px (Android) ja työpöytä. Älä käytä oikeita koulutietoja testeissä.
5. Säilytä Androidin yksityinen allekirjoitusavain ja iOS:n bundle ID sekä
   `wilmai.iosInstallation`-avain, jotta päivitys säilyttää kirjautumiset.

## Tämän version tarkistukset

Esimerkkiperheen selaintarkistuksessa käytetään erillistä tyhjää selainprofiilia
ja stubattua natiivisiltaa. Etusivu, tavallinen viikko, ulkoasuvalintojen
tallentuminen ja kahden vastaanottajan valinta tarkistetaan iPhone 15:n,
Androidin 360/412 px:n ja työpöydän koossa. Nämä tarkistukset eivät osoita
ilmoitusten toimitusta tai puhelimen oikeaa Wilma-kirjautumista.

`pnpm test:mobile` sisältää myös viikkolistan renderöintitestin.
`evals/logins.test.ts` kattaa taustapäivityksen istunnon päättymisen ja
koulujen eristyksen. `evals/school-notifications.test.ts` varmistaa,
että valinnainen tunti ei pidennä ilmoituskoosteen koulupäivää.

## Takaisin pyyhkäisemällä

Mobiilissa viestin lukija, uuden viestin näkymä ja suljettavat tietopaneelit
palaavat samalla toiminnolla kuin takaisin-nuoli, kun vasemmasta reunasta
pyyhkäistään oikealle. Aloitusalue on sisältönäkymän vasemmat 32 CSS-pikseliä,
vaadittu matka 72 pikseliä. Ele ei seuraa selaushistoriaa eikä vaihda tiliä.
Nuoli säilyy. Androidin järjestelmän takaisin-ele säilyy ennallaan.

Pystyvieritys, usean sormen eleet, tekstin valinta, kirjoitus- ja säätökentät,
painikkeet, linkit sekä vaakavieritettävät elementit ohittavat eleen.
Päällimmäinen tietopaneeli käsittelee eleen ennen alla olevaa viestiä.
Kirjoitetun viestin luonnos säilyy alkuperäisen luonnostallennuksen kautta.
Työpöydällä kosketuskuuntelijoita ei asenneta.

## Palautuminen tauolta ja merkintöjen ajantasaisuus

Puhelin tarkistaa istunnon heti palatessaan etualalle tai saadessaan
verkkoyhteyden takaisin. Jos prosessi käynnistyy ilman tallennettua istuntoa,
kirjautumisen palautumista yritetään heti. Tämä noudattaa aiempaa
kirjautumistavan valintaa: "Pysy kirjautuneena" sallii automaattisen
kirjautumisen, yhden painalluksen tila ei. Käsin tehtyä uloskirjautumista ei
kumota. Tilapäinen verkko- tai palvelinvirhe säilyttää tunnukset ja sallii
uusintayrityksen aikaisintaan 30 sekunnin päästä, puhelimen ollessa etualalla.
Väärä salasana ja puuttuva kaksivaiheinen vahvistus odottavat käyttäjää.
Wilman toisen käytön aiheuttaman istuntokilpailun pidempi tauko säilyy.

Merkinnät-näkymä yhdistää vanhemman lukuvuosivälimuistin uusimman
synkronoinnin tietoihin. Tuoreen jakson poistuneet tai korjatut merkinnät
korvaavat vanhat, vanhempi historia säilyy. Uudempi koko vuoden haku on
vuorostaan ensisijainen. Välimuisteja ei yhdistetä lasten tai tilien välillä.
Aikaväli määritellään yhteisessä `noteSyncRange`-funktiossa, jota käyttävät
sekä synkronointi että näkymän tietojen valinta.


### iOS storage recovery (2026-11-04)

The reported loss of passwords, OpenAI selection and API key after a normal pause
is consistent with WebKit storage being unavailable/reset; the exact device event
has not been observed. The old reinstall guard could delete the Keychain record
when a browser-only installation ID changed. That destructive read is removed.

- Resolve the shipped `wilmai.iosInstallation` against an atomic native
  `ios-installation.v1` marker before opening the vault. Native read errors fail
  closed. Losing WebKit storage alone cannot change an enrolled installation.
- Keep the shipped Keychain record for its matching original installation,
  including compatibility with older native builds. Fresh installations use
  separate records scoped by their own identity. A new installation cannot
  inherit previous logins; a mismatched read never deletes the old record.
- Save mobile preferences with the credentials and restore them before applying
  password-retention preferences. This prevents reset browser defaults from
  clearing native credentials or changing the chosen AI provider.
- On returning to a visible phone, retry protected-storage failures before
  reloading an interrupted startup. Dirty newer writes remain authoritative.
- Explicit reset clears both preference and credential copies. No recovery can
  reconstruct a key that an older build already deleted; re-entry may be needed
  once after installing this fix.

Tests use synthetic accounts and keys only. Never inspect a user's Keychain or
export their app container to diagnose this problem.
