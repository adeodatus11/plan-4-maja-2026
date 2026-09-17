#!/usr/bin/env python3
"""Dopisuje nazwy grup do przedmiotów w tabelach oddziałów planu uczniowskiego.

Eksport planu nie podaje nazw grup w widoku oddziału — lekcje dzielone są tylko
rozbite na osobne wiersze. Nazwy grup są w XML-u planu, więc bierzemy je stamtąd
i wstawiamy do komórki przedmiotu jako `<div class="g">`, tak jak robi to widok
nauczyciela w eksporcie źródłowym.

Skrypt jest idempotentny: najpierw usuwa istniejące etykiety, potem wstawia je
od nowa. Modyfikuje wyłącznie wnętrze komórek przedmiotu, reszta pliku zostaje
bajt w bajt.
"""
from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from update_student_plan import CLASS_ID_RENAMES

ROOT = Path(__file__).resolve().parents[1]
LABEL = re.compile(r"\s*<div class=\"g\">[^<]*</div>")
TD_OPEN = re.compile(r"<td\b[^>]*>")
DAYS = 5


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def csv_ids(value: object) -> list[str]:
    return [part for part in str(value or "").split(",") if part]


def build_group_index(plan_xml: Path) -> dict[tuple[str, int, int], list[dict[str, object]]]:
    """(skrót oddziału, dzień 1-5, numer lekcji) -> lekcje z tej kratki."""
    plan = ET.parse(plan_xml)
    node_map = lambda tag: {node.get("id"): node for node in plan.find(tag)}
    subjects = {i: n.get("name") for i, n in node_map("./subjects").items()}
    teachers = {i: n.get("short") for i, n in node_map("./teachers").items()}
    rooms = {i: n.get("short") for i, n in node_map("./classrooms").items()}
    classes = {i: n.get("short") for i, n in node_map("./classes").items()}
    groups = node_map("./groups")
    lessons = node_map("./lessons")

    index: dict[tuple[str, int, int], list[dict[str, object]]] = {}
    for card in plan.find("./cards"):
        lesson = lessons.get(card.get("lessonid"))
        if lesson is None:
            continue
        period = int(card.get("period"))
        room = ",".join(rooms.get(i, "") for i in csv_ids(card.get("classroomids")))
        shorts = [teachers.get(i, "") for i in csv_ids(lesson.get("teacherids"))]
        subject = subjects.get(lesson.get("subjectid"), "")
        for day, marked in enumerate(card.get("days", ""), start=1):
            if marked != "1" or day > DAYS:
                continue
            for class_id in csv_ids(lesson.get("classids")):
                # Lekcja łączona obejmuje grupy kilku oddziałów — bierzemy tylko te z tego oddziału.
                own = [
                    groups[i]
                    for i in csv_ids(lesson.get("groupids"))
                    if i in groups and groups[i].get("classid") == class_id
                ]
                named = [g.get("name") for g in own if g.get("entireclass") != "1"]
                index.setdefault((classes.get(class_id, ""), day, period), []).append(
                    {"teachers": shorts, "room": room, "subject": subject, "groups": named}
                )
    return index


def cell_grid(table) -> list[dict[int, object]]:
    """Siatka komórek z rozwiniętymi rowspan/colspan, jak w student-changes.js."""
    grid: list[dict[int, object]] = []
    for row_index, row in enumerate(table.find("tbody").find_all("tr", recursive=False)):
        while len(grid) <= row_index:
            grid.append({})
        column = 0
        for cell in row.find_all("td", recursive=False):
            while grid[row_index].get(column) is not None:
                column += 1
            row_span = int(cell.get("rowspan") or 1)
            column_span = int(cell.get("colspan") or 1)
            for r in range(row_index, row_index + row_span):
                while len(grid) <= r:
                    grid.append({})
                for c in range(column, column + column_span):
                    grid[r][c] = cell
            column += column_span
    return grid


