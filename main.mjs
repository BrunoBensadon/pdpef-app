"use strict";
// Boot, backend choice, auth lifecycle, hash router and background refresh.
import { state, setRenderer, render, initQueue, queue, resumeQueue, route, isStaff } from "./store.mjs";
import { setLang, detectLang, t } from "./i18n.mjs";
import { esc, app, showSkeleton, toast, errorText, closeSheet } from "./ui.mjs";
import { SUPABASE_JS_URL, ENVIRONMENTS } from "./config.mjs";
import { createSupabaseBackend } from "./backend-supabase.mjs";
import { renderGrid } from "./views/grid.mjs";
import { openEditor } from "./views/editor.mjs";
import { renderGoal } from "./views/goal.mjs";
import { renderParticipant } from "./views/participant.mjs";
import { renderMembers } from "./views/members.mjs";
import { renderAdmin } from "./views/admin.mjs";
import { renderPrint } from "./views/print.mjs";
import { renderSetup, leaveSetupOk } from "./views/setup.mjs";
import { renderSheet } from "./views/sheet.mjs";
import { renderSignIn, renderSignUp, renderForgot, renderReset, renderJoin, resetJoin } from "./views/auth.mjs";

const IS_LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const LAST_KEY = "pdpef-last-programme";

async function makeBackend() {
  const env = localStorage.getItem("pdpef-env");
  if (IS_LOCAL && env !== "staging") {
    const mock = await import("/local/backend-mock.mjs");
    return mock.createBrowserMockBackend();
  }
  const { createClient } = await import(SUPABASE_JS_URL);
  const cfg = ENVIRONMENTS[env === "staging" ? "staging" : "production"];
  return createSupabaseBackend(createClient, cfg.url, cfg.anonKey,
    { redirectTo: location.origin + location.pathname });
}

function showFatal(err) {
  app().innerHTML = '<main class="welcome"><p>' + esc(t("load.failed", { msg: (err && err.message) || err })) +
    '</p><p><button class="btn" id="retry">' + esc(t("load.retry")) + "</button></p></main>";
  document.getElementById("retry").onclick = () => location.reload();
}

const QUEUE_HOOKS = {
  onPermanent: (op, err) => toast(errorText(err), "error"),
  onAuthNeeded: n => { state.authPaused = n; },
};

let authChain = Promise.resolve();
function syncAuth(signedOut) {
  authChain = authChain.then(() => afterAuthChange(signedOut)).catch(showFatal);
  return authChain;
}

