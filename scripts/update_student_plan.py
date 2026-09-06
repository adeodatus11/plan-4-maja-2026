#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import re
import shutil
from urllib.parse import unquote
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEACHER_REPO = ROOT.parent / "zastepstwa-main"
DEFAULT_LOGO = ROOT.parent / "zastepstwa-main" / "orzel-szkola-mistrzow.png"
CLASS_ID_RENAMES = {
    "2B": "3B",
}


def between(text: str, start: str, end: str) -> str:
    try:
        start_index = text.index(start) + len(start)
        end_index = text.index(end, start_index)
    except ValueError as exc:
        raise SystemExit(f"Nie znaleziono wymaganego fragmentu HTML: {exc}") from exc
    return text[start_index:end_index]


def extract_plan_date(text: str) -> str:
    footer = re.search(r"<footer>(.*?)</footer>", text, flags=re.S)
    if footer:
        return re.sub(r"\s+", " ", footer.group(1)).strip()

    title = re.search(r"<title>(.*?)</title>", text, flags=re.S)
    if title:
        return re.sub(r"\s+", " ", title.group(1)).strip()

    return "Aktualny plan lekcji"


def extract_dobry_plan_logo(text: str) -> str:
    match = re.search(
        r'<a href="https://dobryplan\.edu\.pl" target="_blank">(.*?)</a>',
        text,
        flags=re.S,
    )
    if not match:
        return '<span class="dobry-plan-text">Dobry Plan</span>'

    svg = match.group(1)
    svg = re.sub(r"<title>.*?</title>", "", svg, flags=re.S)
    svg = svg.replace("<svg ", '<svg class="dobry-plan-svg" aria-hidden="true" ')
    return (
        '<a class="dobry-plan" href="https://dobryplan.edu.pl" '
        'target="_blank" rel="noopener" aria-label="Dobry Plan">'
        f"{svg}</a>"
    )


def extract_class_ids(text: str) -> list[str]:
    nav_classes = between(
        text,
        '<div class="h">Oddziały</div>',
        '<div class="h">Nauczyciele</div>',
    )
    ids = re.findall(r'<a class="l" href="#([^"]+)">', nav_classes)
    if not ids:
        raise SystemExit("Nie znaleziono oddziałów w nawigacji.")
    return ids


def display_class_id(plan_id: str) -> str:
    return CLASS_ID_RENAMES.get(plan_id, plan_id)


def extract_teacher_names(text: str) -> dict[str, str]:
    teacher_nav = between(
        text,
        '<div class="h">Nauczyciele</div>',
        '<div class="h">Sale</div>',
    )
    teachers: dict[str, str] = {}
    for teacher_id, teacher_name in re.findall(
        r'<a class="l" href="#([^"]+)">(.*?)</a>',
        teacher_nav,
        flags=re.S,
    ):
        clean_name = re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", "", teacher_name))).strip()
        decoded_id = unquote(teacher_id)
        teachers[teacher_id] = clean_name
        teachers[decoded_id] = clean_name
    return teachers


def extract_table(text: str, plan_id: str) -> str:
    match = re.search(
        rf'<table class="plan" id="{re.escape(plan_id)}">.*?</table>',
        text,
        flags=re.S,
    )
    if not match:
        raise SystemExit(f"Nie znaleziono tabeli oddziału: {plan_id}")
    return match.group(0)


def extract_homeroom_teacher(table_html: str, teachers: dict[str, str]) -> str | None:
    match = re.search(
        r"Zajęcia z wychowawcą.*?</td>\s*<td[^>]*>\s*<a href=\"#([^\"]+)\">",
        table_html,
        flags=re.S,
    )
    if not match:
        return None

    teacher_id = match.group(1)
    return teachers.get(teacher_id) or teachers.get(unquote(teacher_id))


def add_homeroom_to_caption(table_html: str, plan_id: str, homeroom: str | None) -> str:
    caption = f'<span class="class-symbol">{html.escape(plan_id)}</span>'
    if homeroom:
        caption += (
            '<span class="homeroom">Wychowawca: '
            f"{html.escape(homeroom)}</span>"
        )
    return re.sub(
        r"<caption>.*?</caption>",
        f'<caption><span class="class-caption">{caption}</span></caption>',
        table_html,
        count=1,
        flags=re.S,
    )