def match_lesson(candidates, subject: str, teacher: str, room: str):
    exact = [c for c in candidates if teacher in c["teachers"] and c["room"].casefold() == room.casefold()]
    if len(exact) == 1:
        return exact[0]
    # Sala w planie bywa dopisana ręcznie — przedmiot rozstrzyga pozostałe przypadki.
    fallback = [c for c in candidates if teacher in c["teachers"] and c["subject"].casefold() == subject.casefold()]
    return fallback[0] if len(fallback) == 1 else None


def annotate(html: str, index) -> tuple[str, dict[str, int]]:
    html = LABEL.sub("", html)
    soup = BeautifulSoup(html, "html.parser")

    starts = [m.start() for m in TD_OPEN.finditer(html)]
    positions = {id(cell): start for cell, start in zip(soup.find_all("td"), starts)}
    if len(positions) != len(starts):
        raise SystemExit("Nie udało się zmapować komórek na pozycje w pliku.")

    # Tabele noszą identyfikator wyświetlany, XML zna pierwotny skrót oddziału.
    plan_ids = {display: plan for plan, display in CLASS_ID_RENAMES.items()}

    stats = {"komórki": 0, "grupy": 0, "cała klasa": 0, "bez dopasowania": 0}
    inserts: list[tuple[int, str]] = []
    for table in soup.select("table.plan"):
        html_id = table.get("id")
        class_short = plan_ids.get(html_id, html_id)
        grid = cell_grid(table)
        seen: set[tuple[int, int]] = set()
        for row in grid:
            period = clean(row.get(0).get_text()) if row.get(0) is not None else ""
            if not period.isdigit():
                continue
            for day in range(1, DAYS + 1):
                column = 2 + (day - 1) * 3
                subject_cell, teacher_cell, room_cell = (row.get(column + offset) for offset in (0, 1, 2))
                if subject_cell is None or (id(subject_cell), day) in seen:
                    continue
                seen.add((id(subject_cell), day))
                subject = clean(subject_cell.get_text())
                teacher = clean(teacher_cell.get_text() if teacher_cell is not None else "")
                room = clean(room_cell.get_text() if room_cell is not None else "")
                if not subject or not teacher:
                    continue
                stats["komórki"] += 1
                candidates = index.get((class_short, day, int(period)), [])
                lesson = match_lesson(candidates, subject, teacher, room)
                if lesson is None:
                    stats["bez dopasowania"] += 1
                    # Ostrzegamy tylko tam, gdzie etykieta mogła przepaść; kratka bez grup nic nie traci.
                    if any(c["groups"] for c in candidates) or not candidates:
                        print(
                            f"Bez dopasowania do planu XML, etykieta grupy może brakować: "
                            f"{html_id}, dzień {day}, lekcja {period}, {subject} ({teacher})"
                        )
                    continue
                if not lesson["groups"]:
                    stats["cała klasa"] += 1
                    continue
                stats["grupy"] += 1
                label = ", ".join(lesson["groups"])
                end = html.index("</td>", positions[id(subject_cell)])
                inserts.append((end, f'\n    <div class="g">{label}</div>'))

    for position, markup in sorted(inserts, reverse=True):
        html = html[:position] + markup + html[position:]
    return html, stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path, nargs="?", default=ROOT / "plan-lekcji-2026-09-07.html")
    parser.add_argument("--plan-xml", type=Path, required=True, help="XML planu wskazany w publication.json")
    parser.add_argument("--check", action="store_true", help="tylko raport, bez zapisu")
    args = parser.parse_args()

    source = args.plan.read_text(encoding="utf-8")
    result, stats = annotate(source, build_group_index(args.plan_xml.resolve()))
    summary = ", ".join(f"{key}: {value}" for key, value in stats.items())
    if args.check:
        print(f"Kontrola ({summary}); plik {'wymaga aktualizacji' if result != source else 'aktualny'}.")
        return
    args.plan.write_text(result, encoding="utf-8")
    print(f"Zapisano {args.plan.name} ({summary}).")


if __name__ == "__main__":
    main()
