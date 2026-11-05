"use strict";
// The ONLY module that talks to Supabase. local/backend-mock.mjs implements the same
// interface for local dev and e2e — keep the two in sync.

const PAGE = 1000; // PostgREST max rows per request

const RPC = {
  add_evidence: op => ["add_evidence", { p_id: op.payload.id, p_programme: op.programmeId,
    p_indicator: op.payload.indicator, p_text: op.payload.text, p_participant: op.payload.participantId || null }],
  add_entry: op => ["add_entry", { p_id: op.payload.id, p_participant: op.payload.participantId,
    p_indicator: op.payload.indicator, p_evidence: op.payload.evidenceId }],
  remove_entry: op => ["remove_entry", { p_id: op.payload.entryId }],
  hide_evidence: op => ["hide_evidence", { p_id: op.payload.evidenceId }],
};

export function createSupabaseBackend(createClient, url, anonKey, { redirectTo, auth } = {}) {
  if (!url || !anonKey) throw new Error("Supabase is not configured for this environment (app/config.mjs)");
  const sb = createClient(url, anonKey, { auth: Object.assign(
    { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }, auth || {}) });

  function must(res) {
    if (res.error) {
      const e = new Error(res.error.message);
      e.status = res.error.status ?? res.status;
      e.code = res.error.code;
      throw e;
    }
    return res.data;
  }
  // getSession() may fail to refresh an expired token while offline: that is NOT a sign-out.
  async function currentSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) {
      throw Object.assign(new Error(error.message || "auth refresh failed (offline?)"),
        { status: error.status === 401 ? 401 : (error.status || 0), code: error.code });
    }
    return data.session;
  }
  async function uid() {
    const session = await currentSession();
    if (!session) throw Object.assign(new Error("not authenticated"), { status: 401 });
    return session.user.id;
  }
  async function selectAll(build) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = must(await build().range(from, from + PAGE - 1));
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
  const toSession = s => (s ? { userId: s.user.id, email: s.user.email } : null);

  return {
    async session() { return toSession(await currentSession()); },
    onAuth(cb) {
      // Deferred: calling supabase-js methods inside its callback can deadlock.
      const { data } = sb.auth.onAuthStateChange((event, s) => { setTimeout(() => cb(event, toSession(s)), 0); });
      return () => data.subscription.unsubscribe();
    },
    async signInGoogle() { must(await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })); },
    async signInPassword(email, password) { must(await sb.auth.signInWithPassword({ email: email.trim(), password })); },
    async signUp(email, password, displayName, lang) {
      const data = must(await sb.auth.signUp({ email: email.trim(), password,
        options: { emailRedirectTo: redirectTo, data: { display_name: displayName, lang } } }));
      return { confirmationSent: !data.session };
    },
    async sendReset(email) { must(await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo })); },
    async setPassword(password) { must(await sb.auth.updateUser({ password })); },
    // Local scope: clears this device's session without a network call, so it works offline.
    async signOut() { must(await sb.auth.signOut({ scope: "local" })); },

    async getProfile() { return must(await sb.from("profiles").select("*").eq("id", await uid()).single()); },
    async updateProfile(patch) { must(await sb.from("profiles").update(patch).eq("id", await uid())); },

    async myMemberships() {
      return must(await sb.from("memberships")
        .select("role, delegation, joined_at, programme:programmes(id, name, year, archived)")
        .eq("user_id", await uid()).order("joined_at"));
    },
    async allProgrammes() {
      return must(await sb.from("programmes").select("id, name, year, archived, join_code").order("created_at"));
    },
    async listFrameworks() { return must(await sb.from("frameworks").select("key, name").order("key")); },
    async previewProgramme(code) { return must(await sb.rpc("preview_programme", { p_code: code })); },
    async joinProgramme(code, delegation) {
      return must(await sb.rpc("join_programme", { p_code: code, p_delegation: delegation }));
    },

    async loadProgramme(pid) {
      const programme = must(await sb.from("programmes").select("*").eq("id", pid).single());
      const fid = programme.framework_id;
      const [fw, goals, indicators, participants, evidence, entries, memberships] = await Promise.all([
        sb.from("frameworks").select("*").eq("id", fid).single().then(must),
        sb.from("framework_goals").select("code, position, text").eq("framework_id", fid).order("position").then(must),
        sb.from("framework_indicators").select("code, goal_code, position, text").eq("framework_id", fid).order("position").then(must),
        selectAll(() => sb.from("participants").select("*").eq("programme_id", pid).order("code")),
        selectAll(() => sb.from("evidence").select("*").eq("programme_id", pid).order("added_at").order("id")),
        selectAll(() => sb.from("entries").select("*").eq("programme_id", pid).is("removed_at", null)
          .order("added_at").order("id")),
        sb.from("memberships").select("user_id, role, delegation").eq("programme_id", pid).then(must),
      ]);
      const names = memberships.length
        ? must(await sb.from("profiles").select("id, display_name").in("id", memberships.map(m => m.user_id)))
        : [];
      const nameOf = {};
      names.forEach(n => { nameOf[n.id] = n.display_name; });
      return {
        programme,
        framework: Object.assign({}, fw, { goals, indicators }),
        participants, evidence, entries,
        members: memberships.map(m => Object.assign({}, m, { display_name: nameOf[m.user_id] || "" })),
      };
    },

    async write(op) {
      if (!op || !Object.hasOwn(RPC, op.method) || !op.payload) {
        throw new Error("invalid: unknown or malformed op " + (op && op.method));
      }
      const me = await uid();
      // Shared phone: an op queued by another user must never be sent with this session.
      if (op.userId && op.userId !== me) {
        throw Object.assign(new Error("not authenticated: queued by another user"), { status: 401 });
      }
      const [fn, args] = RPC[op.method](op);
      return must(await sb.rpc(fn, args));
    },

    async setMember(pid, userId, role, delegation) {
      must(await sb.rpc("set_member", { p_programme: pid, p_user: userId, p_role: role, p_delegation: delegation || "" }));
    },
    async removeMember(pid, userId) { must(await sb.rpc("remove_member", { p_programme: pid, p_user: userId })); },
    async regenerateJoinCode(pid) { return must(await sb.rpc("regenerate_join_code", { p_programme: pid })); },

    async createProgramme({ frameworkKey, name, year, theme, roster }) {
      return must(await sb.rpc("create_programme", { p_framework_key: frameworkKey, p_name: name,
        p_year: year || "", p_theme: theme || "", p_roster: roster || [] }));
    },
    async addParticipants(pid, roster) { return must(await sb.rpc("add_participants", { p_programme: pid, p_roster: roster })); },
    async setArchived(pid, archived) { must(await sb.rpc("set_archived", { p_programme: pid, p_archived: archived })); },
  };
}
