# Runbook: aktualizacja zastępstw z eksportów dziennika

Notatka operacyjna dla Claude. Opisuje **jak** wykonać zlecenie, które za każdym
razem wygląda tak samo: użytkownik wrzuca dwa pliki XLSX z dziennika i prosi,
żeby „się dobrze wyświetlało" na obu stronach.

Nadrzędne zasady (prywatność, zakres, wymagania publikacji) są w repozytorium
nauczyciela: `zastepstwa`, gałąź **`przebudowa`**, plik
`INSTRUKCJA_AKTUALIZACJI_ZASTEPSTW.md`. Ten runbook jej nie zastępuje — dokłada
konkrety środowiskowe i kolejność kroków. Przy rozbieżności wygrywa tamta
instrukcja.

## 0. Najpierw: właściwe gałęzie

To jest pułapka, która kosztuje najwięcej czasu. **Instrukcje i aktualne dane
serwisu nauczyciela nie są na `main`.**

| Repozytorium | Gałąź publikacyjna | Uwaga |
|---|---|---|
| `adeodatus11/zastepstwa` | `przebudowa` | `main` jest z czerwca 2026 i nie zawiera ani instrukcji, ani XLSX/XML. `wakacyjny` to poprzedni serwis. |
| `adeodatus11/plan-4-maja-2026` | `main` | Pages buduje się z `main` automatycznie. |

```sh
cd zastepstwa && git fetch origin przebudowa && git checkout -B <twoja-gałąź> origin/przebudowa
cd plan-4-maja-2026 && git fetch origin main && git checkout -B <twoja-gałąź> origin/main
```

Historia `zastepstwa` była czyszczona 14.09.2026. Nie scalaj i nie wypychaj
historii sprzed tej daty, nie rób force push.

Jeżeli środowisko narzuca własną gałąź roboczą (`claude/...`), oparcie jej na
`origin/przebudowa` jest obowiązkowe — gałąź oparta na `main` jest bezużyteczna.
Push na gałęzie publikacyjne wymaga zgody użytkownika; poproś o nią, zanim
wypchniesz, bo push na `przebudowa` uruchamia wdrożenie produkcyjne.

Konfiguracja źródeł jest w `zastepstwa/publication.json` (`sources.xml`,
`sources.substitutions`, `sources.transfers`). Czytaj ścieżki stamtąd, nie
wpisuj ich z pamięci.

## 1. Odczyt paczki

Okres bierz z arkusza `Opis parametrów` obu plików — nigdy z nazwy pliku ani z
dzisiejszej daty. Sprawdź, czy oba pliki mają ten sam okres.

Arkusze, które muszą zostać przetworzone:

| Plik | Arkusz | Co zawiera |
|---|---|---|
| `InformacjeOZastepstwach` | `Oddziały` | zastępstwa lekcyjne |
| | `Dzienniki zajeć innych` | zajęcia inne (uwaga: literówka w nazwie arkusza jest w źródle) |
| | `Dyżury` | zastępstwa dyżurów |
| `InformacjeOPrzeniesieniach` | `Oddziały` | przeniesienia i zmiany sal |

Nowy eksport bywa **tym samym tygodniem** z uzupełnionymi dniami. Policz
różnicę wobec wersji w repozytorium, zanim cokolwiek zmienisz — to jest odpowiedź
na pytanie „co właściwie doszło":

```sh
# porównaj wiersz po wierszu nowy oczyszczony XLSX z tym w zastepstwa/
python3 - <<'EOF'
import openpyxl
for name in ['InformacjeOZastepstwach','InformacjeOPrzeniesieniach']:
    old=openpyxl.load_workbook(f'zastepstwa/{name}.xlsx',read_only=True,data_only=True)
    new=openpyxl.load_workbook(f'<kopia>/{name}.xlsx',read_only=True,data_only=True)
    for s in new.sheetnames:
        ro={tuple('' if v is None else str(v).strip() for v in r) for r in old[s].values}
        rn={tuple('' if v is None else str(v).strip() for v in r) for r in new[s].values}
        for r in rn-ro: print('+',s,r)
        for r in ro-rn: print('-',s,r)
EOF
```

Zachowaj znaczenie wpisów: `-`, `Zastępstwo` bez nazwiska, `Uczniowie zwolnieni
do domu`, `Okienko dla uczniów`, `Bez konsekwencji…`. To nie są puste pola.

## 2. Prywatność — zanim cokolwiek trafi do Gita

Pracuj na kopiach poza repozytoriami. W kolumnie `Dziennik zajęć innych`
regularnie siedzą **imię, nazwisko i klasa ucznia** (np. `IN - Nazwisko Imię
[5TFB]`).

