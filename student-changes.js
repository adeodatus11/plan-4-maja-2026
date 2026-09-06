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
        const grid = buildGrid(table);
        const day = dayIndex(change.date);
        if (day < 1 || day > 5) return null;
        const logicalColumn = 2 + (day - 1) * 3 + (roomColumn ? 2 : 0);
        const candidates = [];
        grid.forEach((row) => {
            const lessonNumber = Number(String(row[0]?.textContent || "").trim());
            const cell = row[logicalColumn];
            if (lessonNumber === change.period && cell && !candidates.includes(cell)) candidates.push(cell);
        });
        const nonEmpty = candidates.filter((cell) => normalize(cell.textContent));
        const group = normalize(change.groupName);
        if (group) {
            const groupMatch = nonEmpty.find((cell) => normalize(cell.textContent).includes(group));
            if (groupMatch) return groupMatch;
        }
        return nonEmpty[0] || candidates[0] || null;
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

    function applyChanges(payload) {
        payload.substitutions.forEach((change) => {
            const table = document.getElementById(change.className);
            if (!table) return;
            const cell = matchingCell(table, change, false);
            const label = change.type === "substitution" ? "Zastępstwo" : "Zmiana";
            const room = change.room ? ` · sala ${change.room}` : "";
            const subject = change.subject ? `${change.subject} · ` : "";
            appendChange(cell, change.type, label, `${subject}${change.message}${room}`);
        });

        payload.transfers.forEach((change) => {
            const table = document.getElementById(change.className);
            if (!table) return;
            const cell = matchingCell(table, change, true);
            appendChange(cell, "room-change", "Zmiana sali", `${change.fromRoom} → ${change.toRoom}`);
        });
    }

    fetch("student-changes.json", { cache: "no-store" })
        .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(applyChanges)
        .catch((error) => console.error("Nie udało się wczytać zmian planu:", error));
})();