def add_cell_class(attributes: str, class_name: str) -> str:
    class_match = re.search(r'class="([^"]*)"', attributes)
    if class_match:
        existing = class_match.group(1).split()
        if class_name not in existing:
            existing.append(class_name)
        return (
            attributes[: class_match.start(1)]
            + " ".join(existing)
            + attributes[class_match.end(1) :]
        )
    return f'{attributes} class="{class_name}"'


def mark_lesson_time_cells(table_html: str) -> str:
    def replace(match: re.Match[str]) -> str:
        lesson_attrs = add_cell_class(match.group("lesson_attrs"), "lesson-no")
        time_attrs = add_cell_class(match.group("time_attrs"), "lesson-time")
        return (
            f'{match.group("row_start")}<td{lesson_attrs}>{match.group("lesson_no")}</td>'
            f'{match.group("between")}<td{time_attrs}>{match.group("lesson_time")}</td>'
        )

    return re.sub(
        r'(?P<row_start><tr[^>]*>\s*)'
        r'<td(?P<lesson_attrs>[^>]*)>(?P<lesson_no>\s*\d+\s*)</td>'
        r'(?P<between>\s*)'
        r'<td(?P<time_attrs>[^>]*)>'
        r'(?P<lesson_time>\s*\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\s*)'
        r'</td>',
        replace,
        table_html,
        flags=re.S,
    )


def simplify_internal_links(table_html: str) -> str:
    return re.sub(r'<a href="#[^"]+">([^<]*)</a>', r"\1", table_html)


def normalize_table(table_html: str) -> str:
    table_html = mark_lesson_time_cells(table_html)
    table_html = table_html.replace(" – ", " - ")
    table_html = simplify_internal_links(table_html)
    return table_html


def newest_teacher_plan() -> Path:
    plans = sorted(TEACHER_REPO.glob("plan-lekcji-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].html"))
    if not plans:
        raise SystemExit(f"Nie znaleziono planu lekcji w {TEACHER_REPO}")
    return plans[-1]


def nav_links(class_ids: list[str]) -> str:
    return "\n".join(
        f'                <a class="class-link" href="#{html.escape(plan_id)}">{html.escape(plan_id)}</a>'
        for plan_id in class_ids
    )


