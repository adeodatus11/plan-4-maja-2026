(function () {
    "use strict";

    const normalize = (value) => String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    function dayIndex(date) {
        const value = new Date(`${date}T12:00:00`);
        return value.getDay();
    }

    function buildGrid(table) {
        const rows = Array.from(table.tBodies[0]?.rows || []);
        const grid = [];
        rows.forEach((row, rowIndex) => {
            grid[rowIndex] ||= [];
            let columnIndex = 0;
            Array.from(row.cells).forEach((cell) => {
                while (grid[rowIndex][columnIndex]) columnIndex += 1;
                const rowSpan = Number(cell.getAttribute("rowspan")) || 1;
                const columnSpan = Number(cell.getAttribute("colspan")) || 1;
                for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
                    grid[r] ||= [];
                    for (let c = columnIndex; c < columnIndex + columnSpan; c += 1) {
                        grid[r][c] = cell;
                    }
                }
                columnIndex += columnSpan;
            });
        });
        return grid;
    }

    function matchingCell(table, change, roomColumn) {
        if (change.groupName && !(change.sourceGroups || []).some(group => normalize(group) === normalize(change.groupName) || normalize(group) === "cała klasa")) return null;
        const grid = buildGrid(table);
        const day = dayIndex(change.date);
        if (day < 1 || day > 5) return null;
        const logicalColumn = 2 + (day - 1) * 3;
        const candidates = [];
        grid.forEach((row) => {
            if (Number(String(row[0]?.textContent || "").trim()) !== change.period) return;
            // Teacher identifies the parallel lesson even when the class table omits group labels.
            if (!change.sourceTeacher || String(row[logicalColumn + 1]?.textContent || "").trim() !== change.sourceTeacher) return;
            const subjectCell = row[logicalColumn];
            const group = normalize(subjectCell?.querySelector(".g")?.textContent);
            if (group && change.groupName && group !== normalize(change.groupName)) return;
            const cell = row[logicalColumn + (roomColumn ? 2 : 0)];
            if (roomColumn && change.fromRoom && normalize(cell?.textContent) !== normalize(change.fromRoom)) return;
            if (cell && !candidates.includes(cell)) candidates.push(cell);
        });
        // Ambiguous or missing lessons must never fall back to the first parallel group.
        return candidates.length === 1 ? candidates[0] : null;
    }

    function appendChange(cell, className, label, detail) {
        if (!cell) return;
        const note = document.createElement("div");
        note.className = `student-change ${className}`;
        const heading = document.createElement("strong");
        const text = document.createElement("span");
        heading.textContent = label;
        text.textContent = detail;
        note.append(heading, text);
        cell.appendChild(note);
    }

    function applyRoomChange(cell, change) {
        if (!cell) return;
        const originalRoom = document.createElement("span");
        originalRoom.className = "room-change-old";
        while (cell.firstChild) originalRoom.appendChild(cell.firstChild);

        const newRoom = document.createElement("span");
        newRoom.className = "room-change-new";
        newRoom.textContent = change.toRoom;

        cell.classList.add("room-change-cell");
        cell.append(originalRoom, newRoom);
        cell.setAttribute("aria-label", `Zmiana sali: ${change.fromRoom} na ${change.toRoom}`);
    }

    function applyChanges(payload) {
        payload.substitutions.forEach((change) => {
            const table = document.getElementById(change.className);
            if (!table) return;
            const cell = matchingCell(table, change, false);
            if (!cell) {
                appendChange(table.caption, "message", `Zmiana ${change.date}, lekcja ${change.period}${change.groupName ? " · " + change.groupName : ""}`, `${change.subject} · ${change.message}${change.room ? " · sala " + change.room : ""}`);
                return;
            }
            const label = change.type === "substitution" ? "Zastępstwo" : "Zmiana";
            const room = change.room ? ` · sala ${change.room}` : "";
            const subject = change.subject ? `${change.subject} · ` : "";
            appendChange(cell, change.type, label, `${change.groupName ? change.groupName + " · " : ""}${subject}${change.message}${room}`);
        });

        payload.transfers.forEach((change) => {
            const table = document.getElementById(change.className);
            if (!table) return;
            if (change.type !== "transfer") {
                const cell = matchingCell(table, change, true);
                if (cell) applyRoomChange(cell, change);
                else appendChange(table.caption, "room-change", `Zmiana sali, lekcja ${change.period}`, `${change.subject} · sala ${change.fromRoom} → ${change.toRoom}`);
                return;
            }
            if (change.date === selectedDate) {
                const source = matchingCell(table, change, false);
                if (source) {
                    const old = document.createElement("span"); old.className="transfer-old";
                    while(source.firstChild) old.append(source.firstChild);
                    source.append(old);
                }
                appendChange(source || table.caption, "message", `Przeniesiono z lekcji ${change.period}`, `Na ${formatDate(change.toDate)}, lekcja ${change.toPeriod} · ${change.subject} · sala ${change.toRoom}`);
            }
            if (change.toDate === selectedDate) {
                const grid = buildGrid(table);
                const target = grid.find(row => Number(row[0]?.textContent.trim()) === change.toPeriod)?.[2 + (dayIndex(change.toDate)-1)*3];
                // Przy przeniesieniu między dniami sam numer lekcji nie mówi, skąd ona jest.
                const origin = change.date === change.toDate
                    ? `z lekcji ${change.period}`
                    : `z ${formatDateFrom(change.date)}, lekcja ${change.period}`;
                appendChange(target || table.caption, "room-change", `Przeniesienie na lekcję ${change.toPeriod}`, `${change.subject} · ${change.teacher} · sala ${change.toRoom} (${origin})`);
            }
        });
    }

    const tables = Array.from(document.querySelectorAll("table.plan"));
    const originals = new Map(tables.map(table => [table, table.innerHTML]));
    const formatDate = date => new Intl.DateTimeFormat("pl-PL", {weekday:"long", day:"numeric", month:"long", year:"numeric", timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"));
    // "z wtorku, 22 września 2026" — dopełniacz, bo "z wtorek" byłoby błędem.
    const weekdayFrom = {"poniedziałek":"poniedziałku","wtorek":"wtorku","środa":"środy","czwartek":"czwartku","piątek":"piątku","sobota":"soboty","niedziela":"niedzieli"};
    const formatDateFrom = date => { const [weekday, ...rest] = formatDate(date).split(", "); return [weekdayFrom[weekday] || weekday, ...rest].join(", "); };
    const isoToday = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/Warsaw", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
    const addDays = (date, n) => { const d = new Date(date+"T12:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
    const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(new Date(value+"T12:00:00Z").getTime()) && new Date(value+"T12:00:00Z").toISOString().slice(0,10) === value;
    let selectedDate, payload;
    const controls = document.createElement("section");
    controls.className = "plan-date-controls";
    controls.setAttribute("aria-label", "Wybór daty planu");
    controls.innerHTML = `<div class="date-actions"><button id="plan-prev" type="button" aria-label="Poprzedni dzień">←</button><label for="plan-date">Data planu<input id="plan-date" type="date" min="2026-09-07" max="2026-12-11"></label><button id="plan-next" type="button" aria-label="Następny dzień">→</button><button id="plan-today" type="button">Dzisiaj</button></div><h2 id="selected-plan-date" aria-live="polite">Wczytywanie daty planu…</h2><p id="plan-data-status" role="status">Wczytywanie zastępstw…</p><div id="plan-week-days" class="date-actions" aria-label="Dni wybranego tygodnia"></div>`;
    document.querySelector(".topbar").after(controls);
    const input = document.getElementById("plan-date");
    const status = document.getElementById("plan-data-status");
    const showDay = table => {
        const index = dayIndex(selectedDate);
        const cells = new Set();
        buildGrid(table).forEach(row => row.forEach((cell, col) => {
            if (cells.has(cell)) return;
            cells.add(cell);
            cell.hidden = col >= 2 && Math.floor((col-2)/3) !== index-1;
        }));
        Array.from(table.tHead.rows[0].cells).forEach((cell, col) => {
            cell.hidden = col >= 2 && col !== index+1;
            if (col === index+1) cell.textContent = formatDate(selectedDate);
        });
    };
    function renderDate(date) {
        if (!validDate(date)) return;
        selectedDate = date;
        input.value = date;
        const params = new URLSearchParams(location.search); params.set("date", date);
        history.replaceState(null, "", location.pathname+"?"+params+location.hash);
        const weekend = [0,6].includes(dayIndex(date));
        const outside = date < input.min || date > input.max;
        document.getElementById("selected-plan-date").textContent = "Plan na " + formatDate(date);
        document.querySelector(".table-shell").hidden = weekend || outside;
        const monday = addDays(date, 1-(dayIndex(date)||7));
        const weekButtons = document.getElementById("plan-week-days");
        weekButtons.replaceChildren();
        for (let i=0; i<5; i++) {
            const d = addDays(monday,i), b = document.createElement("button");
            b.type="button"; b.textContent=new Intl.DateTimeFormat("pl-PL",{weekday:"short",day:"numeric",month:"numeric",timeZone:"UTC"}).format(new Date(d+"T12:00:00Z"));
            b.setAttribute("aria-pressed", String(d===date)); b.onclick=()=>renderDate(d); weekButtons.append(b);
        }
        tables.forEach(t => {t.innerHTML=originals.get(t);});
        if (!payload) status.textContent = "Nie udało się pobrać zastępstw. Widoczny jest plan bazowy.";
        else if (date < payload.validFrom || date > payload.validTo) {
            // Przeniesienie może celować poza okres paczki. Lekcja musi być widoczna
            // w nowym miejscu, ale o zastępstwach na ten dzień nadal nic nie wiemy.
            const reaching = payload.transfers.filter(c => c.date === date || c.toDate === date);
            if (reaching.length) {
                applyChanges({substitutions: [], transfers: reaching});
                status.textContent = `Przeniesienia na ${formatDate(date)}. Poza okresem paczki (${payload.validFrom.split("-").reverse().join(".")}–${payload.validTo.split("-").reverse().join(".")}) — brak danych o zastępstwach na tę datę.`;
            } else status.textContent = "Brak opublikowanej paczki zastępstw na tę datę. Widoczny plan bazowy.";
        }
        else {
            applyChanges({substitutions:payload.substitutions.filter(c=>c.date===date), transfers:payload.transfers.filter(c=>c.date===date || c.toDate===date)});
            status.textContent = `Plan z uwzględnieniem zastępstw i przeniesień na ${formatDate(date)}. Paczka: ${payload.validFrom.split("-").reverse().join(".")}–${payload.validTo.split("-").reverse().join(".")}.`;
        }
        if (weekend) status.textContent="Dzień wolny od regularnych lekcji.";
        if (outside) status.textContent="Data poza okresem obowiązywania tego planu (07.09–11.12.2026).";
        tables.forEach(showDay);
    }
    input.onchange=()=>renderDate(input.value);
    document.getElementById("plan-prev").onclick=()=>renderDate(addDays(selectedDate,-1));
    document.getElementById("plan-next").onclick=()=>renderDate(addDays(selectedDate,1));
    document.getElementById("plan-today").onclick=()=>renderDate(isoToday());
    const initial = new URLSearchParams(location.search).get("date");
    let defaultDate = isoToday();
    if (dayIndex(defaultDate) === 0) defaultDate=addDays(defaultDate,1);
    else if (dayIndex(defaultDate) === 6) defaultDate=addDays(defaultDate,2);
    selectedDate=validDate(initial) ? initial : defaultDate;
    fetch("student-changes.json", { cache: "no-store" })
        .then(response => {if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json();})
        .then(data => { if (!validDate(data.validFrom) || !validDate(data.validTo) || !Array.isArray(data.substitutions) || !Array.isArray(data.transfers)) throw new Error("Niepoprawny format paczki"); payload=data; renderDate(selectedDate); })
        .catch(error => { console.error("Nie udało się wczytać zmian planu:",error); renderDate(selectedDate); });
})();
