"use strict";
// SharePoint sheet: one row per participant (delegation, gender, Y/N per indicator), ready to
// copy into the CISV International SharePoint or download as .xlsx. Staff and platform admin.
import { state, view, gridOf, evidenceIndex, route, isStaff } from "../store.mjs";
import { indicatorsOf, sheetRows, sheetTsv, localDate, xlsxFileName } from "../logic.mjs";
import { buildXlsx } from "../xlsx.mjs";
import { t, tn } from "../i18n.mjs";
import { esc, toast } from "../ui.mjs";
import { renderShell } from "../shell.mjs";

export function renderSheet() {
  const d = state.data, fw = d.framework, inds = indicatorsOf(fw);
  const v = view();
  const rows = sheetRows(d.participants, fw, gridOf(v), evidenceIndex(v), d.programme.end_date || null, localDate());
  const head = '<tr><th class="sname">' + esc(t("sheet.participant")) + ' <span class="muted">(' + esc(t("sheet.notCopied")) +
    ")</span></th><th>" + esc(t("sheet.delegation")) + "</th><th>" + esc(t("sheet.gender")) + "</th>" +
    inds.map(i => "<th>" + esc(i.code) + "</th>").join("") + "</tr>";
  const body = rows.map(r => '<tr><td class="sname">' + esc(r.name) + "</td><td>" + esc(r.delegation) + "</td><td>" +
    esc(r.gender) + "</td>" + r.values.map(x => '<td class="yn">' + esc(x) + "</td>").join("") + "</tr>").join("");
  const notice = d.programme.end_date ? "" : '<p class="banner" id="noFinalDay">' + esc(t("sheet.noFinalDay")) +
    (isStaff() ? ' <a href="' + esc(route("setup")) + '">' + esc(t("sheet.setFinalDay")) + "</a>" : "") + "</p>";
  renderShell(null,
    '<div class="card"><h3>' + esc(t("sheet.title")) + '</h3><p class="muted">' + esc(t("sheet.help")) + "</p>" + notice +
    '<p><button class="btn primary" id="copyRows">' + esc(t("sheet.copy")) + '</button> <button class="btn" id="downloadXlsx">' +
    esc(t("sheet.download")) + "</button></p></div>" +
    '<div class="gridwrap"><table class="sheet" id="sheetTable">' + head + body + "</table></div>");
  document.getElementById("copyRows").onclick = () => copyRows(rows);
  document.getElementById("downloadXlsx").onclick = () => downloadXlsx(rows, inds, d.programme);
}

async function copyRows(rows) {
  const tsv = sheetTsv(rows);
  const html = "<table>" + rows.map(r => "<tr>" + [r.delegation, r.gender].concat(r.values)
    .map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") + "</table>";
  const clip = navigator.clipboard;
  const attempts = [];
  if (window.ClipboardItem && clip && clip.write) {
    attempts.push(() => clip.write([new ClipboardItem({
      "text/plain": new Blob([tsv], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }) })]));
  }
  if (clip && clip.writeText) attempts.push(() => clip.writeText(tsv));
  for (const attempt of attempts) {
    try {
      await attempt();
      toast(tn("sheet.copied", rows.length), "success");
      return;
    } catch (e) { /* refused: try the next way */ }
  }
  toast(t("sheet.copyFailed"), "error");
}

function downloadXlsx(rows, inds, programme) {
  const data = [["Delegation", "Gender"].concat(inds.map(i => i.code))]
    .concat(rows.map(r => [r.delegation, r.gender].concat(r.values)));
  const blob = new Blob([buildXlsx(data, { headerRows: 1, sheetName: "PDPEF" })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = xlsxFileName(programme);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
