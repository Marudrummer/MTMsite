(function () {
  if (!window.MTMSupabase) return;
  const supabase = window.MTMSupabase;

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
