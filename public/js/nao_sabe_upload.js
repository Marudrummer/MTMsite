(function () {
  const form = document.querySelector("[data-briefing-form]");
  if (!form) return;

  const fileInput = document.getElementById("briefingFiles");
  const filesList = form.querySelector("[data-briefing-files]");
  const statusEl = form.querySelector("[data-briefing-status]");
  const submitBtn = form.querySelector("button[type='submit']");

  const config = window.MTM_BRIEFING_CONFIG || {};
  const maxFiles = Number(config.maxFiles || 5);
  const maxMb = Number(config.maxMb || 25);
  const maxBytes = maxMb * 1024 * 1024;
  const bucket = config.bucket || "briefings";

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

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "";
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(1)}MB`;
  }

  function sanitizeName(name) {
    return String(name || "arquivo")
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .slice(0, 120);
  }

  function renderFiles() {
    if (!filesList) return;
    if (!selectedFiles.length) {
      filesList.textContent = "Nenhum anexo selecionado.";
      return;
    }
    filesList.innerHTML = "";
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
      remove.dataset.index = String(index);
      remove.addEventListener("click", () => {
        selectedFiles = selectedFiles.filter((_, i) => i !== index);
        renderFiles();
      });
      row.appendChild(name);
      row.appendChild(remove);
      filesList.appendChild(row);
    });
  }

  function validateFiles() {
    if (selectedFiles.length > maxFiles) {
      setStatus(`Selecione no máximo ${maxFiles} arquivos.`, true);
      return false;
    }
    for (const file of selectedFiles) {
      if (file.size > maxBytes) {
        setStatus(`Arquivo ${file.name} ultrapassa ${maxMb}MB.`, true);
        return false;
      }
      if (file.type && !allowedTypes.has(file.type)) {
        setStatus(`Tipo não permitido: ${file.name}`, true);
        return false;
      }
    }
    setStatus("");
    return true;
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      selectedFiles = Array.from(fileInput.files || []);
      renderFiles();
      validateFiles();
    });
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
    if (!publicUrl) {
      throw new Error("Não foi possível gerar URL pública.");
    }

    const response = await fetch(`/briefings/${briefingId}/attachments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
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

  form.addEventListener("submit", async (event) => {
    if (isSending) return;
    if (!form.reportValidity()) return;
    if (!validateFiles()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    isSending = true;
    submitBtn.disabled = true;
    setStatus("Enviando briefing...");

    const payload = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      phone: form.elements.phone.value.trim(),
      city: form.elements.city.value.trim(),
      deal_type: form.elements.deal_type.value,
      rental_details: form.elements.rental_details.value.trim(),
      event_location: form.elements.event_location.value.trim(),
      website: form.elements.website.value.trim(),
      idea: form.elements.idea.value.trim()
    };

    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Falha ao enviar briefing.");
      }

      const data = await response.json();
      if (!data || !data.ok || !data.briefing_id) {
        throw new Error("Resposta inválida do servidor.");
      }

      if (selectedFiles.length) {
        let index = 0;
        for (const file of selectedFiles) {
          index += 1;
          await sendAttachment(data.briefing_id, file, index, selectedFiles.length);
        }
      }

      setStatus("Recebemos sua solicitação. Em breve entraremos em contato.");
      form.reset();
      if (fileInput) {
        fileInput.value = "";
      }
      selectedFiles = [];
      renderFiles();
    } catch (err) {
      setStatus(err && err.message ? err.message : "Erro ao enviar. Tente novamente.", true);
    } finally {
      submitBtn.disabled = false;
      isSending = false;
    }
  });

  renderFiles();
})();
