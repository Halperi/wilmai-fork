# WilmAI Home Android — OnePlus Nord 2T 5G / Android 14

Android käyttää samaa React-käyttöliittymää, Wilma-moottoria, tilikohtaisia
välimuisteja ja tekoälytulkintoja kuin työpöytä ja iOS. Ylävirran ominaisuudet
tuodaan yhteisiin lähteisiin. Kotlinissa ovat vain Androidin tunnussäilö,
ilmoituskanava, ilmoituksen avaus ja rajattu taustatyösilta.

Ensiversion vähimmäisversio on **Android 14 / API 34**; käännös- ja kohde-SDK
on 36. Sovellustunniste on `fi.halperi.wilmai.home`, eri kuin alkuperäisen
`ai.wilm.home`. Kuvake muodostetaan samasta PNG:stä kuin työpöydällä.
Android 14:n AlarmManager.cancelAll poistaa sovelluksen kaikki hälytykset myös
mahdollisen kaatumisen jälkeen, vaikka lisäosan tunnistelistaan jäisi aukko.

## Rakentaminen ja asennus

Tarvitaan Node, pnpm 9.12, Rustin `aarch64-linux-android`-kohde, JDK 21,
Android SDK 36, build-tools 36.0.0 ja NDK 30.0.16248370. Aseta `JAVA_HOME`,
`ANDROID_HOME` ja `NDK_HOME` omiin työkaluhakemistoihisi.

```sh
cd apps/home
pnpm install --ignore-workspace --frozen-lockfile
pnpm android:init
pnpm android:build
```

`android:init` generoi Tauri-projektin. `android-assets.mjs` kopioi kuvakkeen
sekä lisää varmuuskopioiden estot ja poistaa täsmähälytysoikeudet. Generoituja
Gradle-tiedostoja ei tarvitse ylläpitää erillisenä sovelluksena. SDK 36 asetetaan
jokaisessa rakennuksessa, koska nykyinen Tauri-pohja olettaa SDK 37:n.
Androidin takaisin-ele välitetään yhteiselle hash-reitittimelle: näkymästä palataan
edelliseen, etusivulta sovellus siirtyy taustalle.

macOS:ssa `android-sign.mjs` säilyttää oman allekirjoitusavaimen ja sen salasanan
hakemistossa `~/Library/Application Support/WilmAI Home Development/android-signing`.
Hakemistolla on oikeudet 0700 ja tiedostoilla 0600. **Pidä tästä yksityinen
varmuuskopio.** Älä lisää avainta, salasanaa tai niitä sisältävää varmuuskopiota
Gitiin. Päivitykset tarvitsevat saman avaimen; sen katoaminen voi vaatia vanhan
sovelluksen ja sen tietojen poistamisen. CI tuottaa vain debug-APK:n ilman tätä
henkilökohtaista avainta. APK:n asentamiseen omaan puhelimeen ei tarvita
Play-kehittäjätiliä.

Valmis oma APK on `.release/android/WilmAI-Home-0.3.0-arm64.apk`.
USB-virheenkorjaus ja puhelimessa hyväksytty Macin RSA-lupa tarvitaan ADB-asennukseen:

```sh
adb devices
adb -s OMAN_PUHELIMEN_TUNNISTE install -r .release/android/WilmAI-Home-0.3.0-arm64.apk
```

Kirjaudu Wilmaan itse puhelimessa. Ensimmäinen havainto ei lähetä vanhoja
viestejä ilmoituksina. Salli ilmoitukset sovelluksen asetuksista ja kokeile
niiden testipainiketta.

## Ilmoitukset ja taustatoiminnan rajat

Uudet viestit/vastaukset, merkinnät/selvittämättömät poissaolot, koearvosanat,
määräpäivät ja tekoälyn kooste käyttävät yhteistä suunnittelijaa. Oletusteksti
ei sisällä lapsen nimeä, arvosanaa tai viestin otsikkoa. Kooste ei käynnistä
uutta tekoälypyyntöä. Androidin ilmoituslupa kysytään järjestelmädialogilla.

