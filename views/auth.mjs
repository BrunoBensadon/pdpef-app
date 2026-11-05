"use strict";
// Screens shown outside a programme: sign-in, sign-up, password reset, join.
import { state, changeLanguage, render, homeHash } from "../store.mjs";
import { t, getLang } from "../i18n.mjs";
import { esc, app, langToggle, LOGO_MARK, errorText, toast } from "../ui.mjs";
import { normJoinCode } from "../logic.mjs";
import { signOut, authBanner, bindAuthBanner } from "../shell.mjs";

function authErrorText(err) {
  const m = String((err && err.message) || err || "");
  if (/Invalid login credentials/i.test(m)) return t("auth.err.invalid");
  if (/Email not confirmed/i.test(m)) return t("auth.err.unconfirmed");
  if (/Password should be|at least \d+ characters/i.test(m)) return t("auth.err.weak");
  if (/already (been )?registered/i.test(m)) return t("auth.err.exists");
  return t("error.generic", { msg: m });
}

function frame(title, body) {
  app().innerHTML = '<main class="welcome">' + authBanner() + '<div class="logo">' + LOGO_MARK + "</div>" + langToggle(getLang()) +
    "<h2>" + esc(title) + "</h2>" + body + "</main>";
  app().querySelectorAll(".langtoggle button").forEach(b => { b.onclick = () => changeLanguage(b.dataset.lang); });
  bindAuthBanner();
}

const field = (label, type, id, auto) => "<label>" + esc(label) + '<input type="' + type + '" id="' + id +
  '" autocomplete="' + auto + '" required></label>';
const val = id => document.getElementById(id).value;
const setMsg = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
function busy(form, on) { form.querySelectorAll("button, input").forEach(el => { el.disabled = on; }); }

export function renderSignIn() {
  frame(t("auth.title"),
    '<button class="btn primary wide" id="google">' + esc(t("auth.google")) + "</button>" +
    '<p class="or">' + esc(t("auth.or")) + "</p>" +
    '<form id="signinForm" class="authform" novalidate>' +
      field(t("auth.email"), "email", "email", "email") +
      field(t("auth.password"), "password", "password", "current-password") +
      '<p class="formerr" id="err"></p>' +
      '<button class="btn primary wide" type="submit">' + esc(t("auth.signIn")) + "</button></form>" +
    '<p><a href="#signup">' + esc(t("auth.createAccount")) + '</a> · <a href="#forgot">' + esc(t("auth.forgot")) + "</a></p>");
  document.getElementById("google").onclick = () =>
    state.backend.signInGoogle().catch(err => setMsg("err", authErrorText(err)));
  const form = document.getElementById("signinForm");
  form.onsubmit = async e => {
    e.preventDefault();
    busy(form, true);
    try { await state.backend.signInPassword(val("email"), val("password")); } // onAuth → main takes over
    catch (err) { busy(form, false); setMsg("err", authErrorText(err)); }
  };
}

export function renderSignUp() {
  frame(t("auth.signUpTitle"),
    '<form id="signupForm" class="authform" novalidate>' +
      field(t("auth.displayName"), "text", "displayName", "name") +
      field(t("auth.email"), "email", "email", "email") +
      field(t("auth.password"), "password", "password", "new-password") +
      '<p class="formerr" id="err"></p><p class="formok" id="ok"></p>' +
      '<button class="btn primary wide" type="submit">' + esc(t("auth.signUp")) + "</button></form>" +
    '<p><a href="#signin">' + esc(t("auth.haveAccount")) + "</a></p>");
  const form = document.getElementById("signupForm");
  form.onsubmit = async e => {
    e.preventDefault();
    setMsg("err", ""); setMsg("ok", "");
    if (!val("displayName").trim()) { setMsg("err", t("auth.err.nameRequired")); return; }
    if (val("password").length < 8) { setMsg("err", t("auth.err.weak")); return; }
    busy(form, true);
    try {
      const res = await state.backend.signUp(val("email"), val("password"), val("displayName").trim(), getLang());
      if (res.confirmationSent) setMsg("ok", t("auth.checkEmail"));
    } catch (err) { setMsg("err", authErrorText(err)); }
    busy(form, false);
  };
}

