"use strict";
// The official CISV Individual Evaluation Form, one A4 sheet per participant.
import { state, view, gridOf, evidenceIndex, route, render } from "../store.mjs";
import { indicatorsByGoal, txt } from "../logic.mjs";
import { t, getLang, createT } from "../i18n.mjs";
import { esc, langToggle } from "../ui.mjs";
import { renderShell } from "../shell.mjs";

export function renderPrint(sel) {
  const d = state.data, fw = d.framework;
  const lang = state.printLang || getLang(), tf = createT(lang);
  const parts = sel === "all" ? d.participants : d.participants.filter(p => p.id === sel);
  if (!parts.length) { location.hash = route("grid"); return; }
  const v = view(), g = gridOf(v), evIdx = evidenceIndex(v);
  const groups = indicatorsByGoal(fw);
  const progLine = esc(d.programme.name) + (d.programme.year ? " " + esc(d.programme.year) : "");
  const forms = parts.map(p =>
    '<section class="evalform">' +
      '<header class="formhead"><img src="img/cisv-international.png" alt="CISV International">' +
      "<h2>" + esc(txt(fw.form_title, lang)) + "</h2></header>" +
      '<p class="formwho"><b>' + esc(tf("form.participant")) + "</b> " + esc(p.name) + " (" + esc(p.country) + ")" +
      '<br><span class="formprog">' + progLine + "</span></p>" +
      '<table class="formtable"><colgroup><col style="width:44%"><col style="width:6%"><col style="width:50%"></colgroup>' +
      '<thead><tr><th></th><th class="yn">' + esc(tf("form.yn")) + "</th><th>" + esc(tf("form.comment")) + "</th></tr></thead><tbody>" +
      groups.map(({ goal, indicators }) =>
        '<tr class="goalrow"><td colspan="3">' + esc(goal.code) + ") " + esc(txt(goal.text, lang)) + "</td></tr>" +
        indicators.map(ind => {
          const texts = ((g[p.id] || {})[ind.code] || []).map(en => evIdx[en.evidence_id]).filter(Boolean).map(ev => ev.text);
          // Y/N follows the evidence actually printed, so Y never sits next to an empty comment.
          const yn = texts.length ? tf("form.yes") : tf("form.no");
          return "<tr><td>" + esc(ind.code) + ") " + esc(txt(ind.text, lang)) + '</td><td class="yn">' + esc(yn) + "</td><td>" +
            (texts.length ? "<ul>" + texts.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "") +
            "</td></tr>";
        }).join("")).join("") +
      "</tbody></table>" +
      '<footer class="formfoot">' + esc(txt(fw.form_footer, lang)) + "</footer></section>").join("");
  const what = sel === "all" ? t("print.all", { n: parts.length }) : parts[0].name;
  renderShell(null,
    '<div class="printbar noprint"><span class="muted">' + esc(t("print.help")) + " " + esc(t("print.printing", { what })) +
    (sel === "all" ? "" : ' — <a href="' + route("print/all") + '">' + esc(t("print.allLink")) + "</a>") + "</span>" +
    '<span class="muted">' + esc(t("print.formLanguage")) + "</span>" + langToggle(lang) + "</div>" + forms);
  document.querySelectorAll(".printbar .langtoggle button").forEach(b => {
    b.onclick = () => { state.printLang = b.dataset.lang; render(); };
  });
}
