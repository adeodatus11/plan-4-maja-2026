# Instrukcje dla Claude — plan uczniowski

To repozytorium publikuje **https://plan.szkolamistrzow.info** z gałęzi `main`
przez GitHub Pages. Nakładka zmian to `student-changes.json`, obsługa daty i
renderowanie znaczników to `student-changes.js`.

Typowe zlecenie: użytkownik wrzuca dwa eksporty z dziennika —
`InformacjeOZastepstwach*.xlsx` i `InformacjeOPrzeniesieniach*.xlsx` — i prosi o
aktualizację obu serwisów. Numery w nazwach plików (`_11`, `_8`) to kolejne
eksporty, nie kolejne tygodnie.

Pełny runbook: [AKTUALIZACJA_ZASTEPSTW.md](AKTUALIZACJA_ZASTEPSTW.md). Przeczytaj
go **przed** pierwszym poleceniem, razem z nadrzędną instrukcją z repozytorium
nauczyciela (`zastepstwa`, gałąź `przebudowa`,
`INSTRUKCJA_AKTUALIZACJI_ZASTEPSTW.md`).

Surowe eksporty trzymaj poza repozytorium i oczyść je, zanim trafią gdziekolwiek
do Gita. Do tego repozytorium nie kopiuj ich w ogóle — tu trafia wyłącznie
wygenerowany `student-changes.json`.
