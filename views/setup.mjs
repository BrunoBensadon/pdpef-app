"use strict";
// Setup: the programme's details (reference, dates) and its participant roster (staff and platform admin).
// Roster edits live in a draft (module state, not the DOM) and are saved in one atomic
// save_roster call. The draft survives the 60-second background refresh.
import { state, reloadData, canWrite, render } from "../store.mjs";
import { delegationsOf, parseRosterPaste, rosterDiff, changeCount, GENDERS, joinOnlyDelegations, normText, normReference } from "../logic.mjs";
import { t, tn } from "../i18n.mjs";
import { esc, toast, errorText } from "../ui.mjs";
import { renderShell } from "../shell.mjs";

let saving = false; // true while a Save is in flight: the roster is locked
// { pid, original, rows: [{id, code, name, country, gender, isNew, del, flagGender}], renames: [],
//   groups: [] (delegations added in this draft that have no rows yet) }
let draft = null;

function initDraft() {
  const d = state.data;
  return {
    pid: d.programme.id,
    original: d.participants.map(p => Object.assign({}, p)),
    rows: d.participants.map(p => ({ id: p.id, code: p.code, name: p.name, country: p.country, gender: p.gender || "",
      isNew: false, del: false, flagGender: false })),
    renames: [],
    groups: [],
  };
}
const diff = () => rosterDiff(draft.original, draft.rows, draft.renames);
export function isSetupDirty() { return !!draft && changeCount(diff()) > 0; }

// The details card's current values, and whether they differ from the saved programme.
function detailsValues() {
  const v = id => (document.getElementById(id) || {}).value || "";
  return { reference: v("pRef"), startDate: v("pStart") || null, endDate: v("pEnd") || null };
}
function detailsDirty() {
  if (!document.getElementById("pRef") || !state.data) return false;
  const p = state.data.programme, c = detailsValues();
  return c.reference.trim().toUpperCase() !== (p.reference || "") ||
    (c.startDate || null) !== (p.start_date || null) || (c.endDate || null) !== (p.end_date || null);
}

// Lock (or unlock) every roster control while a Save is in flight.
function setBusy(on) {
  ["setupTable", "addDeleg", "discard", "save"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const ctl = el.matches("input,select,button") ? [el] : [];
    el.querySelectorAll("input,select,button").forEach(c => ctl.push(c));
    ctl.forEach(c => { c.disabled = on ? true : c.dataset.used === "1"; });
  });
}

// The router calls this before leaving a …/setup route. false = stay.
export function leaveSetupOk() {
  if (!isSetupDirty()) {
    if (!saving) draft = null; // drop draft-only delegations too: back on Setup the roster is read afresh
    return true;
  }
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
  const busy = !!draft && draft.pid === pid && (isSetupDirty() || draft.groups.length > 0 || detailsDirty());
  if (busy && document.getElementById("setupTable")) return; // keep what the user is typing
  if (!busy) draft = initDraft();
  paint();
}

