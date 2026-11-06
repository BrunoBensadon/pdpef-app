"use strict";
// Setup: the programme's final day and its participant roster (staff and platform admin).
// Roster edits live in a draft (module state, not the DOM) and are saved in one atomic
// save_roster call. The draft survives the 60-second background refresh.
import { state, reloadData, canWrite, render } from "../store.mjs";
import { delegationsOf, parseRosterPaste, rosterDiff, changeCount, GENDERS, joinOnlyDelegations, normText } from "../logic.mjs";
import { t, tn } from "../i18n.mjs";
import { esc, toast, errorText } from "../ui.mjs";
import { renderShell } from "../shell.mjs";

let saving = false; // true while a Save is in flight: the roster is locked
let draft = null; // { pid, original, rows: [{id, code, name, country, gender, isNew, del, flagGender}], renames: [] }

function initDraft() {
  const d = state.data;
  return {
    pid: d.programme.id,
    original: d.participants.map(p => Object.assign({}, p)),
    rows: d.participants.map(p => ({ id: p.id, code: p.code, name: p.name, country: p.country, gender: p.gender || "",
      isNew: false, del: false, flagGender: false })),
    renames: [],
  };
}
const diff = () => rosterDiff(draft.original, draft.rows, draft.renames);
export function isSetupDirty() { return !!draft && changeCount(diff()) > 0; }

// Lock (or unlock) every roster control while a Save is in flight.
function setBusy(on) {
  ["setupTable", "addRow", "discard", "save"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const ctl = el.matches("input,select,button") ? [el] : [];
    el.querySelectorAll("input,select,button").forEach(c => ctl.push(c));
    ctl.forEach(c => { c.disabled = on ? true : c.dataset.used === "1"; });
  });
}

// The router calls this before leaving a …/setup route. false = stay.
export function leaveSetupOk() {
  if (!isSetupDirty()) return true;
  if (!confirm(t("setup.leave"))) return false;
  if (!saving) draft = null;
  return true;
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", e => { if (isSetupDirty()) { e.preventDefault(); e.returnValue = ""; } });
}

const isReserved = name => joinOnlyDelegations(state.data.framework).some(x => x.toLowerCase() === normText(name).toLowerCase());
const usage = id => state.data.entries.filter(e => e.participant_id === id).length +
  state.data.evidence.filter(ev => ev.participant_id === id).length;

export function renderSetup() {
  const pid = state.data.programme.id;
  if (!draft || draft.pid !== pid || !isSetupDirty()) draft = initDraft();
  else if (document.getElementById("setupTable")) return; // keep what the user is typing
  paint();
}

function paint() {
  const d = state.data, rw = canWrite(), sy = window.scrollY, dis = rw ? "" : " disabled";
  const order = delegationsOf(draft.rows.filter(r => r.country));
  const groups = order.map(c => ({ country: c, rows: draft.rows.filter(r => r.country === c) }));
  const loose = draft.rows.filter(r => !r.country);
  if (loose.length) groups.push({ country: "", rows: loose });
  const genderSel = r => '<select class="sgender"' + dis + '><option value=""></option>' +
    GENDERS.map(g => '<option value="' + g + '"' + (r.gender === g ? " selected" : "") + ">" + esc(t("gender." + g)) + "</option>").join("") +
    (r.gender && GENDERS.indexOf(r.gender) < 0 ? '<option value="' + esc(r.gender) + '" selected>' + esc(r.gender) + "</option>" : "") +
    "</select>";
  const rowHtml = r => {
    const used = r.isNew ? 0 : usage(r.id);
    return '<tr data-id="' + esc(r.id) + '"' + (r.del ? ' class="del"' : "") + ">" +
      '<td><input class="sname" value="' + esc(r.name) + '"' + dis + "></td>" +
      '<td><input class="scountry" list="delegList" value="' + esc(r.country) + '"' + dis + "></td>" +
      "<td" + (r.flagGender ? ' class="flag" title="' + esc(t("setup.genderUnknown")) + '"' : "") + ">" + genderSel(r) + "</td>" +
      "<td>" + (rw ? '<button type="button" class="btn sdel"' + (used
        ? ' disabled data-used="1" title="' + esc(tn("setup.cantDelete", used)) + '"'
        : ' title="' + esc(t("setup.delete")) + '"') + ">✕</button>" : "") + "</td></tr>";
  };
  const body = groups.map(g => '<tr class="deleg"><td colspan="4">' + esc(g.country || "—") +
    (rw && g.country ? ' <button type="button" class="btn srename" data-deleg="' + esc(g.country) + '">✎ ' + esc(t("setup.rename")) + "</button>" : "") +
    "</td></tr>" + g.rows.map(rowHtml).join("")).join("");
  const n = changeCount(diff());
  renderShell(null,
    '<div class="card"><h3>' + esc(t("setup.title")) + "</h3>" +
    (rw ? "" : '<p class="banner">' + esc(t("setup.readOnly")) + "</p>") +
    "<label>" + esc(t("setup.finalDay")) + ' <input type="date" id="endDate" value="' + esc(d.programme.end_date || "") + '"' + dis + "></label>" +
    '<p class="muted">' + esc(t("setup.finalDayHelp")) + "</p></div>" +
    '<div class="card"><h3>' + esc(t("setup.participants")) + "</h3>" +
    (rw ? '<p class="muted">' + esc(t("setup.pasteHelp")) + "</p>" : "") +
    '<datalist id="delegList">' + order.map(c => '<option value="' + esc(c) + '">').join("") + "</datalist>" +
    '<table class="setup" id="setupTable"><thead><tr><th>' + esc(t("setup.name")) + "</th><th>" + esc(t("setup.delegation")) +
    "</th><th>" + esc(t("setup.gender")) + "</th><th></th></tr></thead><tbody>" + body + "</tbody></table>" +
    (rw ? '<p><button type="button" class="btn" id="addRow">' + esc(t("setup.add")) + "</button></p>" : "") + "</div>" +
    '<div class="savebar" id="saveBar"' + (n ? "" : " hidden") + '><span id="saveCount">' + esc(tn("setup.unsaved", n)) +
    '</span><span><button type="button" class="btn" id="discard">' + esc(t("setup.discard")) +
    '</button> <button type="button" class="btn primary" id="save">' + esc(t("setup.save")) + "</button></span></div>");
  window.scrollTo(window.scrollX, sy);
  bind();
}

