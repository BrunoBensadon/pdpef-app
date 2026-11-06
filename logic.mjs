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

// Goal colours: the framework's own, else the classic Village palette for goals 1-4, else grey.
const AREA_DEFAULTS = { "1": "#0072CE", "2": "#509E2F", "3": "#AA0061", "4": "#B8860B" };
export function goalColour(fw, goalCode) {
  const g = findGoal(fw, goalCode);
  return (g && g.colour) || AREA_DEFAULTS[goalCode] || "#6B6B6B";
}
// A light background: the colour mixed with white (amount = share of the colour).
export function tint(hex, amount = 0.09) {
  const n = parseInt(hex.slice(1), 16);
  const mix = c => Math.round(c * amount + 255 * (1 - amount));
  return "#" + [n >> 16, (n >> 8) & 255, n & 255].map(c => mix(c).toString(16).padStart(2, "0")).join("");
}
export function goalStyle(fw, goalCode) {
  const c = goalColour(fw, goalCode);
  return "--goal:" + c + ";--goalbg:" + tint(c);
}

// Delegations members can pick that never appear among participants (grid, print, sheet).
export const STAFF_DELEGATION = "Staff";
export function joinOnlyDelegations(fw) {
  return [STAFF_DELEGATION].concat((fw && fw.join_delegations) || []);
}
export function isReservedDelegation(fw, name) {
  const n = normText(name).toLowerCase();
  return joinOnlyDelegations(fw).some(x => x.toLowerCase() === n);
}

// Genders are stored in English; the UI translates the labels.
export const GENDERS = ["Male", "Female", "Other"];
const GENDER_WORDS = {
  Male: ["m", "male", "masculino", "menino", "boy"],
  Female: ["f", "female", "feminino", "menina", "girl"],
  Other: ["o", "other", "outro", "outra"],
};
// "" for blank, one of GENDERS, or null when the value is not recognised.
export function normGender(s) {
  const v = fold(s);
  if (!v) return "";
  return GENDERS.find(g => GENDER_WORDS[g].includes(v)) || null;
}

// Rows pasted from a spreadsheet: name, delegation, gender. An optional header line is skipped.
export function parseRosterPaste(text) {
  const lines = String(text == null ? "" : text).replace(/^\uFEFF/, "").split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].indexOf("\t") >= 0 ? "\t" : lines[0].indexOf(";") >= 0 ? ";" : ",";
  let rows = lines.map(l => splitRow(l, delim));
  if (["name", "nome", "participant", "participante"].includes(fold(rows[0][0]).split(" ")[0])) rows = rows.slice(1);
  return rows.filter(r => r[0]).map(r => {
    const raw = r[2] || "", g = normGender(raw);
    return { name: r[0], country: r[1] || "", gender: g || "", genderUnknown: g === null };
  });
}

// What a roster draft changes, in save_roster's shape. Rows whose only change is a delegation
// rename are covered by the rename and not repeated as upserts.
export function rosterDiff(original, rows, renames) {
  const byId = {};
  original.forEach(p => { byId[p.id] = p; });
  const renamed = c => renames.reduce((x, rn) => (rn.from === x ? rn.to : x), c);
  const upserts = [], deletes = [];
  rows.forEach(r => {
    const o = byId[r.id];
    if (r.del) { if (o) deletes.push(r.id); return; }
    const row = { id: r.id, name: normText(r.name), country: normText(r.country), gender: r.gender || "" };
    if (!o || o.name !== row.name || renamed(o.country) !== row.country || (o.gender || "") !== row.gender) upserts.push(row);
  });
  return { renames: renames.filter(x => x.from !== x.to).map(x => ({ from: x.from, to: x.to })), upserts, deletes };
}
export function changeCount(diff) { return diff.renames.length + diff.upserts.length + diff.deletes.length; }

// The evidence the printed form shows for one cell. The sheet uses the same rule for "Y",
// so the sheet and the printout never disagree.
export function printedEvidence(grid, evIdx, participantId, code) {
  return ((grid[participantId] || {})[code] || []).map(en => evIdx[en.evidence_id]).filter(Boolean);
}

export function localDate(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function sheetValue({ hasEvidence, endDate, today }) {
  if (hasEvidence) return "Y";
  if (endDate && today >= endDate) return "N";
  return "";
}

export function sheetRows(participants, fw, grid, evIdx, endDate, today) {
  const inds = indicatorsOf(fw), order = delegationsOf(participants);
  return participants.slice()
    .sort((a, b) => order.indexOf(a.country) - order.indexOf(b.country) || a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map(p => ({ id: p.id, name: p.name, delegation: p.country, gender: p.gender || "",
      values: inds.map(i => sheetValue({ hasEvidence: printedEvidence(grid, evIdx, p.id, i.code).length > 0, endDate, today })) }));
}

// Data rows only (no header, no names): what the old sheet's B15:T<N> copy gave.
export function sheetTsv(rows) {
  return rows.map(r => [r.delegation, r.gender].concat(r.values)
    .map(c => String(c).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

export function xlsxFileName(programme) {
  return (programme.name + (programme.year ? " " + programme.year : "") + " PDPEF.xlsx").replace(/[\\/:*?"<>|]+/g, "-");
}
