"use strict";
// Session-wide state, the write queue, and helpers derived from them.
// main.mjs owns rendering and registers it via setRenderer().
import { applyOps, buildGrid } from "./logic.mjs";
import { createQueue } from "./queue.mjs";
import { setLang, getLang } from "./i18n.mjs";

export const state = {
  backend: null, session: null, profile: null, memberships: [],
  programmeId: null, data: null, goalCountry: null, printLang: null, authPaused: 0,
};

let renderer = () => {};
export function setRenderer(fn) { renderer = fn; }
export function render() { renderer(); }

// One queue per user, stored under its own key. On a shared camp phone A's queued ops must
// never be written as B, and B must never see them: they wait under A's key until A is back.
const QUEUE_PREFIX = "pdpef-queue-v2:";
const queues = {}; // userId -> queue; one instance per user per page, so two never share a key
let queueUser = null; // whose queue is active (null = signed out, no queue)
let held = false; // a sign-out is in progress: send nothing more
export let queue = null;

const heldError = () => Object.assign(new Error("not authenticated: queue held for sign-out"), { status: 401 });

function makeQueue(userId, hooks) {
  const key = QUEUE_PREFIX + userId;
  const active = () => queue === q && queueUser === userId;
  const q = createQueue({
    storage: {
      load: () => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; } },
      save: ops => localStorage.setItem(key, JSON.stringify(ops)),
    },
    // An inactive or held queue rejects as "auth": it pauses, and keeps its ops for its own user.
    write: op => (active() && !held ? state.backend.write(op) : Promise.reject(heldError())),
    onApplied: (op, result) => { if (active()) mergeResult(op, result); },
    onPermanent: (op, err) => { if (active() && hooks.onPermanent) hooks.onPermanent(op, err); },
    onAuthNeeded: n => { if (active() && !held && hooks.onAuthNeeded) hooks.onAuthNeeded(n); },
    onChange: () => { if (active()) render(); },
  });
  return q;
}

// Make userId's queue the active one (null when signed out). Called whenever the session user may
// have changed; a no-op for the same user. A returning user's queue resumes and flushes.
export function initQueue(userId, hooks) {
  userId = userId || null;
  if (userId === queueUser) return queue;
  held = false;
  queueUser = userId;
  state.authPaused = 0;
  queue = userId ? (queues[userId] = queues[userId] || makeQueue(userId, hooks || {})) : null;
  if (queue) queue.resume();
  return queue;
}

// Sign-out: stop sending the current user's ops (an in-flight one still completes as them).
export function holdQueue() { held = true; }
export function releaseQueue() { held = false; if (queue) queue.resume(); }
export function pendingCount() { return queue ? queue.all().length : 0; }
// The session is valid again (token refreshed / signed in): clear the banner and retry.
export function resumeQueue() {
  if (!state.authPaused) return false;
  state.authPaused = 0;
  if (queue) queue.resume();
  return true;
}

export function enqueue(method, payload) {
  if (!queue) return Promise.resolve();
  return queue.enqueue({ method, at: new Date().toISOString(), programmeId: state.programmeId, userId: queueUser, payload });
}

export function author() { return { authorId: state.profile.id, authorName: state.profile.display_name }; }
export function pendingOps() { return queue ? queue.forProgramme(state.programmeId) : []; }
export function view() { return applyOps(state.data, pendingOps()); }
export function gridOf(v) { return buildGrid(state.data.participants, v.entries); }
export function evidenceIndex(v) { const o = {}; v.evidence.forEach(e => { o[e.id] = e; }); return o; }
export function membership() { return state.data.members.find(m => m.user_id === state.profile.id) || null; }
export function isStaff() { if (state.profile.is_admin) return true; const m = membership(); return !!m && m.role === "staff"; }
export function canWrite() { return !state.data.programme.archived || !!state.profile.is_admin; }
export function myDelegation() { const m = membership(); return (m && m.delegation) || ""; }
export function participantById(id) { return state.data.participants.find(p => p.id === id) || null; }
// Where "Back" and post-reset should go: the current/last/latest programme, else the join screen.
export function homeHash() {
  const ids = state.memberships.map(x => x.programme.id);
  const isMine = id => !!id && ids.indexOf(id) >= 0;
  let last = null;
  try { last = localStorage.getItem("pdpef-last-programme"); } catch (e) { /* ignore */ }
  const pid = state.programmeId || [last, state.profile && state.profile.last_programme_id].find(isMine) || ids[ids.length - 1];
  return pid ? "#p/" + encodeURIComponent(pid) + "/grid" : "#join";
}
export function route(path) { return "#p/" + encodeURIComponent(state.programmeId) + "/" + path; }

export async function reloadData() {
  const pid = state.programmeId;
  const d = await state.backend.loadProgramme(pid);
  if (pid === state.programmeId) state.data = d;
}

export function changeLanguage(lang) {
  setLang(lang);
  localStorage.setItem("pdpef-lang", getLang());
  if (state.profile && state.profile.lang !== getLang()) {
    state.profile.lang = getLang();
    state.backend.updateProfile({ lang: getLang() }).catch(() => {});
  }
  render();
}

function mergeResult(op, result) {
  if (!state.data || op.programmeId !== state.programmeId) return;
  if (op.method === "add_evidence" && result && !state.data.evidence.some(e => e.id === result.id)) {
    state.data.evidence.push(result);
  } else if (op.method === "add_entry" && result && !state.data.entries.some(e => e.id === result.id)) {
    state.data.entries.push(result);
  } else if (op.method === "remove_entry") {
    state.data.entries = state.data.entries.filter(e => e.id !== op.payload.entryId);
  } else if (op.method === "hide_evidence") {
    state.data.evidence.forEach(e => { if (e.id === op.payload.evidenceId) e.status = "hidden"; });
  }
}