function rowOf(el) {
  const tr = el.closest("tr[data-id]");
  return tr ? draft.rows.find(r => r.id === tr.dataset.id) : null;
}
function updateBar() {
  const bar = document.getElementById("saveBar");
  if (!bar) return;
  const n = changeCount(diff());
  bar.hidden = !n;
  document.getElementById("saveCount").textContent = tn("setup.unsaved", n);
}

function bind() {
  const pid = state.data.programme.id;
  const end = document.getElementById("endDate");
  end.onchange = async () => {
    end.disabled = true;
    try { await state.backend.setEndDate(pid, end.value || null); await reloadData(); toast(t("setup.saved"), "success"); }
    catch (err) { toast(errorText(err), "error"); end.value = state.data.programme.end_date || ""; }
    end.disabled = !canWrite();
  };
  if (!canWrite()) return;
  const table = document.getElementById("setupTable");
  table.addEventListener("input", e => {
    if (saving || !draft) return;
    const r = rowOf(e.target);
    if (!r) return;
    if (e.target.classList.contains("sname")) r.name = e.target.value;
    if (e.target.classList.contains("scountry")) r.country = e.target.value;
    updateBar();
  });
  table.addEventListener("change", e => {
    if (saving || !draft) return;
    const r = rowOf(e.target);
    if (!r) return;
    if (e.target.classList.contains("sgender")) { r.gender = e.target.value; r.flagGender = false; updateBar(); }
    if (e.target.classList.contains("scountry")) { r.country = normText(e.target.value); paint(); } // regroup
  });
  table.addEventListener("paste", e => {
    if (saving || !draft) return;
    const text = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
    if (!/[\t\n]/.test(text.trim())) return; // a single value: let the browser paste it into the cell
    e.preventDefault();
    const here = rowOf(e.target);
    parseRosterPaste(text).forEach(p => draft.rows.push({ id: crypto.randomUUID(), code: "", name: p.name,
      country: p.country || (here ? here.country : ""), gender: p.gender, isNew: true, del: false, flagGender: p.genderUnknown }));
    paint();
  });
  table.querySelectorAll(".sdel").forEach(b => {
    b.onclick = () => {
      if (saving || !draft) return;
      const r = rowOf(b);
      if (r.isNew) draft.rows = draft.rows.filter(x => x !== r); else r.del = !r.del;
      paint();
    };
  });
  table.querySelectorAll(".srename").forEach(b => {
    b.onclick = () => {
      if (saving || !draft) return;
      const from = b.dataset.deleg;
      const to = normText(prompt(t("setup.renamePrompt", { name: from }), from) || "");
      if (!to || to === from) return;
      if (isReserved(to)) { toast(t("setup.reserved", { name: to }), "error"); return; }
      draft.rows.forEach(r => { if (r.country === from) r.country = to; });
      const chained = draft.renames.find(x => x.to === from);
      const origHasFrom = draft.original.some(p => p.country === from);
      if (chained) {
        chained.to = to;
        // `from` already existed (A->B onto an existing B, then B->C): the original B members move too
        if (origHasFrom && !draft.renames.some(x => x.from === from)) draft.renames.push({ from, to });
      } else if (origHasFrom) draft.renames.push({ from, to });
      paint();
    };
  });
  document.getElementById("addRow").onclick = () => {
    if (saving || !draft) return;
    const last = draft.rows.filter(r => !r.del).slice(-1)[0];
    const r = { id: crypto.randomUUID(), code: "", name: "", country: last ? last.country : "", gender: "",
      isNew: true, del: false, flagGender: false };
    draft.rows.push(r);
    paint();
    const inp = document.querySelector('tr[data-id="' + r.id + '"] .sname');
    if (inp) inp.focus();
  };
  document.getElementById("discard").onclick = () => { if (saving || !draft) return; draft = initDraft(); paint(); };
  document.getElementById("save").onclick = async e => {
    if (saving || !draft) return;
    const live = draft.rows.filter(r => !r.del);
    if (live.some(r => !normText(r.name) || !normText(r.country))) { toast(t("setup.fillAll"), "error"); return; }
    const bad = live.find(r => isReserved(r.country));
    if (bad) { toast(t("setup.reserved", { name: bad.country }), "error"); return; }
    saving = true;
    setBusy(true);
    try { await state.backend.saveRoster(pid, diff()); }
    catch (err) { toast(errorText(err), "error"); saving = false; setBusy(false); return; }
    draft = null;
    let refreshed = true;
    try { await reloadData(); } catch (err) { refreshed = false; toast(t("admin.savedRefreshFailed"), "error"); }
    if (refreshed) toast(t("setup.saved"), "success");
    render();
    saving = false;
  };
}
