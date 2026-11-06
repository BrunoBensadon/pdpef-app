"use strict";
import { state, view, gridOf, evidenceIndex, route, canWrite, myDelegation } from "../store.mjs";
import { indicatorsOf, findIndicator, findGoal, txt, delegationsOf, neighbours, goalStyle } from "../logic.mjs";
import { t, getLang } from "../i18n.mjs";
import { esc, tagChip } from "../ui.mjs";
import { renderShell } from "../shell.mjs";
import { openEditor, openMultiAdd } from "./editor.mjs";

export function renderGoal(code) {
  const fw = state.data.framework, ind = findIndicator(fw, code);
  if (!ind) { location.hash = route("grid"); return; }
  const lang = getLang(), v = view(), g = gridOf(v), evIdx = evidenceIndex(v);
  const countries = delegationsOf(state.data.participants);
  const pick = [state.goalCountry, myDelegation()].find(c => countries.indexOf(c) >= 0);
  const country = pick || countries[0];
  const kids = state.data.participants.filter(p => p.country === country);
  const nb = neighbours(indicatorsOf(fw).map(i => i.code), code);
  const goal = findGoal(fw, ind.goal_code);
  const writable = canWrite();
  const link = c => esc(route("goal/" + encodeURIComponent(c)));
  renderShell("goal",
    '<div class="card"><a href="' + link(nb.prev) + '">←</a> <b>' + esc(code) + ") " +
    esc(txt(ind.text, lang)) + "</b>" + tagChip(ind) + ' <a href="' + link(nb.next) + '">→</a>' +
    '<p class="goalhead">' + esc(goal ? txt(goal.text, lang) : "") + "</p>" +
    '<select id="deleg">' + countries.map(c => "<option " + (c === country ? "selected" : "") + ">" + esc(c) + "</option>").join("") +
    "</select> " +
    (writable ? '<button class="btn" id="multi" style="background-color: #F8F7F4">' + esc(t("goal.addSeveral")) + "</button>" : "") +
    "</div>" +
    kids.map(k => {
      const cell = ((g[k.id] || {})[code] || []).filter(en => evIdx[en.evidence_id]); // skip missing evidence
      return '<div class="card goalcol" style="' + esc(goalStyle(fw, ind.goal_code)) + '"><b><a href="' + esc(route("participant/" + encodeURIComponent(k.id))) +
        '" style="color: #0072CE">' + esc(k.name) + "</a></b><br>" +
        (cell.length ? cell.map(en => '<span class="pill">' + esc(evIdx[en.evidence_id].text) + "</span>").join("")
          : '<span class="muted">' + esc(t("editor.noEvidence")) + "</span>") +
        (writable ? '<br><button class="btn" data-kid="' + esc(k.id) + '" style="background-color: #F8F7F4">' + esc(t("goal.add")) + "</button>" : "") +
        "</div>";
    }).join(""));
  document.getElementById("deleg").onchange = e => { state.goalCountry = e.target.value; renderGoal(code); };
  const multi = document.getElementById("multi");
  if (multi) multi.onclick = () => openMultiAdd(code, kids.map(k => k.id));
  document.querySelectorAll(".card .btn[data-kid]").forEach(b => {
    b.onclick = () => openEditor(b.dataset.kid, code, () => renderGoal(code));
  });
}
