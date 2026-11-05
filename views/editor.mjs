"use strict";
import { state, enqueue, author, view, gridOf, evidenceIndex, isStaff, canWrite, participantById, render } from "../store.mjs";
import { usageCounts, searchEvidence, findExact, normText, canSelfUndo, findIndicator, txt } from "../logic.mjs";
import { t, getLang } from "../i18n.mjs";
import { esc, toast, openSheet, closeSheet } from "../ui.mjs";

// The server rejects evidence text longer than this.
export const MAX_EVIDENCE = 2000;
const noteTag = () => ' <span class="muted">' + esc(t("editor.noteTag")) + "</span>";

export function openEditor(participantId, code, onDone) {
  const kid = participantById(participantId), ind = findIndicator(state.data.framework, code);
  if (!kid || !ind) return;
  const writable = canWrite();
  const el = openSheet();
  // Static shell built ONCE: #q is never recreated, so a keystroke never steals focus.
  el.innerHTML = '<div class="panel"><h3>' + esc(kid.name) + " (" + esc(kid.country) + ") — " + esc(code) + "</h3>" +
    '<p class="goalhead">' + esc(txt(ind.text, getLang())) + "</p>" +
    '<div id="current"></div><hr>' +
    (writable
      ? '<input type="search" id="q" placeholder="' + esc(t("editor.search")) + '" autocomplete="off" maxlength="' + MAX_EVIDENCE + '">' +
        '<div class="picker-list" id="results"></div><div id="actions"></div>'
      : '<p class="muted">' + esc(t("editor.readOnly")) + "</p>") +
    '<p style="text-align:right"><button class="btn" id="done">' + esc(t("common.done")) + "</button></p></div>";
  el.querySelector("#done").onclick = () => { closeSheet(); if (onDone) onDone(); render(); };
  el.onclick = e => { if (e.target === el) { closeSheet(); render(); } };
  const q = el.querySelector("#q");
  if (q) q.oninput = () => draw(q.value);

  function draw(query) {
    const v = view(), evIdx = evidenceIndex(v);
    const current = (gridOf(v)[participantId] || {})[code] || [];
    const shown = current.filter(en => evIdx[en.evidence_id]); // no blank pill for missing evidence
    el.querySelector("#current").innerHTML = shown.length ? shown.map(en => {
      const ev = evIdx[en.evidence_id];
      const control = !writable ? ""
        : isStaff() ? ' <a href="#" class="rm" data-entry="' + esc(en.id) + '">✕</a>'
        : canSelfUndo(en, state.profile.id, Date.now())
          ? ' <a href="#" class="undo" data-entry="' + esc(en.id) + '">' + esc(t("editor.undo")) + "</a>" : "";
      return '<span class="pill' + (ev.participant_id ? " note" : "") + '">' + esc(ev.text) +
        (ev.participant_id ? noteTag() : "") + control + "</span>";
    }).join("") : '<span class="muted">' + esc(t("editor.noEvidence")) + "</span>";

    el.querySelectorAll("a.rm").forEach(a => {
      a.onclick = e => {
        e.preventDefault();
        if (confirm(t("editor.confirmRemove", { name: kid.name }))) {
          enqueue("remove_entry", Object.assign({ entryId: a.dataset.entry }, author()));
          draw(query);
        }
      };
    });
    el.querySelectorAll("a.undo").forEach(a => {
      a.onclick = e => {
        e.preventDefault();
        enqueue("remove_entry", Object.assign({ entryId: a.dataset.entry }, author()));
        draw(query);
        toast(t("editor.removed"), "success");
      };
    });
    if (!writable) return;

    const counts = usageCounts(v.entries);
    const results = searchEvidence(v.evidence, code, query, participantId, counts)
      .filter(ev => !current.some(en => en.evidence_id === ev.id)).slice(0, 12);
    const exact = findExact(v.evidence, code, query);
    el.querySelector("#results").innerHTML = results.map(ev =>
      '<button data-ev="' + esc(ev.id) + '">' + esc(ev.text) + (ev.participant_id ? noteTag() : "") +
      ' <span class="muted">×' + (counts[ev.id] || 0) + "</span></button>").join("");
    el.querySelector("#actions").innerHTML = normText(query) && !exact
      ? '<button class="btn primary" id="addShared">' + esc(t("editor.addShared")) + "</button> " +
        '<button class="btn" id="addNote">' + esc(t("editor.addNote", { name: kid.name })) + "</button>"
      : "";
    el.querySelectorAll("#results button").forEach(b => {
      b.onclick = () => {
        enqueue("add_entry", Object.assign({ id: crypto.randomUUID(), participantId, indicator: code,
          evidenceId: b.dataset.ev }, author()));
        reset();
      };
    });
    const addNew = asNote => {
      const evidenceId = crypto.randomUUID();
      enqueue("add_evidence", Object.assign({ id: evidenceId, indicator: code, text: q.value,
        participantId: asNote ? participantId : null }, author()));
      enqueue("add_entry", Object.assign({ id: crypto.randomUUID(), participantId, indicator: code, evidenceId }, author()));
      reset();
    };
    const s = el.querySelector("#addShared"), n = el.querySelector("#addNote");
    if (s) s.onclick = () => addNew(false);
    if (n) n.onclick = () => addNew(true);
  }
  function reset() { q.value = ""; draw(""); q.focus(); }
  draw("");
}

