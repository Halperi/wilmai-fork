# Tietoturvakatselmus 2.11.2026

Kohde: WilmAI Home, erityisesti iPhone 15 / iOS 27.2. Katselmus tehtiin
ilmoitusominaisuuden toteutuksen jälkeen tämän haaran lähdekoodiin,
riippuvuuksiin ja allekirjoitettuun laitepakettiin. Arvio ei ole ulkopuolinen
sertifiointi eikä takuu kaikkien haavoittuvuuksien puuttumisesta.

## Menetelmä ja rajaus

Tarkastettiin tunnusten/istuntojen tallennus, kouludatan välimuistit, varmuuskopiot,
WebView/CSP/IPC, URL:t ja uudelleenohjaukset, tilieristys, ilmoitusten sisältö ja
avaaminen, kirjautumisen päättäminen, AI-tiedonsiirto ja riippuvuudet.
Käytettiin synteettisiä tietoja, hyökkäysosoitteiden yksikkötestejä ja oman iPhonen
natiiveja testejä. Wilma-palveluihin ei tehty hyökkäyksiä eikä oikeita koulutietoja
kopioitu testeihin tai raporttiin. Salaisuusskannaus kohdistui nykyisiin
Git-seurattuihin tekstitiedostoihin; se ei ollut koko Git-historian forensiikka.

Uhkamalli kattaa haitallisen koulusisällön/linkin, vahingossa vuotavan
ilmoitussisällön, vanhat istunnot, väärän tilin avaamisen ja varmuuskopioihin
päätyvän datan. Laitteen käyttöjärjestelmän tai kehityskoneen täydellistä
kompromissia ja jailbreakia ei voida sulkea pois sovelluksen lähdekoodilla.

## Korjatut havainnot

| Havainto | Merkitys | Toteutettu korjaus |
| --- | --- | --- |
| Omat Tauri-komennot eivät olleet eksplisiittisessä sovellusmanifestissa | Natiiviin rajapintaan ei pidä luottaa vain käyttöliittymän ehtojen perusteella | Kaikki rekisteröidyt komennot manifestiin; mobiilille vain tarpeelliset paikallisen `main`-ikkunan oikeudet. CLI-tunnukset, raporttitiedostot ja työpöytäpäivittäjä eivät ole mobiilin oikeuksissa. Regressiotesti valvoo tätä myös uusille komennoille. |
| Privilegioidun WebView'n navigointia ei rajattu natiivisti | Koulutekstin linkistä tai myöhemmästä UI-virheestä ei saa päätyä ulkoiseen dokumenttiin sovelluksen oikeuksilla | Natiivi navigointisuodatin sallii vain sovellusoriginin; kehitystilassa lisäksi täsmällisen dev-originin. Ulkoiset HTTPS-linkit avataan selaimessa. Muut skeemat ja URL:n käyttäjätiedot estetään. CSP kieltää kehykset ja lomakenavigoinnin. |
| Wilma-natiiviputki tarkisti hostin mutta ei porttia/käyttäjätietoja | Sama host eri portissa ei ole sama palvelu | Vain tunnettu Wilma, HTTPS/443, ei URL-käyttäjätietoja; vain GET/POST. Verkkovirheistä poistetaan pyyntö-URL ennen näyttämistä. |
| Kouludatan WebKit-välimuistilla ei ollut eksplisiittistä backup-estettä ja Complete-suojausta | Viestit/merkinnät ovat arkaluonteisia, vaikka salasanat ovat Avainnipussa | WebKit-, Application Support- ja Cookies-hakemistot suljetaan tulevista varmuuskopioista, niiden tiedostosuojaksi asetetaan Complete. Aiemmin luotuja varmuuskopioita ei poisteta. |
| Sovellusvaihtajan tilannekuva saattoi näyttää kouludataa | Puhelimen näyttö voi paljastaa nimiä/arvosanoja sovelluksen ollessa sivussa | Natiivi peite lisätään sovelluksen menettäessä aktiivisuuden ja poistetaan aktiivisuuteen palatessa. Tämä ei estä käyttäjän ottamia kuvakaappauksia. |
| Ilmoitukset voivat paljastaa kouludataa ja avata väärän tilin | Lukitusnäyttö ja vanhan ilmoituksen painallus ovat erillisiä tietosuojarajoja | Oletus on yleinen teksti; yksityiskohtiin erillinen suostumus. Vain satunnainen perhekohtainen tunniste ja rajattu sisäinen kohde OS-metatiedoissa. Uloskirjautuminen/nollaus tyhjentää ilmoitukset, myös kesken lähetyksen. |
| Työtilan `qs`-versiossa oli moderate-tason advisory | Riippuvuuden mahdollinen palvelunestotapaus | Yhteensopiva päivitys vähintään versioon 6.16.1, lockfile ja paikallinen asennus päivitetty. Uusintaauditissa nolla havaintoa. |

