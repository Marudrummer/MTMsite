(function () {
  if (!window.MTMSupabase) return;

  const supabase = window.MTMSupabase;

  function setAuthCookie(session) {
    if (session && session.access_token) {
      document.cookie = "mtm_access_token=" + session.access_token + "; path=/; samesite=lax";
    } else {
      document.cookie = "mtm_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax";
    }
  }

  function qs(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
  }

  function getNextTarget() {
    const fromQuery = qs("next");
    if (fromQuery) {
      localStorage.setItem("mtm_next", fromQuery);
      return fromQuery;
    }
    const stored = localStorage.getItem("mtm_next");
    return stored || "/";
  }

  function detectProvider(user) {
    const metaProviders = user.app_metadata && user.app_metadata.providers;
    if (Array.isArray(metaProviders) && metaProviders.includes("google")) {
      return "google";
    }
    const metaProvider = (user.app_metadata && user.app_metadata.provider) || "";
    if (metaProvider) {
      return metaProvider === "email" ? "magiclink" : metaProvider;
    }
    if (Array.isArray(user.identities) && user.identities.length) {
      const identityProvider = user.identities[0].provider;
      return identityProvider === "email" ? "magiclink" : identityProvider;
    }
    return "magiclink";
  }

  function normalizeValue(value) {
    const text = String(value || "").trim();
    return text ? text : null;
  }

  async function completeProfile(user, overrides = {}) {
    if (!user) return;
    const provider = detectProvider(user);
    const nameFallback =
      (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) ||
      (user.email ? user.email.split("@")[0] : "");

    const payload = {
      provider,
      name: normalizeValue(overrides.name || nameFallback),
      company: normalizeValue(overrides.company || ""),
      phone: normalizeValue(overrides.phone || "")
    };

    await fetch("/api/profile/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    await fetch("/api/profile/login-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider })
    });
  }

  async function ensureProfile() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData && userData.user;
    if (!user) return;

    await completeProfile(user);

    const onLogin = window.location.pathname === "/login";
    const nextTarget = getNextTarget();
    if (onLogin) {
      localStorage.removeItem("mtm_next");
      window.location.href = nextTarget;
      return;
    }
  }

  async function initAuthState() {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData && sessionData.session;
    setAuthCookie(session);
    window.dispatchEvent(new CustomEvent("mtm-auth", { detail: { session } }));
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    setAuthCookie(session);
    window.dispatchEvent(new CustomEvent("mtm-auth", { detail: { session } }));
    if (session) {
      ensureProfile();
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.querySelector("[data-mtm-login-form]");
    const resendBtn = document.querySelector("[data-mtm-resend]");
    const loginStatus = document.querySelector("[data-mtm-login-status]");
    const googleBtn = document.querySelector("[data-mtm-google]");
    const logoutBtn = document.querySelector("[data-mtm-logout]");
    const profileForm = document.querySelector("[data-mtm-profile-form]");

    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = loginForm.querySelector("input[name='email']").value.trim();
        const name = loginForm.querySelector("input[name='name']").value.trim();
        const company = loginForm.querySelector("input[name='company']").value.trim();
        const phone = loginForm.querySelector("input[name='phone']").value.trim();
        if (!email || !name || !company || !phone) {
          if (loginStatus) loginStatus.textContent = "Preencha todos os campos antes de enviar o link.";
          return;
        }
        const nextTarget = getNextTarget();
        const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(nextTarget)}`;
        const pendingResponse = await fetch("/api/pending-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, company, phone })
        });
        if (!pendingResponse.ok) {
          if (loginStatus) loginStatus.textContent = "Erro ao salvar dados. Tente novamente.";
          return;
        }
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo }
        });
        if (loginStatus) {
          loginStatus.textContent = error
            ? `Erro ao enviar o link: ${error.message || "tente novamente."}`
            : "Link enviado! Verifique seu e-mail (e o spam).";
        }
      });
    }

    if (resendBtn) {
      resendBtn.addEventListener("click", async () => {
        const emailInput = document.querySelector("input[name='email']");
        const email = emailInput ? emailInput.value.trim() : "";
        if (!email) return;
        const nextTarget = getNextTarget();
        const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(nextTarget)}`;
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo }
        });
        if (loginStatus) {
          loginStatus.textContent = error
            ? `Erro ao reenviar: ${error.message || "tente novamente."}`
            : "Link reenviado!";
        }
      });
    }

    if (googleBtn) {
      googleBtn.addEventListener("click", async () => {
        const nextTarget = getNextTarget();
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/login?next=${encodeURIComponent(nextTarget)}`
          }
        });
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      });
    }

    if (profileForm) {
      profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { data: userData } = await supabase.auth.getUser();
        const user = userData && userData.user;
        if (!user) return;

        await completeProfile(user, {
          name: profileForm.querySelector("input[name='name']").value.trim(),
          company: profileForm.querySelector("input[name='company']").value.trim(),
          phone: profileForm.querySelector("input[name='phone']").value.trim()
        });

        const statusEl = document.querySelector("[data-mtm-profile-status]");
        if (statusEl) {
          statusEl.textContent = "Perfil salvo com sucesso.";
        }
        const next = getNextTarget();
        localStorage.removeItem("mtm_next");
        window.location.href = next;
      });
    }

    initAuthState().then(async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData && userData.user;
      if (user) {
        await completeProfile(user);
      }
      ensureProfile();
    });

    let inactivityTimer = null;
    const inactivityLimitMs = 60 * 1000;
    const resetTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.href = "/";
      }, inactivityLimitMs);
    };

    ["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((evt) => {
      window.addEventListener(evt, resetTimer, { passive: true });
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data && data.session) resetTimer();
    });
  });
})();
