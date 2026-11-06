"use strict";
import { state, view, gridOf, route } from "../store.mjs";
import { indicatorsOf, findIndicator, txt, goalStyle } from "../logic.mjs";
import { t, getLang } from "../i18n.mjs";
import { esc } from "../ui.mjs";
import { renderShell } from "../shell.mjs";
import { openEditor } from "./editor.mjs";

export function renderGrid() {
  const fw = state.data.framework, inds = indicatorsOf(fw);
  const g = gridOf(view());
  const byCountry = {};
  state.data.participants.forEach(p => { (byCountry[p.country] = byCountry[p.country] || []).push(p); });
  const head = "<tr><th class='kid'>" + esc(t("grid.participant")) + "</th>" + inds.map(i =>
    '<th class="goalcol" style="' + esc(goalStyle(fw, i.goal_code)) + '"><a href="' + esc(route("goal/" + encodeURIComponent(i.code))) + '" data-goal="' + esc(i.code) + '">' +
    esc(i.code) + "</a></th>").join("") + "</tr>";
  const body = Object.keys(byCountry).map(c =>
    '<tr class="deleg"><td colspan="' + (inds.length + 1) + '">' + esc(c) + "</td></tr>" +
    byCountry[c].map(p => '<tr><th class="kid"><a href="' + esc(route("participant/" + encodeURIComponent(p.id))) + '">' +
      esc(p.name) + "</a></th>" + inds.map(i => {
        const n = ((g[p.id] || {})[i.code] || []).length;
        return '<td class="cell' + (n ? " some goalcol" : "") + '"' + (n ? ' style="' + esc(goalStyle(fw, i.goal_code)) + '"' : "") +
          ' data-kid="' + esc(p.id) +
          '" data-goal="' + esc(i.code) + '">' + (n || "") + "</td>";
      }).join("") + "</tr>").join("")).join("");
  renderShell("grid", '<div id="goalhint" class="goalhint"></div><div class="gridwrap"><table class="grid">' +
    head + body + "</table></div><p class='muted'>" + esc(t("grid.help")) + "</p>");
  document.querySelectorAll("td.cell").forEach(td => {
    td.onclick = () => openEditor(td.dataset.kid, td.dataset.goal);
  });
  document.querySelectorAll("table.grid th a[data-goal]").forEach(a => {
    a.onclick = e => {
      e.preventDefault();
      const ind = findIndicator(fw, a.dataset.goal);
      const hint = document.getElementById("goalhint");
      hint.className = "goalhint goalcol";
      hint.style.cssText = goalStyle(fw, ind.goal_code);
      hint.innerHTML = "<span>" + esc(ind.code) + ") " + esc(txt(ind.text, getLang())) + "</span>" +
        '<a href="' + esc(route("goal/" + encodeURIComponent(ind.code))) + '">' + esc(t("grid.openIndicator")) + "</a>";
    };
  });
}