```sh
cp <upload>/…Zastepstwach….xlsx  <scratch>/InformacjeOZastepstwach.xlsx
cp <upload>/…Przeniesieniach….xlsx <scratch>/InformacjeOPrzeniesieniach.xlsx
cd zastepstwa
python3 scripts/privacy_xlsx.py --sanitize <scratch>/InformacjeOZastepstwach.xlsx
python3 scripts/privacy_xlsx.py --sanitize <scratch>/InformacjeOPrzeniesieniach.xlsx
git config core.hooksPath .githooks
```

Uruchamiaj sanitizer na **obu** plikach, nawet jeśli drugi nie ma tego arkusza.
Potem zweryfikuj:

- porównaj raw vs. oczyszczone komórka po komórce — różnić się może wyłącznie
  kolumna `Dziennik zajęć innych`, żadna inna komórka nie może się przesunąć;
- sprawdź, czy usunięty tekst nie został w archiwum (`xl/sharedStrings.xml`);
- przejrzyj arkusze ukryte i kolumnę `Uwagi` (zwykle są tam nazwiska
  nauczycieli — te zostają, są potrzebne do przypisania zastępstw).

Skrypt czyści tylko tę jedną kolumnę. Nie jest wykrywaczem danych osobowych.

## 3. Serwis nauczyciela

```sh
cd zastepstwa
cp <scratch>/InformacjeOZastepstwach.xlsx <scratch>/InformacjeOPrzeniesieniach.xlsx .
npm ci                 # patrz §6 — w sandboxie to się wywala
npm run data           # wypisuje liczby wpisów — porównaj je z arkuszami
npm run check
npm run verify
npm run test:browser
npm run test:performance
```

`npm run data` wypisuje `{lessons, duties, substitutions, transfers,
dutyChanges}`. Liczby muszą się zgadzać z liczbą wierszy w arkuszach (bez
nagłówka). Zajęcia inne sprawdź w `public/data/changes.*.json` w polu
`otherActivities` — mają być obecne i **bez** nazw dzienników.

Commituj wyłącznie dwa pliki XLSX. `public/data/`, `dist/`, `node_modules/`,
`reports/` są w `.gitignore` i tam mają zostać.

## 4. Plan uczniowski

```sh
cd plan-4-maja-2026
python3 scripts/build_student_changes.py \
  ../zastepstwa/InformacjeOZastepstwach.xlsx \
  ../zastepstwa/InformacjeOPrzeniesieniach.xlsx \
  --plan-xml ../zastepstwa/dyzury-2026-09-07-korekta.xml
```

`--plan-xml` jest **obowiązkowy**: domyślna ścieżka w skrypcie wskazuje na
`../zastepstwa-main/…`, czyli katalog, którego w normalnym klonie nie ma. Nazwę
XML-a weź z `publication.json` → `sources.xml`.

XML dostarcza dwie rzeczy, których nie ma w XLSX: skrót nauczyciela
(`sourceTeacher`) i grupy (`sourceGroups`). Bez trafnego `sourceTeacher`
`student-changes.js` nie znajdzie komórki i wrzuci notkę przy nagłówku tabeli
zamiast w kratkę planu.

Test:

```sh
npm install --no-save --no-package-lock jsdom
node scripts/test_student_changes.cjs
rm -rf node_modules
```

Sprawdź w wygenerowanym JSON-ie, zanim uznasz to za zrobione:

```sh
python3 - <<'EOF'
import json
d=json.load(open('student-changes.json'))
print(d['validFrom'], d['validTo'], len(d['substitutions']), len(d['transfers']))
for x in d['substitutions']+d['transfers']:
    if not x['sourceTeacher']:
        print('bez skrótu ->', x['date'], x['period'], x['className'])
    g=x['groupName']
    if g and not any(s.lower() in (g.lower(),'cała klasa') for s in x['sourceGroups']):
        print('grupa nie pokryta ->', x['date'], x['period'], x['className'], g, x['sourceGroups'])
EOF
```

Lista „grupa nie pokryta" musi być **pusta** — każdy taki wpis wyląduje przy
nagłówku zamiast w komórce.

Warto też obejrzeć render przez jsdom: policz znaczniki w komórkach vs. przy
nagłówku dla każdego dnia paczki i potwierdź, że przeniesienie typu `transfer`
jest oznaczone **i w lekcji źródłowej, i w docelowej**, a przełączenie dnia nie
zostawia znaczników z poprzedniego.

Commituj wyłącznie `student-changes.json`. Surowych XLSX tu nie ma prawa być.

## 5. Publikacja

1. `plan-4-maja-2026` → `main`. Pages buduje się automatycznie (workflow
   `pages build and deployment`).
2. `zastepstwa` → `przebudowa`. Workflow `site.yml` robi pełny zestaw kontroli,
   a gdy zmienna repozytorium `PUBLISH_PRZEBUDOWA=true` jest ustawiona — od razu
   wdraża na produkcję (job `deploy`).