## Tarkastetut nykyiset suojaukset

- iOS-salasanat, API-avaimet ja istuntocookiet ovat yksityisessä,
  synkronoimattomassa WhenUnlockedThisDeviceOnly-Avainnippumerkinnässä.
  Migraatio poistaa vanhat kopiot vasta onnistuneen kirjoituksen jälkeen;
  virhe ei johda plaintext-varatallennukseen. Nollaus/uloskirjautuminen ja
  uudelleenasennuksen tunniste käsitellään erikseen.
- Tilikohtaiset tiedot ja istunnot käyttävät olemassa olevaa tiliavainta;
  myöhäisiä kirjautumisia/tilinvaihdoksia vastaan on scope-tarkistukset.
- Wilma-asiakas ei seuraa uudelleenohjauksia toiseen originiin eikä siirrä
  cookieita toiselle palvelulle. TLS-varmenteiden tarkistusta ei ole poistettu.
- Koulusisältö esitetään React-tekstinä; tarkastetuissa UI-lähteissä ei ole
  `dangerouslySetInnerHTML`/`innerHTML`-tulostusta. AI-vastaukset eivät suorita
  komentoja. Wilma-kirjautumissalasanaa tai asetuksiin tallennettua API-avainta
  ei liitetä AI:n tekstisyötteeseen.
- Ilmoitusten taustatarkistus on listaus ilman viestien lukutilan muuttamista
  tai uusia AI-kutsuja. Huomisen kooste käyttää jo tehtyjä tulkintoja.
- Nykyisissä seuratuissa tiedostoissa ei löytynyt skannattuja yksityisavaimen,
  OpenAI-/GitHub-tokenin tai AWS-avaintunnisteen kuvioita. Tämä ei todista,
  ettei muunmuotoista tai historiassa ollutta salaisuutta voisi olla.

## Riippuvuustarkistus

Home-tuotantoriippuvuuksien ja työtilan npm-auditit: korjauksen jälkeen nolla
havaintoa. Cargo.lock tarkistettiin OSV APIsta: 533 rekisteripakettia.
Lukitustiedoston havaintoja ei pidä sekoittaa iOS:ään linkitettäviin paketteihin:
vertailu iOS:n riippuvuuspuuhun ei löytänyt yhtään advisory-osumaa.

Jäljelle jäävät muiden alustojen havainnot:

- `zip 4.6.1`, Windowsin `tauri-plugin-updater 2.13.2` -polku:
  RUSTSEC-2026-0367/0368/0369/0429 (arkiston purkaminen, linkit/oikeudet ja
  palvelunesto). Korjausraja on 9.0.0, mutta upstream-liitäntä vaatii 4.x:n.
  Versiota ei vaihdettu API-yhteensopimattomasti. iOS/macOS/Android-puissa tätä
  pakettia ei ole. Windows-julkaisun arviointi vaatii erillisen korjatun
  päivitysliitännän. Päivittäjän allekirjoitus tarkistetaan ennen purkamista,
  mutta se ei poista riippuvuuden korjaustarvetta.
- Linuxin GTK-polun `glib 0.18.5`: RUSTSEC-2024-0429, korjaus alkaen 0.20.0.
- `proc-macro-error`, `zvariant`, `zvariant_derive` ja `zbus_names`:
  ylläpidon loppumista koskevia advisoreja desktop-/rakennuspoluissa.
  Nämäkään eivät kuulu tarkastettuun iOS-puuhun.

## Jäljelle jäävät riskit ja ennen Androidia

1. **Työpöydän tunnustallennus:** työpöydän salasanat/API-avaimet ovat edelleen
   peitettyä selaintallennusta ja istunnot IndexedDB:ssä. Base64 ei ole salaus.
   Tiedostojen/varmuuskopion haltija voi lukea ne. iOS-korjaus ei muuta tätä.
2. **Androidin julkaisun este:** Androidilla ei vielä ole toteutettua Keystoreen
   sidottua salaisuussäilöä. Nykyistä yleistä selainvaratallennusta ei pidä
   julkaista puhelimeen sellaisenaan. Toteutetaan tämä ennen kirjautumistestejä.
3. **Lukitsematon puhelin:** sovelluksella ei ole erillistä Face ID/PIN-lukkoa.
   Puhelimen avaava käyttäjä voi nähdä välimuistin ja käyttää aktiivista
   istuntoa. Koko kouludatakanta ei ole erillisellä sovellusavaimella salattu;
   suoja nojaa iOS-sandboxiin, Data Protectioniin ja laitteen lukitukseen.