async function afterAuthChange(signedOut) {
  const s = await state.backend.session();
  // Each user has their own offline queue; switching users never hands one user's ops to another.
  initQueue(s ? s.userId : null, QUEUE_HOOKS);
  const resumed = !!s && resumeQueue();
  if (s && state.session && s.userId === state.session.userId && state.profile) { if (resumed) render(); return; }
  closeSheet();
  resetJoin();
  Object.assign(state, { session: s, profile: null, memberships: [], data: null, programmeId: null });
  if (!s) {
    // Don't strand the next person on #admin, #reset or someone else's programme route.
    if (signedOut && location.hash) history.replaceState(null, "", location.pathname + location.search);
    render();
    return;
  }
  state.profile = await state.backend.getProfile();
  const deviceLang = localStorage.getItem("pdpef-lang");
  if (deviceLang && deviceLang !== state.profile.lang) {
    state.profile.lang = deviceLang;
    state.backend.updateProfile({ lang: deviceLang }).catch(() => {});
  }
  setLang(state.profile.lang);
  state.memberships = await state.backend.myMemberships();
  if (/^#(join|admin|reset)$/.test(location.hash)) { render(); return; } // explicit non-programme screens win
  const m = (location.hash || "").match(/^#p\/([^/]+)/);
  const ids = state.memberships.map(x => x.programme.id);
  const isMine = id => !!id && ids.indexOf(id) >= 0;
  let hashPid = m ? decodeURIComponent(m[1]) : null;
  if (hashPid && !isMine(hashPid) && !state.profile.is_admin) hashPid = null;
  const target = hashPid || [localStorage.getItem(LAST_KEY), state.profile.last_programme_id].find(isMine) || ids[ids.length - 1];
  if (target) return openProgramme(target, hashPid ? null : "grid");
  render();
}

async function openProgramme(pid, path) {
  closeSheet();
  showSkeleton();
  Object.assign(state, { programmeId: pid, data: null, goalCountry: null });
  try {
    const d = await state.backend.loadProgramme(pid);
    if (state.programmeId !== pid) return;
    state.data = d;
  } catch (err) {
    if (state.programmeId !== pid) return;
    state.programmeId = null;
    toast(errorText(err), "error");
    if (location.hash.startsWith("#p/")) location.hash = ""; else render();
    return;
  }
  localStorage.setItem(LAST_KEY, pid);
  if (state.profile.last_programme_id !== pid) {
    state.profile.last_programme_id = pid;
    state.backend.updateProfile({ last_programme_id: pid }).catch(() => {});
  }
  if (queue) queue.flush();
  if (path != null && location.hash !== route(path)) { location.hash = route(path); return; }
  render();
}

// Re-rendering the same route (queue changes, edits, background refresh) rebuilds #app; keep the
// window and grid scroll positions so the page doesn't jump back to the top-left.
let lastHash = null;
function renderRoute() {
  const h = location.hash, same = h === lastHash;
  const sx = window.scrollX, sy = window.scrollY;
  const gw = document.querySelector(".gridwrap");
  const gridLeft = gw ? gw.scrollLeft : null;
  routeNow();
  lastHash = h;
  if (!same || location.hash !== h) return;
  const maxY = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
  if (sx || sy) window.scrollTo(sx, Math.min(sy, maxY));
  const gw2 = document.querySelector(".gridwrap");
  if (gw2 && gridLeft) gw2.scrollLeft = Math.min(gridLeft, Math.max(gw2.scrollWidth - gw2.clientWidth, 0));
}

function routeNow() {
  if (!state.backend) return;
  const h = location.hash || "";
  if (h === "#reset") return renderReset();
  if (!state.session) return h === "#signup" ? renderSignUp() : h === "#forgot" ? renderForgot() : renderSignIn();
  if (!state.profile) return;
  const m = h.match(/^#p\/([^/]+)\/?(.*)$/);
  if (m) {
    const pid = decodeURIComponent(m[1]);
    if (pid !== state.programmeId) { openProgramme(pid, null); return; }
    if (!state.data) return; // still loading
    return renderProgrammeRoute(m[2]);
  }
  return renderOutside(h);
}

function renderProgrammeRoute(rest) {
  let r = null;
  if ((r = rest.match(/^goal\/([^/]+)$/))) return renderGoal(decodeURIComponent(r[1]));
  if ((r = rest.match(/^participant\/([^/]+)$/))) return renderParticipant(decodeURIComponent(r[1]));
  if (rest === "members") return isStaff() ? renderMembers() : renderGrid();
  if ((r = rest.match(/^print\/([^/]+)$/))) return renderPrint(decodeURIComponent(r[1]));
  if (rest === "setup") return isStaff() ? renderSetup() : renderGrid();
  if (rest === "sheet") return isStaff() ? renderSheet() : renderGrid();
  // Later tasks add their routes here, above the grid fallback.
  return renderGrid();
}

function renderOutside(h) {
  if (h === "#join") return renderJoin();
  if (h === "#admin") return state.profile.is_admin ? renderAdmin() : renderJoin();
  if (state.programmeId && state.data) { location.hash = route("grid"); return; }
  // A platform admin need not belong to any programme (the import creates no memberships):
  // their home is the Admin screen, not a join screen with no way out.
  if (state.profile.is_admin) {
    history.replaceState(null, "", location.pathname + location.search + "#admin");
    return renderAdmin();
  }
  return renderJoin();
}

function refresh() {
  if (!state.data || document.hidden) return Promise.resolve();
  const pid = state.programmeId;
  return state.backend.loadProgramme(pid).then(d => {
    if (pid !== state.programmeId) return;
    state.data = d;
    if (location.hash.indexOf("#p/") === 0) render(); // renderRoute() keeps the scroll position
    if (queue) queue.flush();
  }).catch(() => {});
}

async function start() {
  setLang(localStorage.getItem("pdpef-lang") || detectLang(navigator.language));
  showSkeleton();
  document.addEventListener("click", () => {
    ["appMenu", "switcher"].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  });
  window.addEventListener("hashchange", e => {
    const was = new URL(e.oldURL).hash;
    if (/\/setup$/.test(was) && was !== location.hash && !leaveSetupOk()) {
      history.replaceState(null, "", was); // stay on Setup with the draft intact
      return;
    }
    render();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(refresh, 60000);
  try { state.backend = await makeBackend(); } catch (err) { showFatal(err); return; }
  setRenderer(renderRoute);
  state.backend.onAuth(event => {
    if (event === "PASSWORD_RECOVERY") location.hash = "#reset";
    // Never await Supabase calls inside its auth callback (deadlock): defer.
    // SIGNED_IN also resumes a queue paused on an expired session (see afterAuthChange).
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => syncAuth(event === "SIGNED_OUT"), 0);
    if (event === "TOKEN_REFRESHED") setTimeout(() => { if (state.session && resumeQueue()) render(); }, 0);
  });
  await syncAuth();
  if (location.search.indexOf("code=") >= 0) history.replaceState(null, "", location.pathname + location.hash);
  if (IS_LOCAL) window.__pdpef = { state, openEditor, refresh, backend: state.backend, ready: true };
}

start();