def render_page(source_text: str, class_ids: list[str], tables: list[str]) -> str:
    plan_date = extract_plan_date(source_text).replace(" – ", " - ")
    dobry_plan_logo = extract_dobry_plan_logo(source_text)
    first_id = class_ids[0]
    return f"""<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Plan lekcji oddziałów - Szkoła Mistrzów</title>
    <style>
        :root {{
            color-scheme: light;
            --bg: #f4f6f8;
            --panel: #ffffff;
            --panel-soft: #eef4f8;
            --text: #17212b;
            --muted: #5f6f7d;
            --line: #cfd8e3;
            --line-strong: #7d8b99;
            --accent: #0f6f8f;
            --accent-dark: #0a5067;
            --row: #fbfdff;
            --row-alt: #f5f9fb;
            --shadow: 0 16px 40px rgba(23, 33, 43, .09);
        }}

        * {{ box-sizing: border-box; }}

        html {{ scroll-behavior: smooth; }}

        body {{
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.35;
        }}

        a {{ color: inherit; }}

        .layout {{
            min-height: 100dvh;
            display: grid;
            grid-template-columns: 19rem minmax(0, 1fr);
        }}

        nav {{
            position: sticky;
            top: 0;
            height: 100dvh;
            overflow: auto;
            padding: 1.25rem 1rem;
            background: var(--panel);
            border-right: 1px solid var(--line);
        }}

        .brand {{
            display: grid;
            gap: 1rem;
            margin-bottom: 1.5rem;
        }}

        .brand-row {{
            display: grid;
            gap: .85rem;
            justify-items: start;
        }}

        .brand img {{
            display: block;
            max-width: 14rem;
            height: auto;
        }}

        .dobry-plan {{
            display: inline-flex;
            width: 12.5rem;
            color: #111827;
        }}

        .dobry-plan svg,
        .dobry-plan-svg {{
            display: block;
            width: 100%;
            height: auto;
            margin: 0;
        }}

        .dobry-plan-text {{
            font-weight: 900;
        }}

        .site-title {{
            margin: .25rem 0 0;
            font-size: 1.15rem;
            line-height: 1.2;
        }}

        .nav-heading {{
            margin: 1.25rem 0 .75rem;
            color: var(--muted);
            font-size: .78rem;
            font-weight: 800;
            letter-spacing: .04em;
            text-transform: uppercase;
        }}

        .class-list {{
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: .45rem;
        }}

        .class-link {{
            display: inline-flex;
            min-height: 2.55rem;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--line);
            border-radius: .45rem;
            background: #fff;
            color: var(--accent-dark);
            font-weight: 800;
            text-decoration: none;
            transition: background-color .15s ease, border-color .15s ease, color .15s ease;
        }}

        .class-link:hover,
        .class-link:focus-visible,
        .class-link.active {{
            border-color: var(--accent);
            background: var(--accent);
            color: #fff;
            outline: none;
        }}

        main {{
            min-width: 0;
            padding: 1.25rem;
        }}

        .topbar {{
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            max-width: 96rem;
            margin: 0 auto 1rem;
        }}

        .page-heading {{
            margin: 0;
            font-size: clamp(1.45rem, 2.2vw, 2.35rem);
            line-height: 1.12;
        }}

        .date-badge {{
            flex: 0 0 auto;
            border: 1px solid var(--line);
            border-radius: .45rem;
            background: var(--panel);
            color: var(--muted);
            padding: .65rem .8rem;
            font-size: .95rem;
            font-weight: 700;
        }}

        .mobile-classes {{
            display: none;
        }}

        .table-shell {{
            max-width: 96rem;
            margin: 0 auto;
            overflow-x: auto;
            border: 1px solid var(--line);
            border-radius: .55rem;
            background: var(--panel);
            box-shadow: var(--shadow);
        }}

        table.plan {{
            display: none;
            width: 100%;
            min-width: 68rem;
            border-collapse: collapse;
            background: var(--panel);
        }}

        table.plan caption {{
            padding: 1rem .75rem;
            text-align: left;
        }}

        .class-caption {{
            display: flex;
            align-items: baseline;
            gap: .8rem;
            flex-wrap: wrap;
        }}

        .class-symbol {{
            font-size: 1.55rem;
            font-weight: 900;
        }}

        .homeroom {{
            color: var(--muted);
            font-size: .96rem;
            font-weight: 800;
        }}

        table.plan td {{
            padding: .52rem .45rem;
            vertical-align: top;
        }}

        table.plan tbody {{
            border: 1px solid var(--line-strong);
        }}

        table.plan tbody td {{
            border-width: 1px 0 0 1px;
            border-style: solid;
            border-color: var(--line);
        }}

        table.plan thead td {{
            position: sticky;
            top: 0;
            z-index: 1;
            border-top: 1px solid var(--line-strong);
            background: var(--panel-soft);
            text-align: center;
            font-weight: 900;
        }}

        table.plan thead td:nth-child(1) {{ width: 2rem; }}
        table.plan thead td:nth-child(2) {{ width: 7.5rem; }}

        table.plan td.r {{ text-align: right; }}
        table.plan td.t {{ border-top-color: var(--line-strong); }}
        table.plan td.l {{ border-left-color: var(--line-strong); }}
        table.plan td.n {{ border: 0; background: var(--panel); }}
        table.plan tr.d td {{ background: var(--row-alt); }}
        table.plan div.g {{
            padding-top: .25rem;
            padding-left: .75rem;
            color: var(--muted);
            font-size: .82rem;
        }}

        .student-change {{
            display: grid;
            gap: .12rem;
            margin-top: .42rem;
            padding: .42rem .5rem;
            border-left: .22rem solid #14804a;
            border-radius: .28rem;
            background: #eaf7ef;
            color: #174c31;
            font-size: .78rem;
            line-height: 1.25;
        }}

        .student-change strong {{
            font-size: .69rem;
            letter-spacing: .035em;
            text-transform: uppercase;
        }}

        .student-change span {{ font-weight: 750; }}

        .student-change.message {{
            border-left-color: #b45309;
            background: #fff5df;
            color: #713f12;
        }}

        .student-change.room-change {{
            border-left-width: .18rem;
            border-left-color: #617181;
            background: #eef2f5;
            color: #334155;
        }}

        footer {{
            max-width: 96rem;
            margin: 1rem auto 0;
            color: var(--muted);
            font-size: .9rem;
        }}

        @media (max-width: 900px) {{
            .layout {{
                display: block;
            }}

            nav {{
                position: static;
                height: auto;
                overflow: visible;
                padding: .8rem .9rem 0;
                border-right: 0;
                border-bottom: 1px solid var(--line);
            }}

            .brand {{
                grid-template-columns: 1fr auto;
                align-items: center;
                gap: .75rem;
                margin-bottom: .8rem;
            }}

            .brand-row {{
                gap: .45rem;
            }}

            .brand img {{
                max-width: min(11rem, 48vw);
            }}

            .dobry-plan {{
                width: min(9rem, 38vw);
            }}

            .site-title {{
                font-size: 1rem;
            }}

            nav .nav-heading,
            nav .class-list {{
                display: none;
            }}

            main {{
                padding: .8rem .75rem 1.25rem;
            }}

            .topbar {{
                display: grid;
                gap: .6rem;
                margin-bottom: .75rem;
            }}

            .date-badge {{
                width: 100%;
                font-size: .87rem;
            }}

            .mobile-classes {{
                position: sticky;
                top: 0;
                z-index: 5;
                display: flex;
                gap: .45rem;
                margin: 0 -.75rem .75rem;
                padding: .65rem .75rem;
                overflow-x: auto;
                background: rgba(244, 246, 248, .96);
                border-bottom: 1px solid var(--line);
                -webkit-overflow-scrolling: touch;
            }}

            .mobile-classes .class-link {{
                flex: 0 0 auto;
                min-width: 4.35rem;
                min-height: 2.75rem;
                padding-inline: .85rem;
            }}

            .table-shell {{
                border-radius: .45rem;
            }}

            table.plan {{
                min-width: 64rem;
                font-size: .86rem;
            }}

            table.plan caption {{
                padding: .85rem .65rem;
            }}

            .class-caption {{
                display: grid;
                gap: .2rem;
            }}

            .class-symbol {{
                font-size: 1.35rem;
            }}

            .homeroom {{
                font-size: .86rem;
            }}

            table.plan td {{
                padding: .45rem .38rem;
            }}

            table.plan td.lesson-no,
            table.plan td.lesson-time {{
                position: sticky;
                z-index: 3;
                background: var(--panel);
            }}

            table.plan tr.d td.lesson-no,
            table.plan tr.d td.lesson-time {{
                background: var(--row-alt);
            }}

            table.plan td.lesson-no {{
                left: 0;
                width: 2.15rem;
                min-width: 2.15rem;
                max-width: 2.15rem;
                text-align: right;
            }}

            table.plan td.lesson-time {{
                left: 2.15rem;
                width: 7.4rem;
                min-width: 7.4rem;
                max-width: 7.4rem;
                white-space: nowrap;
                box-shadow: 1px 0 0 var(--line-strong);
            }}
        }}

        @media print {{
            body {{ background: #fff; }}
            .layout {{ display: block; }}
            nav, .mobile-classes, .date-badge {{ display: none; }}
            main {{ padding: 0; }}
            .table-shell {{
                overflow: visible;
                border: 0;
                box-shadow: none;
            }}
            table.plan {{
                min-width: 0;
                page-break-after: always;
            }}
        }}
    </style>
</head>
<body>
<div class="layout">
    <nav aria-label="Wybór oddziału">
        <div class="brand">
            <div class="brand-row">
                <img src="orzel-szkola-mistrzow.png" alt="Szkoła Mistrzów">
                <p class="site-title">Plan lekcji oddziałów</p>
            </div>
            {dobry_plan_logo}
        </div>
        <div class="nav-heading">Oddziały</div>
        <div class="class-list">
{nav_links(class_ids)}
        </div>
    </nav>
    <main>
        <div class="topbar">
            <h1 class="page-heading">Plan lekcji oddziałów</h1>
            <div class="date-badge">{html.escape(plan_date)}</div>
        </div>
        <div class="mobile-classes" aria-label="Wybór oddziału">
{nav_links(class_ids)}
        </div>
        <div class="table-shell">
{chr(10).join(tables)}
        </div>
        <footer>{html.escape(plan_date)}. Bieżące zastępstwa i zmiany sal są oznaczone bezpośrednio w planie.</footer>
    </main>
</div>
<script>
(function() {{
    const plans = Array.from(document.getElementsByClassName("plan"));
    const links = Array.from(document.getElementsByClassName("class-link"));
    const fallbackId = "{html.escape(first_id)}";

    function setActive(id) {{
        plans.forEach((plan) => {{
            plan.style.display = plan.id === id ? "table" : "none";
        }});
        links.forEach((link) => {{
            const active = link.getAttribute("href") === "#" + id;
            link.classList.toggle("active", active);
            if (active) {{
                link.setAttribute("aria-current", "page");
            }} else {{
                link.removeAttribute("aria-current");
            }}
        }});
    }}

    function nav() {{
        const requestedId = decodeURIComponent(window.location.hash.substring(1));
        const found = plans.some((plan) => plan.id === requestedId);
        const id = found ? requestedId : fallbackId;
        if (!found && window.location.hash) {{
            history.replaceState(null, "", "#" + fallbackId);
        }}
        setActive(id);
    }}

    window.addEventListener("hashchange", nav);
    nav();
}})();
</script>
<script src="student-changes.js" defer></script>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Buduje uczniowski plan oddziałów z pełnego planu lekcji."
    )
    parser.add_argument(
        "source",
        nargs="?",
        default=None,
        help="Ścieżka do pełnego pliku HTML planu lekcji. Bez argumentu skrypt bierze najnowszy plan z repo nauczycielskiego.",
    )
    parser.add_argument(
        "--logo",
        default=str(DEFAULT_LOGO),
        help="Ścieżka do logo Szkoły Mistrzów.",
    )
    parser.add_argument(
        "--output",
        default=str(ROOT / "index.html"),
        help="Ścieżka do pliku wynikowego HTML.",
    )
    args = parser.parse_args()

    source = Path(args.source).expanduser().resolve() if args.source else newest_teacher_plan()
    logo = Path(args.logo).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"Nie znaleziono źródłowego planu: {source}")
    if not logo.exists():
        raise SystemExit(f"Nie znaleziono logo: {logo}")

    source_text = source.read_text(encoding="utf-8")
    source_class_ids = extract_class_ids(source_text)
    class_ids = [display_class_id(plan_id) for plan_id in source_class_ids]
    teachers = extract_teacher_names(source_text)
    tables = []
    missing_homerooms = []
    for source_plan_id, plan_id in zip(source_class_ids, class_ids):
        table = extract_table(source_text, source_plan_id)
        if source_plan_id != plan_id:
            table = table.replace(
                f'<table class="plan" id="{html.escape(source_plan_id)}">',
                f'<table class="plan" id="{html.escape(plan_id)}">',
                1,
            )
        homeroom = extract_homeroom_teacher(table, teachers)
        if not homeroom:
            missing_homerooms.append(plan_id)
        table = add_homeroom_to_caption(table, plan_id, homeroom)
        tables.append(normalize_table(table))

    output.write_text(
        render_page(source_text, class_ids, tables),
        encoding="utf-8",
    )
    shutil.copy2(logo, ROOT / "orzel-szkola-mistrzow.png")
    print(f"Zapisano {output.name}: {len(class_ids)} oddziałów z {source.name}")
    if missing_homerooms:
        print("Brak rozpoznanego wychowawcy:", ", ".join(missing_homerooms))


if __name__ == "__main__":
    main()
