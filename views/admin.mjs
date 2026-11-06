"use strict";
import { state, route, reloadData } from "../store.mjs";
import { parseRosterCsv, txt, normGender, isReservedDelegation, normReference, programmeLabel } from "../logic.mjs";
import { t, getLang } from "../i18n.mjs";
import { esc, app, toast, errorText, showSkeleton, copyText, LOGO_MARK } from "../ui.mjs";
import { authBanner, bindAuthBanner } from "../shell.mjs";

// Re-checked after every await: the user may have signed out, switched, or left #admin meanwhile.
const onAdmin = () => !!(state.session && state.profile && state.profile.is_admin && location.hash === "#admin");

function roster(text, errEl, fw) {
  let rows;
  try { rows = parseRosterCsv(text); }
  catch (err) { if (errEl) errEl.textContent = t("admin.rosterError", { line: err.line }); return null; }
  const bad = rows.find(r => normGender(r.gender) === null);
  if (bad) { if (errEl) errEl.textContent = t("admin.genderError", { value: bad.gender }); return null; }
  const reserved = rows.find(r => isReservedDelegation(fw, r.country));
  if (reserved) { if (errEl) errEl.textContent = t("setup.reserved", { name: String(reserved.country).trim() }); return null; }
  return rows.map(r => Object.assign({}, r, { gender: normGender(r.gender) }));
}

function bar(back) {
  return '<header class="bar"><span class="brand">' + LOGO_MARK + "<h1>" + esc(t("admin.title")) +
    '</h1></span><span class="spacer"></span><a class="btn" href="' + back + '">' + esc(t("common.back")) + "</a></header>";
}

export async function renderAdmin(message, createdCode) {
  if (onAdmin()) showSkeleton();
  const back = state.programmeId ? route("grid") : "#join";
  let frameworks, programmes;
  try { [frameworks, programmes] = await Promise.all([state.backend.listFrameworks(), state.backend.allProgrammes()]); }
  catch (err) {
    if (!onAdmin()) return;
    app().innerHTML = bar(back) + "<main>" + authBanner() + '<p class="formerr" id="adminLoadErr">' + esc(errorText(err)) +
      '</p><button class="btn primary" id="adminRetry">' + esc(t("load.retry")) + "</button></main>";
    document.getElementById("adminRetry").onclick = () => renderAdmin();
    bindAuthBanner();
    return;
  }
  if (!onAdmin()) return;
  const lang = getLang();
  const field = (label, id) => "<label>" + esc(label) + '<input type="text" id="' + id + '"></label>';
  app().innerHTML = bar(back) + "<main>" + authBanner() +
    '<div class="card"><h3>' + esc(t("admin.newProgramme")) + '</h3><form id="newProg" class="authform" novalidate>' +
      field(t("admin.name"), "aName") +
      "<label>" + esc(t("admin.reference")) + '<input type="text" id="aRef" placeholder="V-2026-002" autocapitalize="characters"></label>' +
      "<label>" + esc(t("admin.framework")) + '<select id="aFramework">' + frameworks.map(f =>
        '<option value="' + esc(f.key) + '">' + esc(txt(f.name, lang)) + "</option>").join("") + "</select></label>" +
      "<label>" + esc(t("admin.startDate")) + '<input type="date" id="aStart"></label>' +
      "<label>" + esc(t("admin.finalDay")) + '<input type="date" id="aEnd"></label>' +
      "<label>" + esc(t("admin.roster")) + '<textarea id="aRoster"></textarea></label>' +
      '<p class="formerr" id="adminErr"></p><p class="formok" id="adminMsg">' + esc(message || "") + "</p>" +
      (createdCode ? '<p><code class="joincode" id="createdCode">' + esc(createdCode) + '</code> <button type="button" class="btn" id="copyCreated">' +
        esc(t("common.copy")) + "</button></p>" : "") +
      '<button class="btn primary" type="submit">' + esc(t("admin.create")) + "</button></form></div>" +
    "<h3>" + esc(t("admin.all")) + '</h3><div class="adminlist">' + programmes.map(p =>
      '<div class="card" data-id="' + esc(p.id) + '"><span><b>' + esc(programmeLabel(p)) + "</b>" +
      " · <code>" + esc(p.join_code) + '</code> <button class="btn acopy">' + esc(t("common.copy")) + "</button>" +
      (p.archived ? ' <span class="muted">(' + esc(t("admin.archived")) + ")</span>" : "") +
      '</span><span><a class="btn aopen" href="#p/' + encodeURIComponent(p.id) + '/grid">' + esc(t("admin.open")) + "</a> " +
      '<a class="btn asetup" href="#p/' + encodeURIComponent(p.id) + '/setup">' + esc(t("admin.setup")) + "</a> " +
      '<button class="btn aarch">' + esc(t(p.archived ? "admin.unarchive" : "admin.archive")) + "</button></span></div>").join("") + "</div></main>";

  bindAuthBanner();
  if (createdCode) document.getElementById("copyCreated").onclick = () => copyText(createdCode, document.getElementById("createdCode"));

  document.getElementById("newProg").onsubmit = async e => {
    e.preventDefault();
    const errEl = document.getElementById("adminErr");
    errEl.textContent = "";
    const name = document.getElementById("aName").value.trim(), refRaw = document.getElementById("aRef").value;
    const start = document.getElementById("aStart").value, end = document.getElementById("aEnd").value;
    if (!name || !refRaw.trim() || !start || !end) { errEl.textContent = t("admin.required"); return; }
    const reference = normReference(refRaw);
    if (!reference) { errEl.textContent = t("admin.referenceFormat"); return; }
    if (start > end) { errEl.textContent = t("admin.datesOrder"); return; }
    const fwKey = document.getElementById("aFramework").value;
    const rows = roster(document.getElementById("aRoster").value, errEl, frameworks.find(f => f.key === fwKey));
    if (!rows) return;
    const submit = e.target.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    let res;
    try {
      res = await state.backend.createProgramme({
        frameworkKey: fwKey, name, reference, startDate: start, endDate: end, roster: rows });
    } catch (err) {
      const el = document.getElementById("adminErr");
      if (el) el.textContent = errorText(err);
      const b = document.querySelector('#newProg button[type="submit"]');
      if (b) b.disabled = false;
      return;
    }
    // Written. From here the form must never become submittable again (a retry would duplicate the programme).
    try { state.memberships = await state.backend.myMemberships(); }
    catch (err) { toast(t("admin.savedRefreshFailed"), "error"); }
    if (!onAdmin()) return;
    await renderAdmin(t("admin.created", { code: res.join_code }), res.join_code);
  };
  app().querySelectorAll(".adminlist .card").forEach(card => {
    const p = programmes.find(x => x.id === card.dataset.id);
    card.querySelector(".acopy").onclick = () => copyText(p.join_code, card.querySelector("code"));
    card.querySelector(".aarch").onclick = async e => {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      try { await state.backend.setArchived(p.id, !p.archived); }
      catch (err) { toast(errorText(err), "error"); btn.disabled = false; return; }
      try {
        state.memberships = await state.backend.myMemberships();
        if (p.id === state.programmeId) await reloadData();
      } catch (err) { toast(t("admin.savedRefreshFailed"), "error"); }
      if (onAdmin()) renderAdmin();
    };
  });
}
