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
