---
name: zastepstwa
description: Aktualizacja zastępstw i przeniesień z eksportów dziennika (InformacjeOZastepstwach.xlsx, InformacjeOPrzeniesieniach.xlsx) na obu serwisach — plan uczniowski plan.szkolamistrzow.info i serwis nauczyciela nauczyciel.szkolamistrzow.info. Użyj, gdy użytkownik wrzuca te pliki XLSX, prosi o aktualizację zastępstw, przeniesień, dyżurów albo o publikację którejkolwiek z tych stron.
---

# Aktualizacja zastępstw — reguły trwałe

Ten plik zawiera **decyzje, które obowiązują zawsze**, niezależnie od paczki.
Krok po kroku (komendy, obejścia sandboxu, kolejność) jest w
[AKTUALIZACJA_ZASTEPSTW.md](../../../AKTUALIZACJA_ZASTEPSTW.md), a zasady
nadrzędne (prywatność, zakres) w repozytorium `zastepstwa`, gałąź `przebudowa`,
`INSTRUKCJA_AKTUALIZACJI_ZASTEPSTW.md`. Przy rozbieżności wygrywa instrukcja
nadrzędna. Ten plik nie zwalnia z ich przeczytania.

## 1. Nauczanie indywidualne (`IND`) — nigdy nie publikujemy

Wpisy oznaczone `IN`/`IND` dotyczą jednego ucznia z imienia i nazwiska.
**Pomijaj je w wyświetlaniu na obu stronach.** Eksport oznacza je dwojako:

- kolumna `Oddział`: `4TFB|IND*KM`
- nazwa dziennika zajęć innych: `IN - Nazwisko Imię [klasa]`

Filtr jest w kodzie i działa sam — **nie wycinaj wierszy ręcznie z arkuszy**:

| Plik | Rola |
|---|---|
| `zastepstwa/scripts/privacy_xlsx.py` | zamienia nazwę dziennika IND na sam znacznik `IND` (dane ucznia znikają, kategoria zostaje dla generatorów) |
| `zastepstwa/scripts/build/data.mjs` | pomija zajęcia inne z `IND` oraz zastępstwa/przeniesienia z oddziałem lub grupą `IND` |
| `plan-4-maja-2026/scripts/build_student_changes.py` | pomija te same wpisy w planie uczniowskim |

Dopasowanie jest dosłowne (`^IND?\b`), więc `INFORMATYKA` ani `Indywidualny tok`
się nie łapią. Różnica między liczbą wierszy w arkuszu a liczbą z `npm run data`
bierze się właśnie stąd — podaj ją w raporcie, nie traktuj jako błędu odczytu.
Pusta sekcja zajęć innych jest poprawnym wynikiem, gdy cała paczka to `IND`.

## 2. Przeniesienie poza okres paczki — pokaż mimo to

**Jeżeli data docelowa przeniesienia wykracza poza okres paczki, lekcja i tak
musi być widoczna w nowym miejscu.** Przeniesiona lekcja faktycznie się tam
odbywa — uczeń musi ją zobaczyć w kratce dnia docelowego.

Okno paczki (`validFrom`/`validTo` w `student-changes.json`) liczy się z arkusza
`Opis parametrów` **pliku zastępstw**. Plik przeniesień bywa szerszy, więc cel
przeniesienia potrafi wypaść poza okno. Obsługuje to `student-changes.js`:
dla daty spoza okna nadal nakłada przeniesienia dotykające tej daty
(`c.date === date || c.toDate === date`), a komunikat mówi wprost:

> Przeniesienia na <data>. Poza okresem paczki (<od>–<do>) — brak danych
> o zastępstwach na tę datę.

Dwie rzeczy, których **nie** wolno przy tym zrobić:

- **Nie rozszerzaj `validFrom`/`validTo`**, żeby „załatać" problem. Okno mówi,
  dla jakich dni mamy dane o zastępstwach. Rozszerzone kłamałoby, pokazując
  „brak zastępstw" tam, gdzie po prostu nic nie wiemy.
- **Nie pokazuj takiego dnia jako objętego paczką.** Komunikat musi rozróżniać
  „nie ma zmian" od „nie mamy danych".

