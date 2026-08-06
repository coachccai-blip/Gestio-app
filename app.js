/* Gestio — gestionnaire de mots de passe local, chiffré (AES-256-GCM + PBKDF2).
   Aucune dépendance. Rien ne quitte l'appareil. */

(() => {
  "use strict";

  const STORAGE_KEY = "gestio.vault";
  const PBKDF2_ITERATIONS = 300000;
  const AUTO_LOCK_MS = 5 * 60 * 1000; // verrouillage auto après 5 min d'inactivité

  // État en mémoire uniquement (effacé au verrouillage)
  let cryptoKey = null;   // CryptoKey dérivée du mot de passe maître
  let saltBytes = null;   // sel courant (Uint8Array)
  let vault = null;       // { notes: [...] }
  let autoLockTimer = null;
  let selectedColor = ""; // couleur choisie pour la note en cours ("" = automatique)

  // ---------- Utilitaires encodage ----------
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

  // ---------- Crypto ----------
  async function deriveKey(password, salt) {
    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptVault(key, salt, dataObj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = enc.encode(JSON.stringify(dataObj));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return {
      v: 1,
      alg: "AES-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      salt: b64(salt),
      iv: b64(iv),
      ct: b64(ct),
    };
  }

  async function decryptBlob(key, blob) {
    const iv = unb64(blob.iv);
    const ct = unb64(blob.ct);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(dec.decode(plain));
  }

  // ---------- Persistance ----------
  function loadBlob() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  async function saveVault() {
    const blob = await encryptVault(cryptoKey, saltBytes, vault);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  }

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove("hidden");
  const hide = (el) => el.classList.add("hidden");

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    show(t);
    clearTimeout(toast._t);
    toast._t = setTimeout(() => hide(t), 1900);
  }

  function screen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(name).classList.add("active");
  }

  // ---------- Verrouillage ----------
  function resetAutoLock() {
    clearTimeout(autoLockTimer);
    if (cryptoKey) autoLockTimer = setTimeout(lock, AUTO_LOCK_MS);
  }
  function lock() {
    cryptoKey = null;
    vault = null;
    saltBytes = null;
    clearTimeout(autoLockTimer);
    $("unlock-pass").value = "";
    closeEditor();
    hide($("sync-backdrop"));
    showLockScreen();
  }

  function showLockScreen() {
    screen("lock-screen");
    const blob = loadBlob();
    if (blob) {
      show($("unlock-form")); hide($("create-form"));
      $("unlock-pass").focus();
    } else {
      show($("create-form")); hide($("unlock-form"));
    }
  }

  // ---------- Rendu des notes ----------
  const AVATAR_COLORS = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#8b5cf6","#14b8a6"];
  function avatarColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function renderNotes(filter = "") {
    const list = $("notes-list");
    list.innerHTML = "";
    const q = filter.trim().toLowerCase();
    const items = vault.notes
      .filter((n) => {
        if (!q) return true;
        return [n.title, n.username, n.url, n.note, n.tag]
          .filter(Boolean).join(" ").toLowerCase().includes(q);
      })
      .sort((a, b) => (a.title || "").localeCompare(b.title || "", "fr", { sensitivity: "base", numeric: true }));

    if (vault.notes.length === 0) {
      show($("empty-state"));
      $("empty-state").innerHTML =
        "Aucune note pour l'instant.<br />Clique sur <strong>+ Nouvelle</strong> pour en créer une.";
    } else if (items.length === 0) {
      show($("empty-state"));
      $("empty-state").innerHTML = "Aucun résultat pour cette recherche.";
    } else {
      hide($("empty-state"));
    }

    for (const n of items) {
      const card = document.createElement("div");
      card.className = "note-card";
      const color = n.color || avatarColor(n.title || n.id);
      card.style.boxShadow = `inset 5px 0 0 ${color}`;
      const initial = (n.title || "?").trim().charAt(0).toUpperCase();
      card.innerHTML = `
        <div class="note-avatar" style="background:${color}">${initial}</div>
        <div class="note-main">
          <div class="note-title"></div>
          <div class="note-sub"></div>
          <div class="note-badges"></div>
          <div class="note-contract"></div>
        </div>
        <div class="note-quick">
          <button class="mini-btn" data-act="copy-user" title="Copier l'identifiant">👤</button>
          <button class="mini-btn" data-act="copy-pass" title="Copier le mot de passe">🔑</button>
        </div>`;
      card.querySelector(".note-title").textContent = n.title || "(sans titre)";
      card.querySelector(".note-sub").textContent = n.username || n.url || "—";
      const tag = n.tag || "Compte";
      const badges = card.querySelector(".note-badges");
      const tagChip = document.createElement("span");
      tagChip.className = "chip";
      const col = tagColor(tag);
      tagChip.style.color = col;
      tagChip.style.background = hexToRgba(col, 0.15);
      tagChip.style.border = "1px solid " + hexToRgba(col, 0.4);
      tagChip.textContent = tag;
      badges.appendChild(tagChip);
      if (tag === "Abonnement" && n.price) {
        const priceChip = document.createElement("span");
        priceChip.className = "chip chip-price";
        priceChip.textContent = formatPrice(n.price, n.pricePeriod);
        badges.appendChild(priceChip);
      }
      const contractEl = card.querySelector(".note-contract");
      if (tag === "Abonnement" && (n.startDate || n.endDate)) {
        contractEl.textContent = "📅 " + contractLabel(n.startDate, n.endDate);
      } else {
        contractEl.remove();
      }
      card.addEventListener("click", (e) => {
        const act = e.target.getAttribute("data-act");
        if (act === "copy-user") { e.stopPropagation(); copy(n.username, "Identifiant copié"); }
        else if (act === "copy-pass") { e.stopPropagation(); copy(n.password, "Mot de passe copié"); }
        else openEditor(n.id);
      });
      list.appendChild(card);
    }
    renderSubsTotal();
  }

  async function copy(text, msg) {
    if (!text) { toast("Rien à copier"); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast(msg || "Copié");
    } catch {
      // repli si l'API clipboard est bloquée
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
      toast(msg || "Copié");
    }
  }

  // ---------- Palette de couleurs des notes ----------
  const PALETTE = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#8b5cf6","#14b8a6"];

  function renderSwatches() {
    const box = $("note-swatches");
    box.innerHTML = "";
    // option "automatique" (couleur déduite du titre)
    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = "swatch swatch-auto" + (selectedColor === "" ? " selected" : "");
    auto.title = "Automatique";
    auto.textContent = "A";
    auto.addEventListener("click", () => { selectedColor = ""; renderSwatches(); });
    box.appendChild(auto);
    for (const c of PALETTE) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (selectedColor === c ? " selected" : "");
      b.style.background = c;
      b.addEventListener("click", () => { selectedColor = c; renderSwatches(); });
      box.appendChild(b);
    }
  }

  // ---------- Tags / prix ----------
  const TAGS = [
    { name: "Compte",         color: "#6366f1" },
    { name: "Abonnement",     color: "#f59e0b" },
    { name: "Carte bancaire", color: "#ef4444" },
    { name: "Wifi",           color: "#0ea5e9" },
    { name: "E-mail",         color: "#10b981" },
    { name: "Note sécurisée", color: "#8b5cf6" },
  ];

  function populateTags() {
    const sel = $("note-tag");
    sel.innerHTML = "";
    for (const t of TAGS) {
      const opt = document.createElement("option");
      opt.value = t.name;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }
  }
  function tagColor(name) {
    const t = TAGS.find((x) => x.name === name);
    return t ? t.color : "#64748b";
  }
  function hexToRgba(hex, a) {
    const m = hex.replace("#", "");
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function updatePriceField() {
    const isSub = $("note-tag").value === "Abonnement";
    if (isSub) { show($("price-field")); show($("sub-dates-field")); }
    else { hide($("price-field")); hide($("sub-dates-field")); }
  }

  // "2026-01-15" -> "15/01/2026"
  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("-");
    return (y && m && d) ? `${d}/${m}/${y}` : String(iso);
  }
  // Libellé de la période de contrat d'un abonnement
  function contractLabel(start, end) {
    const s = formatDate(start), e = formatDate(end);
    if (s && e) return `${s} → ${e}`;
    if (s) return `Depuis le ${s}`;
    if (e) return `Jusqu'au ${e}`;
    return "";
  }

  // "13,49" ou "13.49 €" -> 13.49 (NaN si vide/illisible)
  function parsePrice(str) {
    if (!str) return NaN;
    const n = parseFloat(String(str).replace(/[^0-9,.-]/g, "").replace(",", "."));
    return isNaN(n) ? NaN : n;
  }
  function formatPrice(price, period) {
    const p = String(price).trim();
    const base = /€/.test(p) ? p : p + " €";
    return base + (period === "year" ? "/an" : "/mois");
  }

  // Somme annuelle de tous les abonnements (mensuels x12)
  function annualTotal() {
    let sum = 0, count = 0;
    for (const n of vault.notes) {
      if (n.tag !== "Abonnement" || !n.price) continue;
      const v = parsePrice(n.price);
      if (isNaN(v)) continue;
      sum += n.pricePeriod === "year" ? v : v * 12;
      count++;
    }
    return { sum, count };
  }
  function renderSubsTotal() {
    const { sum, count } = annualTotal();
    const el = $("subs-total");
    if (count > 0) {
      let fmt;
      try {
        fmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(sum);
      } catch { fmt = sum.toFixed(2).replace(".", ",") + " €"; }
      el.innerHTML = "";
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = `💳 ${count} abonnement${count > 1 ? "s" : ""} · ${fmt} / an`;
      el.appendChild(pill);
      show(el);
    } else {
      hide(el);
    }
  }

  // ---------- Éditeur de note ----------
  function openEditor(id) {
    const isNew = !id;
    const note = isNew ? null : vault.notes.find((n) => n.id === id);
    $("editor-title").textContent = isNew ? "Nouvelle note" : "Modifier la note";
    $("note-id").value = isNew ? "" : note.id;
    $("note-title").value = isNew ? "" : (note.title || "");
    $("note-tag").value = isNew ? "Compte" : (note.tag || "Compte");
    $("note-price").value = isNew ? "" : (note.price || "");
    $("note-price-period").value = isNew ? "month" : (note.pricePeriod || "month");
    $("note-start").value = isNew ? "" : (note.startDate || "");
    $("note-end").value = isNew ? "" : (note.endDate || "");
    updatePriceField();
    $("note-username").value = isNew ? "" : (note.username || "");
    $("note-password").value = isNew ? "" : (note.password || "");
    $("note-url").value = isNew ? "" : (note.url || "");
    $("note-note").value = isNew ? "" : (note.note || "");
    $("note-password").type = "password";
    selectedColor = isNew ? "" : (note.color || "");
    renderSwatches();
    $("btn-delete").style.visibility = isNew ? "hidden" : "visible";
    show($("editor-backdrop"));
    $("note-title").focus();
  }
  function closeEditor() { hide($("editor-backdrop")); }

  async function saveNote(e) {
    e.preventDefault();
    const id = $("note-id").value;
    const now = Date.now();
    const tag = $("note-tag").value;
    const price = $("note-price").value.trim();
    if (tag === "Abonnement" && !price) {
      toast("Renseigne le prix de l'abonnement");
      $("note-price").focus();
      return;
    }
    const data = {
      title: $("note-title").value.trim(),
      tag: tag,
      price: tag === "Abonnement" ? price : "",
      pricePeriod: tag === "Abonnement" ? $("note-price-period").value : "",
      startDate: tag === "Abonnement" ? $("note-start").value : "",
      endDate: tag === "Abonnement" ? $("note-end").value : "",
      username: $("note-username").value.trim(),
      password: $("note-password").value,
      url: $("note-url").value.trim(),
      note: $("note-note").value.trim(),
      color: selectedColor,
      updatedAt: now,
    };
    if (id) {
      const n = vault.notes.find((x) => x.id === id);
      Object.assign(n, data);
    } else {
      vault.notes.push({ id: uid(), createdAt: now, ...data });
    }
    await saveVault();
    closeEditor();
    renderNotes($("search").value);
    toast("Enregistré");
  }

  async function deleteNote() {
    const id = $("note-id").value;
    if (!id) return;
    if (!confirm("Supprimer définitivement cette note ?")) return;
    vault.notes = vault.notes.filter((n) => n.id !== id);
    await saveVault();
    closeEditor();
    renderNotes($("search").value);
    toast("Note supprimée");
  }

  function uid() {
    return (crypto.randomUUID
      ? crypto.randomUUID()
      : "id-" + b64(crypto.getRandomValues(new Uint8Array(9))).replace(/[^a-z0-9]/gi, ""));
  }

  // ---------- Force du mot de passe maître ----------
  function scoreStrength(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^a-zA-Z0-9]/.test(pw)) s++;
    return Math.min(s, 4);
  }
  function updateStrengthBar() {
    const pw = $("create-pass").value;
    const s = scoreStrength(pw);
    const bar = $("create-strength-bar");
    const pct = [8, 30, 55, 80, 100][s];
    const col = ["#ef4444", "#ef4444", "#f59e0b", "#22c55e", "#22c55e"][s];
    bar.style.width = pw ? pct + "%" : "0";
    bar.style.background = col;
  }

  // ---------- Synchronisation : export / import ----------
  async function exportVault() {
    const blob = await encryptVault(cryptoKey, saltBytes, vault);
    const payload = { app: "Gestio", type: "vault-backup", exportedAt: Date.now(), ...blob };
    const str = JSON.stringify(payload, null, 2);
    const file = new Blob([str], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
    a.href = url;
    a.download = `gestio-coffre-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("Coffre exporté");
  }

  let importedBlob = null;
  function onImportFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.ct || !parsed.iv || !parsed.salt) throw new Error("format");
        importedBlob = parsed;
        $("import-filename").textContent = "Fichier : " + f.name;
        $("import-error").textContent = "";
        show($("import-panel"));
      } catch {
        importedBlob = null;
        hide($("import-panel"));
        $("import-error").textContent = "Fichier invalide ou illisible.";
      }
    };
    reader.readAsText(f);
  }

  async function doImport() {
    if (!importedBlob) return;
    const pass = $("import-pass").value;
    const errEl = $("import-error");
    errEl.textContent = "";
    if (!pass) { errEl.textContent = "Entre le mot de passe maître du fichier."; return; }
    let importedVault;
    try {
      const salt = unb64(importedBlob.salt);
      const key = await deriveKey(pass, salt);
      importedVault = await decryptBlob(key, importedBlob);
      if (!importedVault || !Array.isArray(importedVault.notes)) throw new Error("bad");
    } catch {
      errEl.textContent = "Mot de passe incorrect ou fichier corrompu.";
      return;
    }
    const mode = document.querySelector('input[name="import-mode"]:checked').value;
    let added = 0, updated = 0;
    if (mode === "replace") {
      vault.notes = importedVault.notes;
      toast(`${vault.notes.length} note(s) importée(s)`);
    } else {
      const byId = new Map(vault.notes.map((n) => [n.id, n]));
      for (const inc of importedVault.notes) {
        const cur = byId.get(inc.id);
        if (!cur) { vault.notes.push(inc); byId.set(inc.id, inc); added++; }
        else if ((inc.updatedAt || 0) > (cur.updatedAt || 0)) { Object.assign(cur, inc); updated++; }
      }
      toast(`Fusion : ${added} ajout(s), ${updated} mise(s) à jour`);
    }
    await saveVault();
    renderNotes($("search").value);
    hide($("sync-backdrop"));
    // reset
    importedBlob = null;
    $("import-pass").value = "";
    hide($("import-panel"));
    $("import-file").value = "";
  }

  // ---------- Auth ----------
  async function createVault(e) {
    e.preventDefault();
    const p1 = $("create-pass").value;
    const p2 = $("create-pass2").value;
    const err = $("create-error");
    err.textContent = "";
    if (p1.length < 6) { err.textContent = "Au moins 6 caractères."; return; }
    if (p1 !== p2) { err.textContent = "Les deux mots de passe ne correspondent pas."; return; }
    saltBytes = crypto.getRandomValues(new Uint8Array(16));
    cryptoKey = await deriveKey(p1, saltBytes);
    vault = { notes: [] };
    await saveVault();
    $("create-pass").value = ""; $("create-pass2").value = "";
    enterApp();
    toast("Coffre créé 🎉");
  }

  async function unlockVault(e) {
    e.preventDefault();
    const pass = $("unlock-pass").value;
    const err = $("unlock-error");
    err.textContent = "";
    const blob = loadBlob();
    if (!blob) { showLockScreen(); return; }
    try {
      const salt = unb64(blob.salt);
      const key = await deriveKey(pass, salt);
      const data = await decryptBlob(key, blob);
      if (!data || !Array.isArray(data.notes)) throw new Error("bad");
      cryptoKey = key;
      saltBytes = salt;
      vault = data;
      $("unlock-pass").value = "";
      enterApp();
    } catch {
      err.textContent = "Mot de passe incorrect.";
    }
  }

  function enterApp() {
    screen("app-screen");
    $("search").value = "";
    renderNotes();
    resetAutoLock();
  }

  // ---------- Câblage des événements ----------
  function wire() {
    populateTags();
    // Lock screen
    $("create-form").addEventListener("submit", createVault);
    $("unlock-form").addEventListener("submit", unlockVault);
    $("create-pass").addEventListener("input", updateStrengthBar);
    $("goto-import").addEventListener("click", () => { enterAppForImportFromLock(); });
    $("unlock-import").addEventListener("click", () => { enterAppForImportFromLock(); });

    // Topbar
    $("btn-lock").addEventListener("click", lock);
    $("btn-sync").addEventListener("click", () => show($("sync-backdrop")));
    $("btn-add").addEventListener("click", () => openEditor(null));
    $("search").addEventListener("input", (e) => renderNotes(e.target.value));

    // Editor
    $("editor-form").addEventListener("submit", saveNote);
    $("editor-close").addEventListener("click", closeEditor);
    $("btn-cancel").addEventListener("click", closeEditor);
    $("btn-delete").addEventListener("click", deleteNote);
    $("note-tag").addEventListener("change", updatePriceField);
    document.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", () => copy($(btn.getAttribute("data-copy")).value, "Copié"));
    });
    document.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const inp = $(btn.getAttribute("data-toggle"));
        inp.type = inp.type === "password" ? "text" : "password";
      });
    });

    // Sync modal
    $("sync-close").addEventListener("click", () => hide($("sync-backdrop")));
    $("btn-export").addEventListener("click", exportVault);
    $("btn-import-pick").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", onImportFile);
    $("btn-import-do").addEventListener("click", doImport);

    // Fermer les modales en cliquant sur le fond
    document.querySelectorAll(".backdrop").forEach((bd) => {
      bd.addEventListener("click", (e) => { if (e.target === bd) hide(bd); });
    });

    // Auto-lock : activité utilisateur
    ["click","keydown","mousemove","touchstart"].forEach((ev) =>
      document.addEventListener(ev, resetAutoLock, { passive: true }));

    // Verrouiller quand l'onglet passe en arrière-plan longtemps
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && cryptoKey) resetAutoLock();
    });
  }

  // Depuis l'écran de verrouillage, l'import ouvre directement la fenêtre de synchro,
  // mais il faut d'abord être déverrouillé. On guide l'utilisateur.
  function enterAppForImportFromLock() {
    const blob = loadBlob();
    if (blob) {
      toast("Déverrouille d'abord ton coffre, puis ⇅ pour importer");
      $("unlock-pass").focus();
    } else {
      toast("Crée d'abord un coffre, puis ⇅ pour importer");
      $("create-pass").focus();
    }
  }

  // ---------- Service worker (offline) ----------
  function registerSW() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  // ---------- Démarrage ----------
  wire();
  registerSW();
  showLockScreen();
})();