export function renderForgot() {
  frame(t("auth.resetTitle"),
    '<form id="forgotForm" class="authform" novalidate>' + field(t("auth.email"), "email", "email", "email") +
      '<p class="formerr" id="err"></p><p class="formok" id="ok"></p>' +
      '<button class="btn primary wide" type="submit">' + esc(t("auth.sendReset")) + "</button></form>" +
    '<p><a href="#signin">' + esc(t("auth.back")) + "</a></p>");
  const form = document.getElementById("forgotForm");
  form.onsubmit = async e => {
    e.preventDefault();
    busy(form, true);
    // Same message whether or not the account exists (no account enumeration).
    try { await state.backend.sendReset(val("email")); setMsg("ok", t("auth.resetSent")); }
    catch (err) {
      const m = String((err && err.message) || err || "");
      if (/fetch|network/i.test(m)) setMsg("err", t("error.generic", { msg: m })); else setMsg("ok", t("auth.resetSent"));
    }
    busy(form, false);
  };
}

export function renderReset() {
  frame(t("auth.resetTitle"),
    '<form id="resetForm" class="authform" novalidate>' + field(t("auth.newPassword"), "password", "password", "new-password") +
      '<p class="formerr" id="err"></p>' +
      '<button class="btn primary wide" type="submit">' + esc(t("auth.setPassword")) + "</button></form>");
  const form = document.getElementById("resetForm");
  form.onsubmit = async e => {
    e.preventDefault();
    if (val("password").length < 8) { setMsg("err", t("auth.err.weak")); return; }
    busy(form, true);
    try {
      await state.backend.setPassword(val("password"));
      toast(t("auth.passwordSet"), "success");
      location.hash = homeHash();
    } catch (err) { busy(form, false); setMsg("err", authErrorText(err)); }
  };
}

let preview = null; // {uid, code, id, name, year, delegations} between the two join steps
export function resetJoin() { preview = null; }
const joinErrorText = err => /too many attempts/.test(String(err && err.message)) ? t("join.tooMany") : errorText(err);

export function renderJoin() {
  if (preview && (!state.session || preview.uid !== state.session.userId)) preview = null;
  if (preview) {
    const p = preview;
    frame(t("join.pickDelegation", { name: p.name + (p.year ? " " + p.year : "") }),
      '<div class="userlist">' + p.delegations.map(c => '<button data-deleg="' + esc(c) + '">' + esc(c) + "</button>").join("") +
      '</div><p class="formerr" id="err"></p><p><a href="#join" id="joinBack">' + esc(t("common.back")) + "</a></p>");
    document.getElementById("joinBack").onclick = e => { e.preventDefault(); preview = null; render(); };
    app().querySelectorAll("[data-deleg]").forEach(b => {
      b.onclick = async () => {
        const btns = app().querySelectorAll("[data-deleg]");
        btns.forEach(x => { x.disabled = true; });
        try {
          const pid = await state.backend.joinProgramme(p.code, b.dataset.deleg);
          if (!pid) { btns.forEach(x => { x.disabled = false; }); setMsg("err", t("join.notFound")); return; }
          preview = null;
          state.memberships = await state.backend.myMemberships();
          location.hash = "#p/" + encodeURIComponent(pid) + "/grid";
        } catch (err) { btns.forEach(x => { x.disabled = false; }); setMsg("err", joinErrorText(err)); }
      };
    });
    return;
  }
  const back = homeHash() === "#join" ? "" : homeHash();
  frame(t("join.title"),
    '<p class="muted">' + esc(t("join.help")) + "</p>" +
    '<form id="joinForm" class="authform" novalidate>' +
      '<label>' + esc(t("join.code")) + '<input type="text" id="code" autocomplete="off" autocapitalize="characters" required></label>' +
      '<p class="formerr" id="err"></p>' +
      '<button class="btn primary wide" type="submit">' + esc(t("join.next")) + "</button></form>" +
    "<p>" + (back ? '<a href="' + back + '">' + esc(t("common.back")) + "</a> · " : "") +
    '<a href="#" id="joinSignOut">' + esc(t("join.signOut")) + "</a></p>");
  document.getElementById("joinSignOut").onclick = e => { e.preventDefault(); signOut(); };
  const form = document.getElementById("joinForm");
  form.onsubmit = async e => {
    e.preventDefault();
    const code = normJoinCode(val("code"));
    busy(form, true);
    try {
      const p = await state.backend.previewProgramme(code);
      busy(form, false);
      if (!p) { setMsg("err", t("join.notFound")); return; }
      preview = Object.assign({ code, uid: state.session && state.session.userId }, p);
      render();
    } catch (err) { busy(form, false); setMsg("err", joinErrorText(err)); }
  };
}