Ajastetut koosteet ja muistutukset ovat Androidin paikallisia, kertaluonteisia
hälytyksiä. Ne voivat näkyä myös prosessin sulkeuduttua, mutta käyttävät jo
ladattua suunnitelmaa. Ajastus on epätarkka: akun säästö ja Doze voivat viivästää
sitä. Sovellus ei pyydä täsmähälytysoikeutta. Android-lisäosan `show` ei säilytä
ajastuksia peruutuslistassa; siksi ajastukset tehdään tallentavalla `batch`-kutsulla.
Uloskirjautuminen, perheen vaihto ja ilmoitusten poisto tyhjentävät hälytykset.

WorkManager antaa noin 15 minuutin vähimmäisvälein mahdollisuuden käynnissä
olevalle JavaScript-moottorille. Lukittu puhelin, verkkoyhteyden puute ja vähäinen
akku estävät työn. Jos Android/OxygenOS tappaa prosessin, WorkManager ei luo
uutta Tauri-WebView-moottoria. **Täysin suljettuna sovellus ei tässä versiossa hae
uusia Wilma-tietoja.** Seuraava avaus päivittää ne. Tämä rajoitus näkyy myös
asetuksissa. Akkuasetusten vapauttaminen ei takaa prosessin säilymistä.
Jatkossa suljetun prosessin haku tarvitsee erillisen headless-moottorin tai
ilmoituspalvelun; tämän version Kotlin ei kopioi Wilman kirjautumis- ja parserilogiikkaa.

## Tietoturva

Tunnukset, API-avaimet ja evästeistunnot ovat yhdessä atomisesti tallennettavassa
AES-256-GCM-tiedostossa `noBackupFilesDir`-hakemistossa. Jokaisella tallennuksella
on satunnainen IV; sovellustunniste ja formaattiversio sidotaan autentikointiin.
Kirjoitus synkronoidaan ja luetaan takaisin ennen kuittausta. Avain on AndroidKeyStoressa, ei APK:ssa tai selaintallennuksessa. Tilien tietueet
säilyvät erillisten tilitunnisteiden alla. Vioittunut tieto tai kadonnut avain
pysäyttää lukemisen; selkokieliseen tallennukseen ei palata.

Android 14:ssä jokainen natiivi luku ja tallennus sekä taustotyö tarkistaa
Keyguard-lukituksen. Android 12–14:n tunnettuja `setUnlockedDeviceRequired`-virheitä
vältetään; lisärajoitus asetetaan uusille avaimille Android 15+:ssa. Android 14:n
suojaus ei siis vastaa täsmälleen iOS:n WhenUnlockedThisDeviceOnly-avainta.
Erillistä biometristä sovelluslukkoa ei ole. Käyttöjärjestelmä ja avattu sovellus
voivat käsitellä selkokielisiä tietoja muistissa.

Pilvi- ja laitesiirtovarmuuskopiot estetään. `FLAG_SECURE` estää sovelluksen
ruutukaappaukset ja peittää sisällön viimeisimpien sovellusten näkymässä.
Julkaisu-APK ei ole debugattava, ja sen WebView-kehittäjätyökalut estetään
myös erillisellä asetuksella. Debug-skriptit ottavat ne käyttöön vain
`tauri.android.debug.conf.json`-tiedostolla. WebView saa ladata vain sovelluksen omia
dokumentteja; HTTPS-linkit avataan ulkoisesti. Mobiililla ei ole oikeutta
käyttää työpöydän tunnussäilöä, raporttitiedostoja tai päivitystoimintoja.
Tekoälyn käyttö lähettää valitut koulutiedot käyttäjän valitsemalle palvelulle
kuten muillakin alustoilla; mobiilikääre ei muuta tätä tiedonkulkua.

Jos säilön avain tuhoutuu, pelkkä uudelleenyritys ei palauta sitä. Androidin
asetuksista tehtävä sovelluksen tietojen poisto palauttaa tyhjän asennuksen ja
vaatii uuden kirjautumisen. Älä poista tietoja tavallisen päivityksen yhteydessä.

