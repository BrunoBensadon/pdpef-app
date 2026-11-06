"use strict";
import { state, render, reloadData, canWrite, homeHash } from "../store.mjs";
import { delegationsOf, joinOnlyDelegations, STAFF_DELEGATION } from "../logic.mjs";
import { t } from "../i18n.mjs";
import { esc, toast, errorText, copyText } from "../ui.mjs";
import { renderShell } from "../shell.mjs";

// Leaders who joined under "Staff" come first: they are waiting to be promoted.
const rank = m => (m.role === "leader" && m.delegation === STAFF_DELEGATION ? 0 : m.role === "staff" ? 1 : 2);

export function renderMembers() {
  const d = state.data, pid = d.programme.id, rw = canWrite();
  const delegs = delegationsOf(d.participants).concat(joinOnlyDelegations(d.framework));
  const members = d.members.slice().sort((a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name));
  const waiting = members.filter(m => rank(m) === 0).length;
  renderShell(null,
    '<div class="card"><h3>' + esc(t("members.title")) + "</h3><p>" + esc(t("members.joinCode")) +
    ': <code class="joincode" id="joinCode">' + esc(d.programme.join_code) + "</code></p>" +
    '<p><button class="btn" id="copyCode">' + esc(t("common.copy")) + "</button>" + (rw ? ' <button class="btn" id="regen">' +
    esc(t("members.regenerate")) + "</button>" : "") + "</p></div>" +
    (waiting && rw ? '<p class="muted" id="staffJoiners">' + esc(t("members.joinedAsStaff")) + "</p>" : "") +
    members.map(m => '<div class="card member" data-user="' + esc(m.user_id) + '"><b>' + esc(m.display_name) +
      '</b> <span class="muted">' + esc(t("role." + m.role)) + "</span><br><label>" + esc(t("members.delegation")) +
      ' <select class="mdeleg"' + (rw ? "" : " disabled") + ">" + (m.role === "staff" ? '<option value=""></option>' : "") +
      delegs.map(c => "<option" + (c === m.delegation ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select></label>" +
      (rw ? ' <button class="btn mrole' + (rank(m) === 0 ? " primary" : "") + '">' +
        esc(t(m.role === "staff" ? "members.makeLeader" : "members.makeStaff")) + "</button> " +
        '<button class="btn danger mremove">' + esc(t("members.remove")) + "</button>" : "") + "</div>").join(""));

  async function act(fn, after) {
    document.querySelectorAll("#app button, #app select, .card button, .card select").forEach(el => { el.disabled = true; });
    try {
      await fn();
      if (after) await after();
      else { await reloadData(); toast(t("members.saved"), "success"); }
    } catch (err) { toast(errorText(err), "error"); }
    try { state.memberships = await state.backend.myMemberships(); } catch (e) { /* keep the old list */ }
    render();
  }
  document.getElementById("copyCode").onclick = () => copyText(d.programme.join_code, document.getElementById("joinCode"));
  if (!rw) return;
  document.getElementById("regen").onclick = () => {
    if (confirm(t("members.confirmRegenerate"))) act(() => state.backend.regenerateJoinCode(pid));
  };
  document.querySelectorAll(".card.member").forEach(card => {
    const m = d.members.find(x => x.user_id === card.dataset.user), sel = card.querySelector(".mdeleg");
    sel.onchange = e => act(() => state.backend.setMember(pid, m.user_id, m.role, e.target.value));
    card.querySelector(".mrole").onclick = () => {
      const toStaff = m.role !== "staff";
      const deleg = toStaff ? m.delegation : (m.delegation || sel.value);
      if (!toStaff && !deleg) { toast(t("members.pickDelegation"), "error"); sel.focus(); return; }
      act(() => state.backend.setMember(pid, m.user_id, toStaff ? "staff" : "leader", deleg));
    };
    card.querySelector(".mremove").onclick = () => {
      if (!confirm(t("members.confirmRemove", { name: m.display_name }))) return;
      if (m.user_id !== state.profile.id) { act(() => state.backend.removeMember(pid, m.user_id)); return; }
      act(() => state.backend.removeMember(pid, m.user_id), async () => {
        state.memberships = await state.backend.myMemberships();
        state.programmeId = null; state.data = null;
        toast(t("members.youLeft"), "success");
        location.hash = homeHash();
      });
    };
  });
}
