(function () {
  if (!window.MTMSupabase) return;
  const supabase = window.MTMSupabase;

  function getCookie(name) {
    const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
    return match ? match[2] : null;
  }

  function updateMenu(session) {
    const loggedIn = Boolean(session);
    document.querySelectorAll("[data-auth-when]").forEach((el) => {
      const when = el.getAttribute("data-auth-when");
      if (when === "logged-in") {
        el.style.display = loggedIn ? "inline-flex" : "none";
      } else if (when === "logged-out") {
        el.style.display = loggedIn ? "none" : "inline-flex";
      }
    });
  }

  async function guardProtectedLinks() {
    const hasCookie = Boolean(getCookie("mtm_access_token"));
    updateMenu(hasCookie ? { access_token: true } : null);

    const { data } = await supabase.auth.getSession();
    const session = data && data.session;
    updateMenu(session);

    document.querySelectorAll("[data-protected-link]").forEach((link) => {
      link.addEventListener("click", (e) => {
        if (!session) {
          e.preventDefault();
          const next = link.getAttribute("href");
          if (next) {
            localStorage.setItem("mtm_next", next);
            if (next.includes("/materiais")) {
              localStorage.setItem("mtm_src", "materiais");
            } else if (next.includes("/nao-sabe") || next.includes("/diagnostico")) {
              localStorage.setItem("mtm_src", "nao-sabe");
            } else {
              localStorage.setItem("mtm_src", "login");
            }
          }
          const encoded = encodeURIComponent(next || "/");
          window.location.href = `/login?next=${encoded}`;
        }
      });
    });
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    updateMenu(session);
  });

  document.addEventListener("DOMContentLoaded", guardProtectedLinks);
})();