function paint() {
  const d = state.data, rw = canWrite(), sy = window.scrollY, dis = rw ? "" : " disabled";
  const order = delegationsOf(draft.rows.filter(r => r.country));
  draft.groups.forEach(g => { if (order.indexOf(g) < 0) order.push(g); });
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
  const rowsIn = c => draft.rows.filter(r => r.country === c);
  const groupBlock = c => {
    const used = rowsIn(c).some(r => !r.isNew && usage(r.id));
    // a leader's delegation, seen through the draft's pending renames
    const afterRenames = name => draft.renames.reduce((v, x) => (v === x.from ? x.to : v), name);
    const leaders = d.members.some(m => m.role === "leader" && afterRenames(m.delegation) === c);
    const existing = rowsIn(c).filter(r => !r.isNew);
    const removed = existing.length > 0 && existing.every(r => r.del);
    const why = used ? t("setup.groupHasEntries") : leaders ? t("setup.groupHasLeaders") : "";
    return '<tr class="deleg"><td colspan="4">' + esc(c) + (rw
      ? ' <button type="button" class="btn srename" data-deleg="' + esc(c) + '">✎ ' + esc(t("setup.rename")) + "</button>" +
        (removed ? "" : ' <button type="button" class="btn saddrow" data-deleg="' + esc(c) + '">' + esc(t("setup.addParticipant")) + "</button>") +
        ' <button type="button" class="btn sremovedeleg" data-deleg="' + esc(c) + '"' +
          (why ? ' disabled data-used="1" title="' + esc(why) + '"' : "") + ">" +
          esc(t(removed ? "setup.restoreDelegation" : "setup.removeDelegation")) + "</button>"
      : "") + "</td></tr>";
  };
  const loose = draft.rows.filter(r => !r.country);
  const body = order.map(c => groupBlock(c) + rowsIn(c).map(rowHtml).join("")).join("") +
    (loose.length ? '<tr class="deleg"><td colspan="4">—</td></tr>' + loose.map(rowHtml).join("") : "");
  const p = d.programme;
  const miss = v => (v ? "" : ' <span class="missing">' + esc(t("setup.missing")) + "</span>");
  const details = '<div class="card" id="detailsCard"><h3>' + esc(t("setup.programme")) + "</h3>" +
    (rw ? "" : '<p class="banner">' + esc(t("setup.readOnly")) + "</p>") +
    "<label>" + esc(t("setup.reference")) + miss(p.reference) + ' <input type="text" id="pRef" placeholder="V-2026-002" value="' +
      esc(p.reference || "") + '"' + dis + "></label>" +
    "<label>" + esc(t("setup.startDate")) + miss(p.start_date) + ' <input type="date" id="pStart" value="' + esc(p.start_date || "") + '"' + dis + "></label>" +
    "<label>" + esc(t("setup.finalDay")) + miss(p.end_date) + ' <input type="date" id="pEnd" value="' + esc(p.end_date || "") + '"' + dis + "></label>" +
    '<p class="muted">' + esc(t("setup.finalDayHelp")) + '</p><p class="formerr" id="detailsErr"></p>' +
    (rw ? '<button type="button" class="btn primary" id="saveDetails" disabled>' + esc(t("setup.saveDetails")) + "</button>" : "") + "</div>";
  const n = changeCount(diff());
  renderShell(null,
    details +
    '<div class="card"><h3>' + esc(t("setup.participants")) + "</h3>" +
    (rw ? '<p class="muted">' + esc(t("setup.pasteHelp")) + "</p>" : "") +
    '<datalist id="delegList">' + order.map(c => '<option value="' + esc(c) + '">').join("") + "</datalist>" +
    '<table class="setup" id="setupTable"><thead><tr><th>' + esc(t("setup.name")) + "</th><th>" + esc(t("setup.delegation")) +
    "</th><th>" + esc(t("setup.gender")) + "</th><th></th></tr></thead><tbody>" + body + "</tbody></table>" +
    (rw ? '<p><button type="button" class="btn" id="addDeleg">' + esc(t("setup.addDelegation")) + "</button></p>" : "") + "</div>" +
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
  const saveDetails = document.getElementById("saveDetails");
  if (saveDetails) {
    ["pRef", "pStart", "pEnd"].forEach(id => {
      const el = document.getElementById(id);
      el.oninput = el.onchange = () => { saveDetails.disabled = !detailsDirty(); document.getElementById("detailsErr").textContent = ""; };
    });
    saveDetails.onclick = async () => {
      const c = detailsValues(), err = document.getElementById("detailsErr"), had = state.data.programme.start_date;
      if (!c.reference.trim() || !c.endDate || (!c.startDate && had)) { err.textContent = t("admin.required"); return; }
      const reference = normReference(c.reference);
      if (!reference) { err.textContent = t("admin.referenceFormat"); return; }
      if (c.startDate && c.startDate > c.endDate) { err.textContent = t("admin.datesOrder"); return; }
      saveDetails.disabled = true;
      try { await state.backend.setProgrammeDetails(pid, { reference, startDate: c.startDate, endDate: c.endDate }); }
      catch (e) { err.textContent = errorText(e); saveDetails.disabled = false; return; }
      try { await reloadData(); toast(t("setup.saved"), "success"); }
      catch (e) { toast(t("admin.savedRefreshFailed"), "error"); }
      const ref = document.getElementById("pRef");
      if (ref && ref.value === c.reference) ref.value = state.data.programme.reference || reference;
      saveDetails.disabled = !detailsDirty();
      render();
    };
  }
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
      draft.groups = draft.groups.map(g => (g === from ? to : g));
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
  table.querySelectorAll(".saddrow").forEach(b => {
    b.onclick = () => {
      if (saving || !draft) return;
      const r = { id: crypto.randomUUID(), code: "", name: "", country: b.dataset.deleg, gender: "",
        isNew: true, del: false, flagGender: false };
      draft.rows.push(r);
      paint();
      const inp = document.querySelector('tr[data-id="' + r.id + '"] .sname');
      if (inp) inp.focus();
    };
  });
  table.querySelectorAll(".sremovedeleg").forEach(b => {
    b.onclick = () => {
      if (saving || !draft) return;
      const c = b.dataset.deleg;
      const existing = draft.rows.filter(r => r.country === c && !r.isNew);
      const restore = existing.length > 0 && existing.every(r => r.del);
      draft.rows = draft.rows.filter(r => !(r.country === c && r.isNew)); // new rows go either way
      existing.forEach(r => { r.del = !restore; });
      if (!restore) draft.groups = draft.groups.filter(g => g !== c);
      paint();
    };
  });
  document.getElementById("addDeleg").onclick = () => {
    if (saving || !draft) return;
    const name = normText(prompt(t("setup.addDelegationPrompt")) || "");
    if (!name) return;
    if (isReserved(name)) { toast(t("setup.reserved", { name }), "error"); return; }
    const taken = draft.rows.some(r => r.country.toLowerCase() === name.toLowerCase())
      || draft.groups.some(g => g.toLowerCase() === name.toLowerCase());
    if (taken) { toast(t("setup.delegationExists", { name }), "error"); return; }
    draft.groups.push(name);
    paint();
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
    const typed = detailsDirty() ? detailsValues() : null; // details typed but not saved survive the repaint
    let refreshed = true;
    try { await reloadData(); } catch (err) { refreshed = false; toast(t("admin.savedRefreshFailed"), "error"); }
    if (refreshed) toast(t("setup.saved"), "success");
    render();
    if (typed) {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
      set("pRef", typed.reference); set("pStart", typed.startDate); set("pEnd", typed.endDate);
      const sd = document.getElementById("saveDetails");
      if (sd) sd.disabled = !detailsDirty();
    }
    saving = false;
  };
}
