// ---------------------------------------------------------------------------
// CSV -> filas (string[][]) (PURO). Lo usan el seed y las plantillas: así los
// mismos parsers de catalogParsers.js leen una pestaña del Sheet o un CSV.
// ---------------------------------------------------------------------------
// Detecta el separador (',' o ';') con la primera línea con contenido, respeta
// campos entre comillas dobles ("" = comilla literal), quita el BOM e ignora
// las líneas totalmente vacías.
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/).find((l) => l.trim()) || "";
  const semis = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delim = semis > commas ? ";" : ",";

  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const endCell = () => { row.push(cell.trim()); cell = ""; };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) endCell();
    else if (ch === "\n") endRow();
    else if (ch !== "\r") cell += ch;
  }
  endRow();
  return rows;
}
