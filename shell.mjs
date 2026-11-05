"use strict";
// App bar (programme switcher + ⋮ menu), banners, bottom tabs and queue badge.
import { state, route, isStaff, changeLanguage, reloadData, render, pendingOps, pendingCount,
  holdQueue, releaseQueue, resumeQueue } from "./store.mjs";
import { t, tn, getLang } from "./i18n.mjs";
import { esc, app, LOGO_MARK, toast, errorText } from "./ui.mjs";
import { indicatorsOf } from "./logic.mjs";
import { errorKind } from "./queue.mjs";

function progLink(m) {
  const p = m.programme;
  return '<a href="#p/' + encodeURIComponent(p.id) + '/grid" class="' + (p.id === state.programmeId ? "on" : "") +
    (p.archived ? " past" : "") + '"><span>' + esc(p.name) + (p.year ? " " + esc(p.year) : "") + "</span>" +
    '<span class="muted">' + esc(t("role." + m.role)) + "</span></a>";
}

// Every UI sign-out goes through here. Pending ops stay on this device under the user's own
// queue key and are saved when they sign in again; warn first so nobody is surprised.
export function signOut({ confirmPending = true } = {}) {
  const n = pendingCount();
  if (confirmPending && n && !confirm(tn("queue.signOutPending", n))) return Promise.resolve();
  holdQueue();
  return state.backend.signOut().catch(err => { releaseQueue(); toast(errorText(err), "error"); });
}

// "Sign in again" banner, shown when the queue paused on an expired session (any signed-in screen).
export function authBanner() {
  return state.session && state.authPaused ? '<div class="banner warn" id="authBanner"><span>' +
    esc(tn("queue.signInAgain", state.authPaused)) + '</span><button class="btn" id="reauth">' +
    esc(t("queue.signInButton")) + "</button></div>" : "";
}

export function bindAuthBanner() {
  const ra = document.getElementById("reauth");
  if (!ra) return;
  ra.onclick = async () => {
    ra.disabled = true;
    let s;
    try { s = await state.backend.session(); }
    catch (err) {
      if (errorKind(err) !== "auth") { ra.disabled = false; toast(errorText(err), "error"); return; } // offline: keep the session
      s = null;
    }
    // Still (or again) signed in, e.g. the token refreshed meanwhile: resume without signing out.
    if (s) { resumeQueue(); render(); return; }
    signOut({ confirmPending: false });
  };
}

export function renderShell(active, content) {
  const d = state.data, p = d.programme;
  const firstInd = indicatorsOf(d.framework)[0];
  const firstPart = d.participants[0];
  const tabs = [
    ["grid", "grid", t("nav.overview")],
    ["goal", "goal/" + (firstInd ? encodeURIComponent(firstInd.code) : ""), t("nav.byGoal")],
    ["participant", "participant/" + (firstPart ? encodeURIComponent(firstPart.id) : ""), t("nav.byParticipant")],
  ];
  const current = state.memberships.filter(m => !m.programme.archived);
  const past = state.memberships.filter(m => m.programme.archived);
  const pending = pendingOps().length;
  app().innerHTML =
    '<header class="bar"><span class="brand">' + LOGO_MARK +
      '<button class="progbtn" id="progBtn" aria-haspopup="true"><h1>' + esc(p.name) +
      (p.year ? " " + esc(p.year) : "") + " ▾</h1></button></span>" +
      '<span class="spacer"></span><span class="who">' + esc(state.profile.display_name) + "</span>" +
      '<button class="menubtn" id="menuBtn" aria-label="' + esc(t("menu.open")) + '">⋮</button>' +
      '<div class="switcher" id="switcher" hidden><h4>' + esc(t("switcher.title")) + "</h4>" +
        current.map(progLink).join("") + '<a href="#join">' + esc(t("switcher.join")) + "</a>" +
        (past.length ? "<h4>" + esc(t("switcher.past")) + "</h4>" + past.map(progLink).join("") : "") + "</div>" +
      '<div class="menu" id="appMenu" hidden>' +
        '<button id="printAll">' + esc(t("menu.printAll")) + "</button>" +
        (isStaff() ? '<button id="membersBtn">' + esc(t("menu.members")) + "</button>" : "") +
        (state.profile.is_admin ? '<button id="adminBtn">' + esc(t("menu.admin")) + "</button>" : "") +
        '<button id="langBtn">' + esc(t("menu.language")) + ": " + (getLang() === "pt" ? "English" : "Português") + "</button>" +
        '<button id="nameBtn">' + esc(t("menu.yourName")) + "</button>" +
        '<button id="signOut">' + esc(t("menu.signOut")) + "</button>" +
      "</div></header>" +
    "<main>" +
      authBanner() +
      (p.archived ? '<div class="banner">' + esc(t("programme.archived")) + "</div>" : "") +
      content + "</main>" +
    '<nav class="tabs">' + tabs.map(tb => '<a href="' + esc(route(tb[1])) + '" class="' +
      (tb[0] === active ? "on" : "") + '">' + esc(tb[2]) + "</a>").join("") + "</nav>" +
    (pending ? '<div class="queuebadge">' + esc(tn("queue.saving", pending)) + "</div>" : "");

  const sw = document.getElementById("switcher"), menu = document.getElementById("appMenu");
  document.getElementById("progBtn").onclick = e => { e.stopPropagation(); menu.hidden = true; sw.hidden = !sw.hidden; };
  document.getElementById("menuBtn").onclick = e => { e.stopPropagation(); sw.hidden = true; menu.hidden = !menu.hidden; };
  document.getElementById("printAll").onclick = () => { location.hash = route("print/all"); };
  const mb = document.getElementById("membersBtn");
  if (mb) mb.onclick = () => { location.hash = route("members"); };
  const ab = document.getElementById("adminBtn");
  if (ab) ab.onclick = () => { location.hash = "#admin"; };
  document.getElementById("langBtn").onclick = () => changeLanguage(getLang() === "pt" ? "en" : "pt");
  document.getElementById("nameBtn").onclick = () => {
    const name = (prompt(t("menu.yourName"), state.profile.display_name) || "").trim();
    if (!name || name === state.profile.display_name) return;
    state.profile.display_name = name;
    state.backend.updateProfile({ display_name: name }).then(reloadData).then(render)
      .catch(err => toast(errorText(err), "error"));
  };
  document.getElementById("signOut").onclick = () => { signOut(); };
  bindAuthBanner();
}
