"use strict";
import { state, view, gridOf, evidenceIndex, route, canWrite, myDelegation } from "../store.mjs";
import { indicatorsOf, findIndicator, findGoal, txt, delegationOrder, sortParticipants, goalStyle } from "../logic.mjs";
import { t, tn, getLang } from "../i18n.mjs";
import { esc, tagChip } from "../ui.mjs";
import { renderShell } from "../shell.mjs";
import { openEditor, openMultiAdd } from "./editor.mjs";

// Value of the delegation picker's "All" option (never a delegation name).
export const ALL_DELEGATIONS = "__all__";

export function renderGoal(code) {
  const fw = state.data.framework, ind = findIndicator(fw, code);
  if (!ind) { location.hash = route("grid"); return; }
  const lang = getLang(), v = view(), g = gridOf(v), evIdx = evidenceIndex(v);
  const mine = myDelegation();
  // The leader's own delegation first, then A to Z; "All" is always the first option.
  const countries = delegationOrder(state.data.participants, mine);
  const country = [state.goalCountry, mine].find(c => c === ALL_DELEGATIONS || countries.indexOf(c) >= 0) || countries[0];
  const all = country === ALL_DELEGATIONS;
  const kids = sortParticipants(state.data.participants.filter(p => all || p.country === country), mine);
  const groups = all
    ? countries.map(c => ({ name: c, kids: kids.filter(k => k.country === c) })).filter(gr => gr.kids.length)
    : [{ name: country, kids }];
  const goal = findGoal(fw, ind.goal_code);
  const writable = canWrite();
  const style = esc(goalStyle(fw, ind.goal_code));
  const link = c => esc(route("goal/" + encodeURIComponent(c)));
  // One tap to any indicator, each in its goal's colour.
  const toggle = '<nav class="indtoggle" aria-label="' + esc(t("goal.indicators")) + '">' + indicatorsOf(fw).map(i =>
    '<a href="' + link(i.code) + '" style="' + esc(goalStyle(fw, i.goal_code)) + '"' +
    (i.code === code ? ' class="on" aria-current="page"' : "") + ">" + esc(i.code) + "</a>").join("") + "</nav>";
  const card = k => {
    const cell = ((g[k.id] || {})[code] || []).filter(en => evIdx[en.evidence_id]); // skip missing evidence
    return '<div class="card goalcol" style="' + style + '"><b><a href="' + esc(route("participant/" + encodeURIComponent(k.id))) + '">' +
      esc(k.name) + "</a></b><br>" +
      (cell.length ? cell.map(en => '<span class="pill">' + esc(evIdx[en.evidence_id].text) + "</span>").join("")
        : '<span class="muted">' + esc(t("editor.noEvidence")) + "</span>") +
      (writable ? '<br><button class="btn" data-kid="' + esc(k.id) + '">' + esc(t("goal.add")) + "</button>" : "") +
      "</div>";
  };
  renderShell("goal",
    '<div class="card goalhdr" style="' + style + '">' + toggle +
    // The goal is context (small, on a tint); the indicator is the title.
    (goal ? '<p class="goalband"><b>' + esc(t("goal.goalLabel", { code: goal.code })) + "</b> · " + esc(txt(goal.text, lang)) + "</p>" : "") +
    '<div class="indtitle"><span class="indcode" aria-hidden="true">' + esc(code) + "</span><div><h2>" +
      '<span class="sr-only">' + esc(code) + ") </span>" + esc(txt(ind.text, lang)) + "</h2>" + tagChip(ind) + "</div></div>" +
    '<div class="goaltools"><select id="deleg" aria-label="' + esc(t("members.delegation")) + '">' +
      '<option value="' + ALL_DELEGATIONS + '"' + (all ? " selected" : "") + ">" + esc(t("goal.all")) + "</option>" +
      countries.map(c => "<option" + (c === country ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select>" +
      (writable ? '<button class="btn" id="multi">' + esc(t("goal.addSeveral")) + "</button>" : "") + "</div>" +
    '<p class="muted" id="kidcount">' +
      esc(all ? tn("goal.countAll", kids.length, { d: groups.length }) : tn("goal.count", kids.length)) + "</p>" +
    "</div>" +
    groups.map(gr => (all ? '<h3 class="deleghead">' + esc(gr.name) + "</h3>" : "") + gr.kids.map(card).join("")).join(""));
  document.getElementById("deleg").onchange = e => { state.goalCountry = e.target.value; renderGoal(code); };
  const multi = document.getElementById("multi");
  if (multi) multi.onclick = () => openMultiAdd(code, kids.map(k => k.id));
  document.querySelectorAll(".card .btn[data-kid]").forEach(b => {
    b.onclick = () => openEditor(b.dataset.kid, code, () => renderGoal(code));
  });
}
