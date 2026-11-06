"use strict";
import { state, view, gridOf, evidenceIndex, route, participantById, canWrite } from "../store.mjs";
import { indicatorsByGoal, txt, neighbours, goalStyle } from "../logic.mjs";
import { t, getLang } from "../i18n.mjs";
import { esc } from "../ui.mjs";
import { renderShell } from "../shell.mjs";
import { openEditor } from "./editor.mjs";

export function renderParticipant(pid) {
  const kid = participantById(pid);
  if (!kid) { location.hash = route("grid"); return; }
  const lang = getLang(), v = view(), g = gridOf(v), evIdx = evidenceIndex(v);
  const nb = neighbours(state.data.participants.map(p => p.id), pid);
  const link = id => esc(route("participant/" + encodeURIComponent(id)));
  // Read-only (archived): no invitation to add; tapping a card still opens the read-only editor.
  const empty = canWrite()
    ? '<span class="muted" style="text-decoration-line: underline">' + esc(t("participant.tapToAdd")) + "</span>"
    : '<span class="muted">' + esc(t("editor.noEvidence")) + "</span>";
  renderShell("participant",
    '<div class="card"><a href="' + link(nb.prev) + '">←</a> <b>' + esc(kid.name) + " (" + esc(kid.country) +
    ')</b> <a href="' + link(nb.next) + '">→</a> ' +
    '<a class="btn" style="float: right; background-color: #FFF4E1" href="' + esc(route("print/" + encodeURIComponent(pid))) + '">' +
    esc(t("participant.print")) + "</a></div>" +
    indicatorsByGoal(state.data.framework).map(({ goal, indicators }) =>
      '<p class="goalhead"><b>' + esc(goal.code) + ") " + esc(txt(goal.text, lang)) + "</b></p>" +
      indicators.map(ind => {
        const cell = ((g[pid] || {})[ind.code] || []).filter(en => evIdx[en.evidence_id]); // skip missing evidence
        return '<div class="card goalcol" style="' + esc(goalStyle(state.data.framework, ind.goal_code)) + '" data-goal="' + esc(ind.code) + '"><b>' + esc(ind.code) + ") " +
          esc(txt(ind.text, lang)) + "</b><br>" + (cell.length ? cell.map(en => {
            const ev = evIdx[en.evidence_id];
            return '<span class="pill' + (ev.participant_id ? " note" : "") + '" style="background-color: #FFF4E1">' + esc(ev.text) +
              (ev.participant_id ? ' <span class="muted">' + esc(t("editor.noteTag")) + "</span>" : "") + "</span>";
          }).join("") : empty) +
          "</div>";
      }).join("")).join(""));
  document.querySelectorAll(".card[data-goal]").forEach(c => {
    c.onclick = () => openEditor(pid, c.dataset.goal, () => renderParticipant(pid));
  });
}