## Testaus

`pnpm test:mobile` kattaa molempien alustojen migraation, kirjoitusvirheet,
tilieristyksen, uloskirjautumisen ja ilmoitusten yksityisyyden. Androidin aidot
Keystore-testit käyttävät vain erillistä synteettistä tiedostoa ja avainta:

```sh
src-tauri/gen/android/gradlew --project-dir src-tauri/gen/android \
  :tauri-plugin-android-device:connectedDebugAndroidTest
```

OnePlussalla on vielä varmistettava oikea Wilma-kirjautuminen, käyttöliittymä,
ilmoitukset ja OxygenOS:n akunhallinta. Emulaattoritesti ei vahvista näitä
laitekohtaisia ominaisuuksia eikä taustatyön luonnollista ajoitusta.

Lähteet: [Taurin vaatimukset](https://v2.tauri.app/start/prerequisites/),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore),
[KeyGenParameterSpec ja Android 12–14:n virheet](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder),
[WorkManagerin jaksotus](https://developer.android.com/reference/androidx/work/PeriodicWorkRequest).

### Paikallinen varmistus 2.11.2026

- TypeScript ja 124 Home-testiä läpäisivät; yksi testi ohitettiin. Työpöydän
  Rust-testit: 16 hyväksyttyä, yksi ohitettu.
- Android 14 ARM -emulaattori, 1080 × 2400 / 420 dpi: sovellus käynnistyi,
  esimerkkiperhe toimi 412 CSS-pikselin leveydessä ilman vaakaylivuotoa ja
  oikea Android BACK palasi viestinäkymästä etusivulle.
- Julkinen Wilma-kirjautumissivu palautti HTTPS 200:n natiivin moottorin kautta
  ilman käyttäjätunnuksia. Varsinaista Wilma-kirjautumista ei testattu.
- Kolme aitoa AndroidKeyStore-instrumentointitestiä läpäisivät: salattu
  edestakainen tallennus ja satunnainen IV, peukaloinnin hylkääminen sekä
  kadonneen avaimen turvallinen virhe. Migraatio- ja kahden tilin eristystestit
  läpäisivät JavaScript-puolella.
- Järjestelmän ilmoituslupadialogi, näkyvä yksityinen testi-ilmoitus,
  ajastuksen rekisteröinti ja Android 14:n kaikkien ajastusten peruminen toimivat.
  Ajastettu synteettinen ilmoitus toimitettiin myös, kun debug-prosessi oli
  todistetusti tapettu ilman Androidin force-stop-toimintoa. Tämä ei takaa
  tarkkaa toimitusaikaa Dozessa tai OnePlussan akunhallinnan kanssa.
- Julkaisu-APK:n allekirjoitus ja 16 KiB:n kohdistus tarkistettiin. Manifesti:
  minSDK 34, targetSDK 36, ei debug-lippua, varmuuskopioita tai selkokielistä
  liikennettä; ei täsmähälytysoikeuksia.

### Kehittäjäkäyttöjärjestelmän WebView-rajoitus

Testiemulaattorin Android on `userdebug` ja sen WebView 113 pakottaa
kehittäjäportin käyttöön myös release-APK:ssa. Chromiumin toteutus jättää
sovelluksen poiskytkentäpyynnön siinä ympäristössä huomiotta. Emulaattorin
porttitestiä ei siksi voi käyttää näyttönä portin sulkemisesta tavallisessa
OnePlus-tuotanto-Androidissa. APK:n debug-lippu on pois, Tauri-asetus on false
ja natiivi WebView-asetus seuraa APK:n debug-lippua. Nämä ovat tuotantoversion
suojaukset; varsinaisen OnePlussan porttia ei ole tutkittu.

Toteutuksen lähde: [Chromiumin userdebug-käytäntö](https://chromium.googlesource.com/chromium/src/%2B/3546854f59..2e285ebae2).