Serwis nauczyciela nie ma tego problemu — jego okno to cały semestr
(`publication.json`), więc pokazuje oba końce każdego przeniesienia.

Test `scripts/test_student_changes.cjs` pilnuje tego: dla każdego przeniesienia
z celem poza oknem sprawdza znacznik `Przeniesienie na lekcję N` w kratce,
brak notki przy nagłówku i treść komunikatu. Sprawdzone — psuje się, gdy
zachowanie zniknie.

## 3. Przeniesienie zawsze na obu końcach, z datami po obu stronach

Każde przeniesienie typu `transfer` ma być oznaczone **i w lekcji źródłowej,
i w docelowej**. Przełączenie dnia nie może zostawiać znaczników z poprzedniego
ani ich dublować.

Oba opisy muszą podawać **drugi koniec wraz z datą**, gdy przeniesienie
przechodzi między dniami — sam numer lekcji nie mówi, o który dzień chodzi:

| Koniec | Treść |
|---|---|
| źródłowy | `Przeniesiono z lekcji 8` · `Na wtorek, 29 września 2026, lekcja 9 · Edukacja obywatelska · sala 19` |
| docelowy | `Przeniesienie na lekcję 9` · `Edukacja obywatelska · Kopij Marcin · sala 19 (z wtorku, 22 września 2026, lekcja 8)` |

Przeniesienie w obrębie jednego dnia zostaje przy krótkiej formie
`(z lekcji N)` — powtarzanie tej samej daty to szum.

Dzień tygodnia po stronie docelowej idzie w **dopełniaczu** (`z wtorku`,
`ze środy`, `z piątku`) — `formatDateFrom` w `student-changes.js` ma mapę
odmian. `z wtorek` to błąd gramatyczny, nie literówka do zignorowania.

Wyjątek wynikający z danych, nie błąd: gdy data źródłowa wypada przed
`2026-09-07` (początek planu bazowego), tabela dnia jest ukryta i znacznika nie
widać.

## 4. Kontrole, bez których nie uznajesz aktualizacji za zrobioną

Po każdej przebudowie `student-changes.json`:

```sh
python3 - <<'EOF'
import json, re
d = json.load(open('student-changes.json'))
print(d['validFrom'], d['validTo'], len(d['substitutions']), len(d['transfers']))
for x in d['substitutions'] + d['transfers']:
    if not x['sourceTeacher']:
        print('bez skrótu ->', x['date'], x['period'], x['className'])
    g = x['groupName']
    if g and not any(s.lower() in (g.lower(), 'cała klasa') for s in x['sourceGroups']):
        print('grupa nie pokryta ->', x['date'], x['period'], x['className'], g)
    if re.match(r'^\s*IND?\b', x['className'], re.I) or re.match(r'^\s*IND?\b', x['groupName'], re.I):
        print('IND w publikacji ->', x['date'], x['className'], x['groupName'])
EOF
```

Obie listy i wpisy IND mają być **puste**. Każdy wpis „grupa nie pokryta"
ląduje przy nagłówku tabeli zamiast w kratce.

## 5. Ręczne korekty giną przy następnym eksporcie

Gdy użytkownik zgłasza zmianę, której nie ma w dzienniku (np. odwołanie lekcji),
dopisuje się ją jako wiersz w arkuszu `Oddziały` w konwencji eksportu — jeden
wiersz na lekcję, komunikat z istniejącego słownika (`Uczniowie przychodzą
później`, `Uczniowie zwolnieni do domu`, `Zastępstwo`, `-`).

**Powiedz przy tym wprost, że kolejny eksport ją nadpisze**, jeśli do tego czasu
nie trafi do dziennika. Przy następnej paczce sprawdź, czy eksport ją już
zawiera; jeśli nie, a nadal jest aktualna — dopisz ponownie.

## 6. Raport końcowy

Podaj: okres paczki, liczby (zastępstwa / przeniesienia / dyżury / zajęcia inne),
ile wpisów pominięto jako `IND`, status publikacji obu stron (dopiero
`deploy: success` znaczy, że strona się zmieniła), wynik testów i konkretne
problemy. Napisz wprost, czego nie sprawdziłeś — publicznych adresów nie da się
pobrać z sandboxu (403 na proxy), więc kontroli na żywo nie wykonujesz.
