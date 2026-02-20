(function () {
  const form = document.querySelector("[data-diagnostico-form]");
  if (!form) return;

  const errorEl = document.querySelector("[data-diagnostico-error]");
  const successCard = document.querySelector("[data-diagnostico-success]");
  const infoCard = document.querySelector("[data-diagnostico-info]");
  const submitBtn = form.querySelector("button[type='submit']");

  const requiredRules = [
    ["tipoEspaco", "Selecione o tipo de espaço."],
    ["cidadeEstado", "Informe cidade/estado."],
    ["objetivo", "Selecione o objetivo principal."],
    ["prazo", "Selecione o prazo estimado."],
    ["nome", "Informe seu nome."],
    ["cargo", "Informe seu cargo."],
    ["email", "Informe um e-mail válido."],
    ["whatsapp", "Informe WhatsApp/telefone."]
  ];

  function setError(message) {
    if (errorEl) errorEl.textContent = message || "";
  }

  function readPayload() {
    return {
      tipoEspaco: String(form.elements.tipoEspaco.value || "").trim(),
      cidadeEstado: String(form.elements.cidadeEstado.value || "").trim(),
      areaM2: String(form.elements.areaM2.value || "").trim(),
      objetivo: String(form.elements.objetivo.value || "").trim(),
      conceito: String((form.elements.conceito && form.elements.conceito.value) || "").trim(),
      prazo: String(form.elements.prazo.value || "").trim(),
      orcamento: String((form.elements.orcamento && form.elements.orcamento.value) || "").trim(),
      nome: String(form.elements.nome.value || "").trim(),
      cargo: String(form.elements.cargo.value || "").trim(),
      email: String(form.elements.email.value || "").trim(),
      whatsapp: String(form.elements.whatsapp.value || "").trim()
    };
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function validate(payload) {
    for (const [field, message] of requiredRules) {
      if (!payload[field]) return message;
    }
    if (!isValidEmail(payload.email)) return "Informe um e-mail válido.";
    return "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");
    const payload = readPayload();
    const validationError = validate(payload);
    if (validationError) {
      setError(validationError);
      return;
    }

    submitBtn.disabled = true;
    try {
      const response = await fetch("/api/leads/diagnostico", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Não foi possível enviar agora. Tente novamente.");
      }

      form.style.display = "none";
      if (successCard) successCard.style.display = "";
      if (infoCard) infoCard.style.display = "none";
    } catch (err) {
      setError(err && err.message ? err.message : "Erro ao enviar. Tente novamente.");
      submitBtn.disabled = false;
    }
  });
})();