export function openMultiAdd(code, participantIds) {
  // Pick ONE evidence statement, then tick which participants it applies to.
  const ind = findIndicator(state.data.framework, code);
  if (!canWrite() || !ind) return;
  const el = openSheet();
  let chosen = null; // {id: existing evidence id or null, text}
  // Static shell built ONCE (as in openEditor): #q is never recreated, so typing keeps its caret
  // and IME/accent composition; only #results, #newAction and #chosen are redrawn.
  el.innerHTML = '<div class="panel"><h3>' + esc(t("multi.title", { code })) + "</h3>" +
    '<p class="goalhead">' + esc(txt(ind.text, getLang())) + "</p>" +
    '<div id="pick"><input type="search" id="q" placeholder="' + esc(t("editor.search")) +
      '" autocomplete="off" maxlength="' + MAX_EVIDENCE + '"><div class="picker-list" id="results"></div>' +
      '<div id="newAction"></div></div>' +
    '<div id="chosen" hidden></div>' +
    '<p style="text-align:right"><button class="btn" id="cancel">' + esc(t("common.close")) + "</button></p></div>";
  const q = el.querySelector("#q"), pick = el.querySelector("#pick"), chosenEl = el.querySelector("#chosen");
  el.querySelector("#cancel").onclick = () => { closeSheet(); render(); };
  q.oninput = () => drawResults(q.value);

  function drawResults(query) {
    const v = view();
    const counts = usageCounts(v.entries);
    const results = searchEvidence(v.evidence, code, query, "", counts).slice(0, 12);
    const exact = findExact(v.evidence, code, query);
    el.querySelector("#results").innerHTML = results.map(ev =>
      '<button data-ev="' + esc(ev.id) + '" data-text="' + esc(ev.text) + '">' + esc(ev.text) +
      ' <span class="muted">×' + (counts[ev.id] || 0) + "</span></button>").join("");
    el.querySelector("#newAction").innerHTML = normText(query) && !exact
      ? '<button class="btn primary" id="newShared">' + esc(t("multi.useNew")) + "</button>" : "";
    el.querySelectorAll("#results button").forEach(b => {
      b.onclick = () => choose({ id: b.dataset.ev, text: b.dataset.text });
    });
    const ns = el.querySelector("#newShared");
    if (ns) ns.onclick = () => choose({ id: null, text: normText(q.value) });
  }

  function choose(c) {
    chosen = c;
    pick.hidden = true;
    chosenEl.hidden = false;
    chosenEl.innerHTML = "<p><b>" + esc(chosen.text) + "</b></p><div id='kidticks'>" + participantIds.map(id =>
        '<label class="pill"><input type="checkbox" checked value="' + esc(id) + '"> ' +
        esc(participantById(id).name) + "</label>").join("") + "</div>" +
      '<p><button class="btn primary" id="apply">' + esc(t("multi.apply")) + "</button> " +
      '<button class="btn" id="back">' + esc(t("multi.change")) + "</button></p>";
    el.querySelector("#back").onclick = () => {
      chosen = null;
      chosenEl.hidden = true; chosenEl.innerHTML = "";
      pick.hidden = false;
      q.value = ""; drawResults(""); q.focus();
    };
    el.querySelector("#apply").onclick = () => {
      let evidenceId = chosen.id;
      if (!evidenceId) {
        evidenceId = crypto.randomUUID();
        enqueue("add_evidence", Object.assign({ id: evidenceId, indicator: code, text: chosen.text, participantId: null }, author()));
      }
      el.querySelectorAll("#kidticks input:checked").forEach(cb => {
        enqueue("add_entry", Object.assign({ id: crypto.randomUUID(), participantId: cb.value, indicator: code, evidenceId }, author()));
      });
      closeSheet();
      render();
    };
  }

  drawResults("");
  q.focus();
}