4. **AI ja yksityiskohtaiset ilmoitukset:** käyttäjän valitsema AI lähettää
   koulutekstiä valitulle AI-palvelulle. Yksityiskohtaiset ilmoitukset voivat
   näkyä lukitusnäytössä myös laitteen lukituksen aikana. Molemmat ovat
   tietoisia asetuksia; ne eivät muutu turvallisiksi pelkällä salauksella.
5. **Kehitysversio:** laitteeseen asennetaan omalla kehitysvarmenteella debug-
   versio. Jakeluversio vaatii release-käännöksen ja kehitysoikeuksien/työkalujen
   poiston. iOS:n harkinnanvaraisen taustatyön toteutumisesta ei ole aikataulutakuuta.

## Todennus

TypeScript läpäisty; Home-sarja 119 hyväksyttyä ja 1 ohitettu testi
(mobiili-/politiikkaosajoukko 21 testiä). Rust: 16 hyväksyttyä, 1 ohitettu.
Allekirjoitettu iPhone-käännös sekä asennus/käynnistys onnistuivat.
Laitetesti tarkistaa synteettisillä tiedoilla ilmoitusluvan, lähetyksen,
ajastuksen, perumisen, taustatehtävän rekisteröinnin, tallennussuojauksen sekä
Avainnipun; kaikki nämä laitetarkistukset läpäistiin. Ajastustesti varmistaa
pyynnön lisäämisen ja perumisen, ei tulevan hälytyksen todellista näyttämistä.
Luonnollista iOS-taustapäivitysajankohtaa ja oikeaa Wilma-kirjautumista
viestien lähetyksineen ei tämän testin perusteella väitetä todennetuksi.

Viitekehys ja lähteet: [OWASP MASVS-STORAGE-1](https://mas.owasp.org/MASVS/controls/MASVS-STORAGE-1/),
[Taurin capabilities](https://v2.tauri.app/security/capabilities/),
[Applen Complete-tiedostosuoja](https://developer.apple.com/documentation/foundation/fileprotectiontype/complete),
[Applen taustatehtävät](https://developer.apple.com/videos/play/wwdc2025/227/),
[RustSec-advisoryt](https://rustsec.org/advisories/), [OSV](https://osv.dev/).


## Android-lisäys 2.11.2026

Androidin ensimmäinen 14+-versio on toteutettu erillisessä kehityshaarassa.
Aiempi tämän raportin Android-julkaisueste (salasanojen base64-säilytys) on
korjattu natiivilla AndroidKeyStore/AES-256-GCM-säilöllä. Samaa migraation,
kirjoitusvirheiden, tilieristyksen ja uloskirjautumisen logiikkaa käytetään
nyt molemmilla puhelinalustoilla. Kirjoitus fsyncataan ja luetaan takaisin ennen
kuittausta; virhe estää vanhojen tunnuskopioiden poistamisen.

Androidin pilvi- ja laitesiirtovarmuuskopiot on estetty, ikkuna käyttää
FLAG_SECURE-suojausta ja julkaisu-APK on allekirjoitettu sekä ilman debug-lippua.
Ilmoitusten ajastukset tallennetaan peruttaviksi; Android 14:n cancelAll poistaa
myös mahdolliset kaatumisen jälkeen orvoiksi jääneet hälytykset. Natiiville
sillalle annetaan vain Androidin paikallisen pääikkunan tarvitsemat oikeudet.

Android 14:n avain ei käytä virhealtista setUnlockedDeviceRequired-asetusta;
sovellus tarkistaa lukituksen natiivisti. Tämä ei vastaa täysin iOS:n
WhenUnlockedThisDeviceOnly-suojausta eikä lisää erillistä biometristä sovelluslukkoa.
Androidin oma salattu sovellushakemisto ja Keystore ovat suojauksen perusta.
Koulutietoja on käytön aikana selkokielisenä muistissa. Debug-paketti ja avattu
kehittäjäyhteys mahdollistavat testidatan tarkastelun; käyttäjälle annetaan
julkaisu-APK, joka pyytää WebView-virheenkorjauksen pois tuotanto-Androidissa.
Userdebug-emulaattorin WebView pakottaa sen silti päälle. Tätä käyttöjärjestelmän
testiasetusta ei voi poistaa sovelluksen julkisella API:lla; emulaattorilla ei
ole vahvistettu tavallisen OnePlussan kehittäjäportin sulkeutumista.

Emulaattorin synteettiset tallennus-, peukalointi-, avaimen katoamis- ja
ilmoitustestit läpäisivät. OnePlus Nord 2T:n todellinen kirjautuminen,
käyttökokemus ja OxygenOS:n akunhallinta ovat vielä laitetestattavia.
Taustasynkronointi ei luo uutta JavaScript-moottoria Androidin lopetettua
prosessin. Katso [Android-ohje](android.md) testien ja rajoitusten erittelyä varten.
