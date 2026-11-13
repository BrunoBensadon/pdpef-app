"use strict";
import { state, view, gridOf, evidenceIndex, route, participantById, canWrite, myDelegation } from "../store.mjs";
import { indicatorsByGoal, txt, sortParticipants, goalStyle } from "../logic.mjs";
import { t, getLang } from "../i18n.mjs";
import { esc } from "../ui.mjs";
import { renderShell } from "../shell.mjs";
import { openEditor } from "./editor.mjs";

// Everyone in one dropdown: a leader's own delegation first, then the rest by delegation and name.
function participantPicker(pid) {
  const parts = state.data.participants, mine = myDelegation();
  const own = mine ? sortParticipants(parts.filter(p => p.country === mine)) : [];
  const rest = sortParticipants(own.length ? parts.filter(p => p.country !== mine) : parts);
  const opt = p => '<option value="' + esc(p.id) + '"' + (p.id === pid ? " selected" : "") + ">" +
    esc(p.name) + " (" + esc(p.country) + ")</option>";
  const group = (label, list) => list.length ? '<optgroup label="' + esc(label) + '">' + list.map(opt).join("") + "</optgroup>" : "";
  return '<select id="kidpick" aria-label="' + esc(t("participant.pick")) + '">' +
    (own.length ? group(t("participant.yourDelegation", { name: mine }), own) + group(t("participant.all"), rest)
      : rest.map(opt).join("")) + "</select>";
}

export function renderParticipant(pid) {
  const kid = participantById(pid);
  if (!kid) { location.hash = route("grid"); return; }
  const lang = getLang(), v = view(), g = gridOf(v), evIdx = evidenceIndex(v);
  // Read-only (archived): no invitation to add; tapping a card still opens the read-only editor.
  const empty = canWrite()
    ? '<span class="muted tapadd">' + esc(t("participant.tapToAdd")) + "</span>"
    : '<span class="muted">' + esc(t("editor.noEvidence")) + "</span>";
  renderShell("participant",
    '<div class="card pickbar">' + participantPicker(pid) +
    '<a class="btn" href="' + esc(route("print/" + encodeURIComponent(pid))) + '">' + esc(t("participant.print")) + "</a></div>" +
    indicatorsByGoal(state.data.framework).map(({ goal, indicators }) =>
      '<p class="goalhead"><b>' + esc(goal.code) + ") " + esc(txt(goal.text, lang)) + "</b></p>" +
      indicators.map(ind => {
        const cell = ((g[pid] || {})[ind.code] || []).filter(en => evIdx[en.evidence_id]); // skip missing evidence
        return '<div class="card goalcol" style="' + esc(goalStyle(state.data.framework, ind.goal_code)) + '" data-goal="' + esc(ind.code) + '"><b>' + esc(ind.code) + ") " +
          esc(txt(ind.text, lang)) + "</b><br>" + (cell.length ? cell.map(en => {
            const ev = evIdx[en.evidence_id];
            return '<span class="pill' + (ev.participant_id ? " note" : "") + '">' + esc(ev.text) +
              (ev.participant_id ? ' <span class="muted">' + esc(t("editor.noteTag")) + "</span>" : "") + "</span>";
          }).join("") : empty) +
          "</div>";
      }).join("")).join(""));
  document.getElementById("kidpick").onchange = e => { location.hash = route("participant/" + encodeURIComponent(e.target.value)); };
  document.querySelectorAll(".card[data-goal]").forEach(c => {
    c.onclick = () => openEditor(pid, c.dataset.goal, () => renderParticipant(pid));
  });
}
