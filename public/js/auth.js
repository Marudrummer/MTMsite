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

  async function ensureProfile() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData && userData.user;
    if (!user) return;

    const onLogin = window.location.pathname === "/login";
    const nextTarget = getNextTarget();
    if (onLogin) {
      const displayName =
        (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) ||
        (user.user_metadata && user.user_metadata.display_name) ||
        user.email ||
        "";
      if (displayName) {
        alert(`${displayName}, seja bem-vindo!`);
      }
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

    const nextFallback = "/";
    const pendingKey = "mtm_pending_profile";

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
        localStorage.setItem(
          pendingKey,
          JSON.stringify({ email, name, company, phone, updated_at: new Date().toISOString() })
        );
        const nextTarget = getNextTarget();
        const redirectTo = `${window.location.origin}/login?next=${encodeURIComponent(nextTarget)}`;
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
      const pendingRaw = localStorage.getItem(pendingKey);
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw);
          if (pending) {
            const nameInput = profileForm.querySelector("input[name='name']");
            const companyInput = profileForm.querySelector("input[name='company']");
            const phoneInput = profileForm.querySelector("input[name='phone']");
            if (nameInput && !nameInput.value) nameInput.value = pending.name || "";
            if (companyInput && !companyInput.value) companyInput.value = pending.company || "";
            if (phoneInput && !phoneInput.value) phoneInput.value = pending.phone || "";
          }
        } catch (err) {
          localStorage.removeItem(pendingKey);
        }
      }
      profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { data: userData } = await supabase.auth.getUser();
        const user = userData && userData.user;
        if (!user) return;

        const payload = {
          id: user.id,
          email: user.email,
          name: profileForm.querySelector("input[name='name']").value.trim(),
          company: profileForm.querySelector("input[name='company']").value.trim(),
          phone: profileForm.querySelector("input[name='phone']").value.trim(),
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
        const statusEl = document.querySelector("[data-mtm-profile-status]");
        if (statusEl) {
          statusEl.textContent = error
            ? "Erro ao salvar. Verifique os dados."
            : "Perfil salvo com sucesso.";
        }
        if (!error) {
          localStorage.removeItem(pendingKey);
          const next = getNextTarget();
          localStorage.removeItem("mtm_next");
          window.location.href = next;
        }
      });
    }

    initAuthState().then(async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData && userData.user;
      if (user) {
        const pendingRaw = localStorage.getItem(pendingKey);
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw);
            if (pending && pending.email && pending.email === user.email) {
              await supabase.from("profiles").upsert(
                {
                  id: user.id,
                  email: user.email,
                  name: pending.name,
                  company: pending.company,
                  phone: pending.phone,
                  updated_at: pending.updated_at || new Date().toISOString()
                },
                { onConflict: "id" }
              );
              localStorage.removeItem(pendingKey);
            }
          } catch (err) {
            localStorage.removeItem(pendingKey);
          }
        }
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
