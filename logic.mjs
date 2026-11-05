"use strict";
// Pure shared logic for the PDPEF app. No DOM, no network, no globals mutated.
// Wording comes from the programme's framework — nothing here is camp-specific.

export const SELF_UNDO_WINDOW_MS = 15 * 60 * 1000;

export function normText(s) {
  return String(s == null ? "" : s).normalize("NFC").replace(/\s+/g, " ").trim();
}

function fold(s) {
  return normText(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function txt(ml, lang) {
  if (!ml) return "";
  return ml[lang] || ml.en || "";
}

const byPosition = (a, b) => a.position - b.position;
export function goalsOf(fw) { return fw.goals.slice().sort(byPosition); }
export function indicatorsOf(fw) { return fw.indicators.slice().sort(byPosition); }
export function indicatorsByGoal(fw) {
  const inds = indicatorsOf(fw);
  return goalsOf(fw).map(goal => ({ goal, indicators: inds.filter(i => i.goal_code === goal.code) }));
}
export function findGoal(fw, code) { return fw.goals.find(g => g.code === code) || null; }
export function findIndicator(fw, code) { return fw.indicators.find(i => i.code === code) || null; }

export function buildGrid(participants, entries) {
  const grid = {};
  participants.forEach(p => { grid[p.id] = {}; });
  entries.forEach(e => {
    if (e.removed_at) return;
    const row = grid[e.participant_id];
    if (!row) return;
    (row[e.indicator_code] = row[e.indicator_code] || []).push(e);
  });
  return grid;
}

export function usageCounts(entries) {
  const c = {};
  entries.forEach(e => { if (!e.removed_at) c[e.evidence_id] = (c[e.evidence_id] || 0) + 1; });
  return c;
}

export function searchEvidence(evidence, indicatorCode, query, participantId, counts) {
  const toks = fold(query).split(" ").filter(Boolean);
  return evidence
    .filter(ev => ev.indicator_code === indicatorCode && ev.status === "active"
      && (!ev.participant_id || ev.participant_id === participantId)
      && toks.every(tk => fold(ev.text).indexOf(tk) >= 0))
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.text.localeCompare(b.text, "pt"));
}

export function findExact(evidence, indicatorCode, text) {
  const n = normText(text).toLowerCase();
  return evidence.find(ev => ev.indicator_code === indicatorCode && ev.status === "active"
    && !ev.participant_id && normText(ev.text).toLowerCase() === n) || null;
}

export function applyOps(data, ops) {
  let evidence = data.evidence.slice();
  let entries = data.entries.slice();
  ops.forEach(op => {
    const p = op.payload;
    if (op.method === "add_evidence" && !evidence.some(e => e.id === p.id)) {
      evidence.push({ id: p.id, programme_id: op.programmeId, indicator_code: p.indicator,
        text: normText(p.text), participant_id: p.participantId || null, status: "active",
        added_by: p.authorId, added_by_name: p.authorName, added_at: op.at });
    } else if (op.method === "add_entry"
      && !entries.some(e => e.id === p.id)
      && !entries.some(e => e.participant_id === p.participantId && e.indicator_code === p.indicator
        && e.evidence_id === p.evidenceId && !e.removed_at)) {
      entries.push({ id: p.id, programme_id: op.programmeId, participant_id: p.participantId,
        indicator_code: p.indicator, evidence_id: p.evidenceId, added_by: p.authorId,
        added_by_name: p.authorName, added_at: op.at, removed_by: null, removed_by_name: "",
        removed_at: null });
    } else if (op.method === "remove_entry") {
      entries = entries.map(e => e.id === p.entryId
        ? Object.assign({}, e, { removed_by: p.authorId, removed_by_name: p.authorName, removed_at: op.at }) : e);
    } else if (op.method === "hide_evidence") {
      evidence = evidence.map(e => e.id === p.evidenceId ? Object.assign({}, e, { status: "hidden" }) : e);
    }
  });
  return { evidence, entries };
}

export function canSelfUndo(entry, userId, now, windowMs = SELF_UNDO_WINDOW_MS) {
  return !!entry && entry.added_by === userId && !entry.removed_at &&
    (now - Date.parse(entry.added_at)) <= windowMs;
}

export function indicatorStatus(grid, participantId, code) {
  return ((grid[participantId] || {})[code] || []).length ? "Y" : "N";
}

export function delegationsOf(participants) {
  const out = [];
  participants.forEach(p => { if (out.indexOf(p.country) < 0) out.push(p.country); });
  return out;
}

export function normJoinCode(s) {
  return String(s == null ? "" : s).replace(/\s+/g, "").toUpperCase();
}

function splitRow(line, delim) {
  const cells = [];
  let i = 0;
  while (true) {
    while (i < line.length && (line[i] === " " || line[i] === "\t") && line[i] !== delim) i++;
    let cell = "";
    if (line[i] === '"') {
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { cell += '"'; i += 2; continue; }
          i++;
          break;
        }
        cell += line[i++];
      }
      while (i < line.length && line[i] !== delim) i++;
      cells.push(cell.trim());
    } else {
      let j = i;
      while (j < line.length && line[j] !== delim) j++;
      cells.push(line.slice(i, j).trim());
      i = j;
    }
    if (i >= line.length) break;
    i++; // skip delimiter
  }
  return cells;
}

export function parseRosterCsv(text) {
  const lines = String(text == null ? "" : text).replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = lines.find(l => l.trim());
  const delim = !first ? "," : first.indexOf("\t") >= 0 ? "\t" : first.indexOf(";") >= 0 ? ";" : ",";
  const rows = [];
  lines.forEach((l, idx) => {
    if (l.trim()) rows.push({ line: idx + 1, cells: splitRow(l, delim) });
  });
  if (rows.length && ["name", "nome"].includes(fold(rows[0].cells[0]))) rows.shift();
  return rows.map(({ line, cells: r }) => {
    if (r.length < 2 || !r[0] || !r[1]) {
      const err = new Error("roster line " + line + " needs a name and a country");
      err.line = line;
      throw err;
    }
    return { name: r[0], country: r[1], gender: r[2] || "" };
  });
}

export function neighbours(list, item) {
  const i = list.indexOf(item), n = list.length;
  if (i < 0 || !n) return { prev: null, next: null };
  return { prev: list[(i + n - 1) % n], next: list[(i + 1) % n] };
}
