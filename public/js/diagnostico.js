(function () {
  const form = document.querySelector("[data-diagnostico-form]");
  if (!form) return;

  const errorEl = document.querySelector("[data-diagnostico-error]");
  const statusEl = document.querySelector("[data-diagnostico-status]");
  const filesEl = document.querySelector("[data-diagnostico-files]");
  const successCard = document.querySelector("[data-diagnostico-success]");
  const infoCard = document.querySelector("[data-diagnostico-info]");
  const submitBtn = form.querySelector("button[type='submit']");
  const fileInput = document.getElementById("diagnosticoFiles");

  const config = window.MTM_BRIEFING_CONFIG || {};
  const maxFiles = Number(config.maxFiles || 5);
  const maxMb = Number(config.maxMb || 25);
  const maxBytes = maxMb * 1024 * 1024;
  const bucket = config.bucket || "briefings";

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

  const allowedTypes = new Set([
    "application/pdf",
    "text/plain",
    "image/png",
    "image/jpeg",
    "image/webp",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/wav"
  ]);

  let selectedFiles = [];
  let isSending = false;

  function setError(message) {
    if (errorEl) errorEl.textContent = message || "";
  }

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function sanitizeName(name) {
    return String(name || "arquivo")
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .slice(0, 120);
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "";
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(1)}MB`;
  }

  function renderFiles() {
    if (!filesEl) return;
    if (!selectedFiles.length) {
      filesEl.textContent = "Nenhum anexo selecionado.";
      return;
    }
    filesEl.innerHTML = "";
    selectedFiles.forEach((file, index) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "12px";
      row.style.padding = "6px 0";
      const name = document.createElement("span");
      name.textContent = `${file.name} (${formatSize(file.size)})`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn ghost";
      remove.textContent = "Remover";
      remove.addEventListener("click", () => {
        selectedFiles = selectedFiles.filter((_, i) => i !== index);
        renderFiles();
      });
      row.appendChild(name);
      row.appendChild(remove);
      filesEl.appendChild(row);
    });
  }

  function validateFiles() {
    if (selectedFiles.length > maxFiles) return `Selecione no máximo ${maxFiles} arquivos.`;
    for (const file of selectedFiles) {
      if (file.size > maxBytes) return `Arquivo ${file.name} ultrapassa ${maxMb}MB.`;
      if (file.type && !allowedTypes.has(file.type)) return `Tipo não permitido: ${file.name}`;
    }
    return "";
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

  function validate(payload) {
    for (const [field, message] of requiredRules) {
      if (!payload[field]) return message;
    }
    if (!isValidEmail(payload.email)) return "Informe um e-mail válido.";
    return "";
  }

  function buildIdeaSummary(payload) {
    return [
      "Diagnóstico técnico recebido.",
      `Tipo de espaço: ${payload.tipoEspaco}`,
      `Objetivo principal: ${payload.objetivo}`,
      `Conceito: ${payload.conceito || "Não informado"}`,
      `Prazo: ${payload.prazo}`,
      `Orçamento: ${payload.orcamento || "Não informado"}`,
      `Área aproximada (m²): ${payload.areaM2 || "Não informado"}`,
      `Cidade/Estado: ${payload.cidadeEstado}`,
      `Cargo: ${payload.cargo}`
    ].join("\n");
  }

  async function sendAttachment(briefingId, file, index, total) {
    if (!window.MTMSupabase) {
      throw new Error("Supabase não configurado no navegador.");
    }
    setStatus(`Enviando anexos ${index}/${total}...`);
    const randomPart = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    const safeName = sanitizeName(file.name);
    const filename = `${Date.now()}_${randomPart}_${safeName}`;
    const storagePath = `briefings/${briefingId}/${filename}`;

    const uploadResult = await window.MTMSupabase.storage
      .from(bucket)
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false
      });

    if (uploadResult.error) {
      throw new Error(uploadResult.error.message || "Falha ao enviar arquivo.");
    }

    const { data } = window.MTMSupabase.storage.from(bucket).getPublicUrl(storagePath);
    const publicUrl = data && data.publicUrl ? data.publicUrl : "";
    if (!publicUrl) throw new Error("Não foi possível gerar URL pública.");

    const response = await fetch(`/briefings/${briefingId}/attachments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify({
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
        storage_bucket: bucket,
        storage_path: storagePath,
        public_url: publicUrl
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Falha ao registrar anexo.");
    }
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      selectedFiles = Array.from(fileInput.files || []);
      renderFiles();
      const fileError = validateFiles();
      setStatus(fileError, Boolean(fileError));
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSending) return;
    setError("");
    setStatus("");

    const payload = readPayload();
    const validationError = validate(payload);
    if (validationError) {
      setError(validationError);
      return;
    }

    const fileError = validateFiles();
    if (fileError) {
      setStatus(fileError, true);
      return;
    }

    isSending = true;
    submitBtn.disabled = true;
    try {
      setStatus("Enviando diagnóstico...");
      const response = await fetch("/qualificador", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify({
          name: payload.nome,
          email: payload.email,
          phone: payload.whatsapp,
          city: payload.cidadeEstado,
          deal_type: "diagnostico",
          rental_details: payload.prazo,
          event_location: payload.tipoEspaco,
          idea: buildIdeaSummary(payload),
          website: ""
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.briefing_id) {
        throw new Error(data.error || "Não foi possível enviar agora. Tente novamente.");
      }

      if (selectedFiles.length) {
        let index = 0;
        for (const file of selectedFiles) {
          index += 1;
          await sendAttachment(data.briefing_id, file, index, selectedFiles.length);
        }
      }

      setStatus("Recebemos seu diagnóstico. Em breve entraremos em contato.");
      form.reset();
      if (fileInput) fileInput.value = "";
      selectedFiles = [];
      renderFiles();
      form.style.display = "none";
      if (successCard) successCard.style.display = "";
      if (infoCard) infoCard.style.display = "none";
    } catch (err) {
      setStatus(err && err.message ? err.message : "Erro ao enviar. Tente novamente.", true);
      submitBtn.disabled = false;
    } finally {
      isSending = false;
    }
  });

  renderFiles();
})();