3. Poczekaj na **oba** joby (`build` i `deploy`). Run trwa ok. 3–4 min, najwolniej
   idzie `playwright install`. Sprawdź je przez narzędzia GitHuba, nie przez
   `sleep` w pętli.
4. Zielony push to nie to samo co wdrożenie. Dopiero `deploy: success` znaczy, że
   strona nauczyciela się zmieniła.

## 6. Pułapki środowiska (Claude Code na web / sandbox)

**`npm ci` w `zastepstwa` kończy się błędem 403.** `package.json` pobiera `xlsx`
z `https://cdn.sheetjs.com/...`, a polityka sieci sandboxu blokuje ten host
(`curl -sS "$HTTPS_PROXY/__agentproxy/status"` pokazuje `connect_rejected`).
Nie obchodź tego wyłączaniem TLS. Do **lokalnej weryfikacji** można podmienić
wersję na tę z npmjs, a potem natychmiast przywrócić plik:

```sh
cp package.json /tmp/package.json.bak
python3 -c "import json;p=json.load(open('package.json'));p['dependencies']['xlsx']='0.18.5';open('package.json','w').write(json.dumps(p,indent=2)+'\n')"
npm install --no-package-lock --no-audit --no-fund
cp /tmp/package.json.bak package.json      # zrób to od razu, przed jakimkolwiek commitem
```

`package.json` i `package-lock.json` **nie mogą** trafić do commita zmienione.
CI i tak instaluje właściwą wersję. Jeśli użytkownik chce weryfikacji lokalnej
bez tej sztuczki — musi dopuścić `cdn.sheetjs.com` w polityce sieci środowiska.

**Playwright nie znajduje przeglądarki.** W obrazie jest chromium-1194, a
Playwright 1.63 szuka 1243. Testy przeglądarkowe uruchom z własnym configiem
wskazującym `executablePath` (ustaw też `webServer.command` na ścieżkę
bezwzględną do `dist`, bo config leży poza repo):

```ts
// <scratch>/pw.local.config.ts
import base from "/…/zastepstwa/playwright.config.ts";
export default { ...base,
  testDir: "/…/zastepstwa/tests/browser",
  webServer: { command: "python3 -m http.server 4322 --bind 127.0.0.1 --directory /…/zastepstwa/dist",
               url: "http://127.0.0.1:4322", reuseExistingServer: true },
  projects: [{ name: "chromium", use: { ...(base as any).projects[0].use,
    launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" } } }] };
```

Firefox i webkit są niedostępne lokalnie — pokrywa je CI.

**`npm run test:performance`** używa `chromium.executablePath()` z Playwrighta,
więc też trafia w 1243. Podstaw katalog:

```sh
mkdir -p <scratch>/pw/chromium-1243
ln -sfn /opt/pw-browsers/chromium-1194/chrome-linux <scratch>/pw/chromium-1243/chrome-linux64
PLAYWRIGHT_BROWSERS_PATH=<scratch>/pw npm run test:performance
```

**Publicznych stron nie da się pobrać z sandboxu** — `nauczyciel.szkolamistrzow.info`
i `plan.szkolamistrzow.info` dostają 403 na proxy. Status publikacji potwierdzaj
wynikiem workflow i powiedz wprost, że wizualnej kontroli na żywo nie wykonałeś.

**`sleep` na pierwszym planie jest zablokowany.** Na czekanie używaj `Bash` z
`run_in_background` albo monitora; nie odpytuj API w pętli bez przerw.

## 7. Znane, nie-regresje

- **1B i 3B, lekcje 11–13** (nauczyciel Krystek Krzysztof) nie mają skrótu w
  `dyzury-2026-09-07-korekta.xml`, więc generator wypisuje `Brak prowadzącego w
  planie…`, a zmiany lądują jako notka przy nagłówku tabeli zamiast w komórce.
  To oddziały wieczorowe spoza tego XML-a. Naprawi się dopiero XML-em, który je
  obejmuje — nie próbuj tego obchodzić w danych.
- **1TH|DZ, 16.09, lekcje 1–2, `sg6 → 18`** też trafiają do notki przy nagłówku:
  eksport podaje salę źródłową `sg6`, a plan bazowy ma dla nauczyciela `MP`
  salę `sg8`, więc dopasowanie po sali odrzuca komórkę. Rozbieżność jest w
  źródle — nie „poprawiaj" jej w danych.
- Pojedyncze wpisy `Zastępstwo` bez nazwiska zastępcy są poprawne i mają tak
  zostać wyświetlone.

## 8. Raport końcowy

Podaj: okres paczki, liczby (zastępstwa / przeniesienia / dyżury / zajęcia inne),
status publikacji obu stron, wynik testów i konkretne problemy. Liczby bierz z
bieżącej paczki, nie z poprzedniej. Jeśli któregoś etapu nie wykonałeś — napisz
którego, zamiast deklarować aktualizację na podstawie samego przygotowania plików.
