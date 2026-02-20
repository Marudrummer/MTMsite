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

  function getAuthBaseUrl() {
    const origin = window.location.origin || "";
    const host = window.location.hostname || "";
    if (host === "mtmsolution.com.br" || host === "www.mtmsolution.com.br") {
      return "https://www.mtmsolution.com.br";
    }
    return origin;
  }

  function normalizeNextTarget(value) {
    const text = String(value || "").trim();
    if (!text.startsWith("/") || text.startsWith("//")) return "/";
    if (text.startsWith("/login")) return "/";
    return text;
  }

  function getNextTarget() {
    const fromQuery = qs("next");
    if (fromQuery) {
      const safe = normalizeNextTarget(fromQuery);
      localStorage.setItem("mtm_next", safe);
      return safe;
    }
    const stored = localStorage.getItem("mtm_next");
    return normalizeNextTarget(stored || "/");
  }

  function getIntentSource() {
    return localStorage.getItem("mtm_src") || "login";
  }

  function detectProvider(user) {
    const metaProvider = (user.app_metadata && user.app_metadata.provider) || "";
    if (metaProvider) {
      return metaProvider === "email" ? "magiclink" : metaProvider;
    }
    const metaProviders = user.app_metadata && user.app_metadata.providers;
    if (Array.isArray(metaProviders) && metaProviders.includes("google")) {
      return "google";
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
  }

  async function ensureProfile() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData && userData.user;
    if (!user) return;

    await completeProfile(user);

    const onLogin = window.location.pathname === "/login";
    if (onLogin) return;
  }

  async function initAuthState() {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData && sessionData.session;
    setAuthCookie(session);
    window.dispatchEvent(new CustomEvent("mtm-auth", { detail: { session } }));
    return session || null;
  }

  async function logLoginOnce(session) {
    if (!session || !session.access_token) return;
    const key = "mtm_login_logged_" + session.access_token.slice(0, 20);
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    const provider = detectProvider(session.user);
    await fetch("/api/profile/login-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider })
    });
  }

  async function handlePostLogin(session) {
    const nextTarget = getNextTarget();
    const src = getIntentSource();
    try {
      const resp = await fetch("/auth/need-lead", {
        headers: { Accept: "application/json" }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.needLead) {
          window.location.href = `/lead-rapido?next=${encodeURIComponent(nextTarget)}&src=${encodeURIComponent(src)}`;
          return;
        }
      } else {
        console.warn("auth/need-lead response not ok:", resp.status);
      }
    } catch (error) {
      console.warn("auth/need-lead failed, seguindo com redirect:", error && error.message ? error.message : error);
    }
    localStorage.removeItem("mtm_next");
    localStorage.removeItem("mtm_src");
    window.location.href = nextTarget;
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    setAuthCookie(session);
    window.dispatchEvent(new CustomEvent("mtm-auth", { detail: { session } }));
    if (session) {
      await ensureProfile();
      if (event === "SIGNED_IN") {
        await logLoginOnce(session);
        await handlePostLogin(session);
      }
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
        if (!email) {
          if (loginStatus) loginStatus.textContent = "Informe um e-mail válido.";
          return;
        }
        const nextTarget = getNextTarget();
        const redirectTo = `${getAuthBaseUrl()}/login?next=${encodeURIComponent(nextTarget)}`;
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
        const redirectTo = `${getAuthBaseUrl()}/login?next=${encodeURIComponent(nextTarget)}`;
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
            redirectTo: `${getAuthBaseUrl()}/login?next=${encodeURIComponent(nextTarget)}`
          }
        });
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async (e) => {
        if (e && typeof e.preventDefault === "function") e.preventDefault();
        localStorage.setItem("mtm_force_logout", "1");
        try {
          await supabase.auth.signOut({ scope: "global" });
        } catch (e) {
          // best-effort
        }
        document.cookie = "mtm_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax";
        localStorage.removeItem("mtm_next");
        localStorage.removeItem("mtm_src");
        window.location.replace("/");
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

    let handledLoginRedirect = false;
    initAuthState().then(async (session) => {
      if (session && window.location.pathname === "/login" && !handledLoginRedirect) {
        handledLoginRedirect = true;
        await handlePostLogin(session);
        return;
      }
      if (localStorage.getItem("mtm_force_logout")) {
        try {
          await supabase.auth.signOut({ scope: "global" });
        } catch (e) {
          // best-effort
        }
        document.cookie = "mtm_access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax";
        localStorage.removeItem("mtm_force_logout");
        localStorage.removeItem("mtm_next");
        localStorage.removeItem("mtm_src");
        window.location.href = "/";
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      const user = userData && userData.user;
      if (user) {
        await completeProfile(user);
      }
      ensureProfile();
    });

    const path = window.location.pathname || "/";
    const disableInactivityLogout =
      path === "/" ||
      path.startsWith("/blog") ||
      path.startsWith("/lab") ||
      path === "/sobre" ||
      path === "/servicos" ||
      path === "/contato" ||
      path === "/diagnostico";

    if (!disableInactivityLogout) {
      let inactivityTimer = null;
      const inactivityLimitMs = 3 * 60 * 1000;
      const resetTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(async () => {
          await supabase.auth.signOut();
          window.location.href = "/";
        }, inactivityLimitMs);
      };

      ["mousemove", "pointermove", "touchstart", "scroll"].forEach((evt) => {
        window.addEventListener(evt, resetTimer, { passive: true });
      });

      // If the page uses native media elements, treat playback as activity.
      const mediaActivityEvents = ["play", "playing", "timeupdate", "seeking", "seeked"];
      document.querySelectorAll("video, audio").forEach((el) => {
        mediaActivityEvents.forEach((evt) => {
          el.addEventListener(evt, resetTimer, { passive: true });
        });
      });

      supabase.auth.getSession().then(({ data }) => {
        if (data && data.session) resetTimer();
      });
    }
  });
})();
