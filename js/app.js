(function () {
  "use strict";

  /* ═════════ utilities ═════════ */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const PALETTE = ["#FF6F91", "#FF9FB5", "#FFC7D6", "#FFD86B", "#FFE8A3", "#B9A7E8", "#E9DFFF", "#A8DCC8"];

  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3000);
  }

  /* ═════════ assets (the one-file build swaps paths for data URIs) ═════════ */
  const TABLE = window.BS_ASSETS || {};
  const built = !!window.BS_ASSETS;
  const asset = (p) => (p && TABLE[p]) || p;
  $$("[data-asset]").forEach((img) => { img.src = asset(img.dataset.asset); });

  // a missing picture hides itself instead of showing a broken icon
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG") t.classList.add("img-missing");
  }, true);

  /* ═════════ data: config → preset (downloaded card) → share link → this device ═════════ */
  const LS_KEY = "birthday-surprise:v1";
  const normPhotos = (list) => (list || []).map((p) => (typeof p === "string" ? { src: p, caption: "" } : { src: p.src || "", caption: p.caption || "" }));
  const defaults = clone(birthdayConfig);
  defaults.photos = normPhotos(defaults.photos);

  let preset = {};
  if (window.__BS_PRESET__) preset = window.__BS_PRESET__;
  else try { preset = JSON.parse($("#bs-preset").textContent || "{}"); } catch (e) {}
  let hashData = null;
  const hm = location.hash.match(/#d=([\w-]+)/);
  if (hm) { try { hashData = JSON.parse(decodeURIComponent(escape(atob(hm[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) {} }
  // served by server/server.mjs? then the server says who we are: demo, the owner, or a visitor
  const srv = preset.server || null;
  delete preset.server;
  const mode = srv ? srv.mode : "local";
  const owner = mode === "owner";
  const wantsEdit = /#edit\b/.test(location.hash) || (owner && /[?&]edit=1/.test(location.search));
  const sent = !!((preset && preset.sent) || (hashData && hashData.sent));
  const viewer = mode === "visitor" || (mode === "local" && sent && !wantsEdit);
  if (viewer) document.documentElement.classList.add("viewer");
  if (srv) document.documentElement.classList.add("srv-" + mode);

  function merge(base, over) {
    const out = clone(base);
    if (!over) return out;
    Object.keys(over).forEach((k) => {
      if (k === "photos" && Array.isArray(over.photos)) {
        out.photos = over.photos.map((p, i) => ({
          src: p.src != null ? p.src : ((base.photos[i] || {}).src || ""),
          caption: p.caption != null ? p.caption : ((base.photos[i] || {}).caption || "")
        }));
      } else out[k] = over[k];
    });
    return out;
  }

  let stored = null;
  if (!window.__BS_HOSTED__) {
    try { stored = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) {}
  }
  let data;
  if (srv) data = merge(defaults, preset);
  else {
    data = sent ? merge(merge(defaults, preset), hashData) : merge(defaults, stored);
    if (sent && wantsEdit && stored) data = merge(data, stored);
  }
  delete data.sent;

  /* IndexedDB keeps photos + an uploaded song (too big for localStorage) */
  const idb = (() => {
    let dbp;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      const rq = indexedDB.open("birthday-surprise", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    }));
    const tx = (mode, fn) => open().then((db) => new Promise((res, rej) => {
      const t = db.transaction("kv", mode); const r = fn(t.objectStore("kv"));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    }));
    return {
      get: (k) => tx("readonly", (s) => s.get(k)).catch(() => null),
      set: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => null),
      del: (k) => tx("readwrite", (s) => s.delete(k)).catch(() => null),
      clear: () => tx("readwrite", (s) => s.clear()).catch(() => null)
    };
  })();
  let songBlob = null, songUrl = "";

  async function loadLocalMedia() {
    if (viewer || srv) return;
    const photos = (await idb.get("photos")) || {};
    data.photos.forEach((p, i) => { if (photos[i]) p.src = photos[i]; });
    const song = await idb.get("song");
    if (song && song.blob) { songBlob = song.blob; data.musicFileName = song.name; }
  }
  const isData = (s) => /^data:/.test(s || "");
  const persistPhotos = () => {
    const out = {};
    data.photos.forEach((p, i) => { if (isData(p.src)) out[i] = p.src; });
    return idb.set("photos", out);
  };

  function save() {
    if (window.__BS_HOSTED__) return true;
    if (owner) return Remote.saveNow();
    if (mode !== "local") return true;
    const d = clone(data);
    d.photos = d.photos.map((p) => ({ src: isData(p.src) ? "" : p.src, caption: p.caption }));
    delete d.musicData;
    try { localStorage.setItem(LS_KEY, JSON.stringify(d)); return true; }
    catch (e) { toast("This browser is out of space — try fewer photos."); return false; }
  }
  async function resetAll() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    await idb.clear();
    location.hash = ""; location.reload();
  }
  /* ═════════ the server (only when this page came from server/server.mjs) ═════════ */
  const Remote = (() => {
    const slug = srv && srv.slug;
    let t = 0;
    async function req(method, url, body, headers = {}) {
      const r = await fetch(url, { method, body, credentials: "same-origin", headers: { "X-Requested-With": "bs", ...headers } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Something went wrong — please try again.");
      return j;
    }
    const status = (msg) => { const el = $("#edStatus"); if (el) el.textContent = msg; };
    const payload = () => ({
      birthdayName: data.birthdayName, birthdayDate: data.birthdayDate, senderName: data.senderName,
      memoryMessage: data.memoryMessage, personalMessage: data.personalMessage,
      photos: data.photos.map((p) => ({ src: p.src, caption: p.caption })),
      music: data.music || defaults.music, musicFileName: data.musicFileName || ""
    });
    async function saveNow() {
      clearTimeout(t);
      status("Saving…");
      try { await req("PUT", `/api/cards/${slug}`, JSON.stringify(payload()), { "Content-Type": "application/json" }); status("Saved ✓"); return true; }
      catch (e) { status("Not saved"); toast(e.message); return false; }
    }
    function saveSoon() { clearTimeout(t); status("Saving…"); t = setTimeout(saveNow, 900); }
    const upload = async (blob, kind) => (await req("POST", `/api/cards/${slug}/uploads?kind=${kind}`, blob, { "Content-Type": blob.type || "application/octet-stream" })).url;
    const tokenKey = (sl) => "bs-edit:" + sl;
    async function create() {
      try {
        toast("Making your surprise…");
        const j = await req("POST", "/api/cards", "{}", { "Content-Type": "application/json" });
        try { localStorage.setItem(tokenKey(j.slug), j.editToken); } catch (e) {}
        location.href = `/c/${j.slug}?edit=1`;
      } catch (e) { toast(e.message); }
    }
    async function editLink() {
      let tok = null;
      try { tok = localStorage.getItem(tokenKey(slug)); } catch (e) {}
      if (!tok) {
        const j = await req("POST", `/api/cards/${slug}/edit-link`, "{}", { "Content-Type": "application/json" });
        tok = j.editToken; try { localStorage.setItem(tokenKey(slug), tok); } catch (e) {}
      }
      return `${location.origin}/c/${slug}/edit?k=${tok}`;
    }
    async function remove() {
      await req("DELETE", `/api/cards/${slug}`);
      try { localStorage.removeItem(tokenKey(slug)); } catch (e) {}
      location.href = "/";
    }
    return { saveNow, saveSoon, upload, create, editLink, remove, slug };
  })();
  document.addEventListener("click", (e) => { if (e.target.closest("[data-make-own]")) Remote.create(); });

  /* the smallest possible diff, for a share link */
  function diff() {
    const d = {};
    ["birthdayName", "birthdayDate", "senderName", "memoryMessage", "personalMessage"].forEach((k) => { if (data[k] !== defaults[k]) d[k] = data[k]; });
    const same = data.photos.length === defaults.photos.length &&
      data.photos.every((p, i) => p.caption === defaults.photos[i].caption && (isData(p.src) || p.src === defaults.photos[i].src));
    if (!same) d.photos = data.photos.map((p) => (isData(p.src) ? { caption: p.caption } : { src: p.src, caption: p.caption }));
    return d;
  }

  /* ═════════ binding words to the page ═════════ */
  const nameOf = () => (data.birthdayName || "").trim() || "you";
  function view() {
    return {
      birthdayName: nameOf(),
      birthdayDate: (data.birthdayDate || "").trim() || "today",
      senderName: (data.senderName || "").trim() || "someone who adores you",
      memoryMessage: data.memoryMessage || ""
    };
  }
  function bind() {
    const v = view();
    $$("[data-bind]").forEach((el) => { const k = el.dataset.bind; if (k in v) el.textContent = v[k]; });
    document.title = nameOf() === "you" ? "A Little Birthday Surprise" : `Happy Birthday, ${nameOf()} ✨`;
    renderName();
    renderLetter();
    renderPolaroids();
  }

  /* ═════════ sound: background music + tiny synthesized effects ═════════ */
  const Sound = (() => {
    const el = $("#bgm");
    const btn = $("#musicBtn"), muteBtn = $("#muteBtn"), box = $(".music");
    let ctx = null, muted = false, wanted = true, started = false, fadeT;

    function src() {
      if (songBlob) { if (!songUrl) songUrl = URL.createObjectURL(songBlob); return songUrl; }
      if (data.musicData) return data.musicData;
      return asset(data.music || defaults.music);
    }
    function load() {
      const was = !el.paused;
      if (songUrl && !songBlob) { URL.revokeObjectURL(songUrl); songUrl = ""; }
      el.src = src(); el.load();
      if (was) play();
    }
    function ui() {
      const on = !el.paused;
      box.classList.toggle("playing", on);
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "Pause music" : "Play music");
      $(".music-label", btn).textContent = on ? "♪ Playing" : "♪ Music";
      muteBtn.setAttribute("aria-pressed", String(muted));
      muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
    }
    function fadeTo(target, ms = 1200) {
      clearInterval(fadeT);
      const step = (target - el.volume) / (ms / 50);
      fadeT = setInterval(() => {
        const v = el.volume + step;
        if ((step >= 0 && v >= target) || (step < 0 && v <= target)) { el.volume = clamp(target, 0, 1); clearInterval(fadeT); }
        else el.volume = clamp(v, 0, 1);
      }, 50);
    }
    function play() {
      if (!el.src) el.src = src();
      el.volume = 0;
      const p = el.play();
      started = true;
      if (p && p.then) p.then(() => fadeTo(clamp(+data.musicVolume || defaults.musicVolume, 0, 1))).catch(() => { ui(); });
    }
    function pause() { el.pause(); }
    function toggleMusic() { unlock(); if (el.paused) { wanted = true; play(); } else { wanted = false; pause(); } }
    function toggleMute() {
      muted = !muted; el.muted = muted; ui();
      if (!muted && el.paused && wanted && started) play();
    }
    function autoStart() { if (wanted && el.paused) play(); }
    el.addEventListener("play", ui); el.addEventListener("pause", ui);
    el.addEventListener("error", () => { if (started) { ui(); toast("The song couldn’t load — the surprise still works without it."); } });
    btn.addEventListener("click", toggleMusic);
    muteBtn.addEventListener("click", toggleMute);

    /* effects */
    function unlock() {
      if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { ctx = new AC(); } catch (e) { ctx = null; } }
    }
    function tone(freq, t0, dur, { type = "sine", vol = 0.06, to = null } = {}) {
      if (!ctx || muted) return;
      const t = ctx.currentTime + t0;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
    }
    function noise(t0, dur, vol = 0.04, freq = 2400) {
      if (!ctx || muted) return;
      const n = ctx.createBufferSource(), b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = vol;
      n.buffer = b; n.connect(f).connect(g).connect(ctx.destination); n.start(ctx.currentTime + t0);
    }
    const sfx = {
      pop: () => { tone(520, 0, 0.12, { to: 900, vol: 0.07 }); noise(0.02, 0.18, 0.03, 3200); },
      chime: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, 0.9, { type: "triangle", vol: 0.035 })); },
      click: () => { tone(1800, 0, 0.03, { type: "square", vol: 0.02 }); tone(900, 0.03, 0.05, { vol: 0.03 }); },
      slice: () => { noise(0, 0.28, 0.05, 1800); tone(660, 0.15, 0.35, { type: "triangle", vol: 0.03, to: 990 }); },
      sparkle: () => { [1319, 1568, 1760, 2093, 2637].forEach((f, i) => tone(f, i * 0.07, 0.5, { type: "sine", vol: 0.025 })); },
      whoosh: () => noise(0, 0.35, 0.012, 900)
    };
    return { load, play, pause, toggleMusic, toggleMute, autoStart, unlock, sfx, ui, get muted() { return muted; } };
  })();
  const sfx = Sound.sfx;

  /* ═════════ confetti (tiny canvas engine, no library) ═════════ */
  const Confetti = (() => {
    const cv = $("#fx"), c = cv.getContext("2d");
    let parts = [], raf = 0, w = 0, h = 0, dpr = 1, rainUntil = 0, rainDensity = 0;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = innerWidth; h = innerHeight;
      cv.width = w * dpr; cv.height = h * dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize(); addEventListener("resize", resize);
    const scale = reduced ? 0.25 : 1;
    function make(x, y, vx, vy) {
      return {
        x, y, vx, vy, rot: rand(0, Math.PI * 2), vr: rand(-0.25, 0.25), w: rand(6, 11), h: rand(4, 8),
        color: pick(PALETTE), shape: pick(["rect", "rect", "circle", "star", "strip"]), tilt: rand(0, Math.PI * 2), life: 1, fade: rand(0.0025, 0.005)
      };
    }
    function burst(x, y, { count = 90, power = 11, angle = -Math.PI / 2, spread = Math.PI * 1.1 } = {}) {
      const n = Math.round(count * scale);
      for (let i = 0; i < n; i++) {
        const a = angle + rand(-spread / 2, spread / 2), p = rand(power * 0.45, power);
        parts.push(make(x, y, Math.cos(a) * p, Math.sin(a) * p));
      }
      start();
    }
    function rain(ms = 3000, density = 3) {
      if (reduced) { burst(w / 2, h * 0.3, { count: 60, spread: Math.PI * 2, power: 6 }); return; }
      rainUntil = performance.now() + ms; rainDensity = density; start();
    }
    function start() { if (!raf) raf = requestAnimationFrame(tick); }
    function star(r) {
      c.beginPath();
      for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.45 : r, a = (i * Math.PI) / 5 - Math.PI / 2; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      c.closePath(); c.fill();
    }
    function tick(now) {
      c.clearRect(0, 0, w, h);
      if (now < rainUntil) for (let i = 0; i < rainDensity; i++) parts.push(make(rand(0, w), -20, rand(-1, 1), rand(1, 3)));
      parts = parts.filter((p) => p.y < h + 40 && p.life > 0);
      for (const p of parts) {
        p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.2; p.tilt += 0.08;
        p.x += p.vx + Math.sin(p.tilt) * 0.6; p.y += p.vy; p.rot += p.vr; p.life -= p.fade;
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = clamp(p.life * 1.6, 0, 1); c.fillStyle = p.color;
        const sq = Math.abs(Math.cos(p.tilt));
        if (p.shape === "circle") { c.beginPath(); c.arc(0, 0, p.h / 2, 0, Math.PI * 2); c.fill(); }
        else if (p.shape === "star") star(p.w * 0.6);
        else if (p.shape === "strip") c.fillRect(-p.w, -1.5, p.w * 2 * sq + 1, 3);
        else c.fillRect(-p.w / 2, (-p.h / 2) * sq, p.w, p.h * sq + 0.5);
        c.restore();
      }
      if (parts.length || now < rainUntil) raf = requestAnimationFrame(tick);
      else { raf = 0; c.clearRect(0, 0, w, h); }
    }
    function clear() { parts = []; rainUntil = 0; }
    return { burst, rain, clear };
  })();
  function playCelebration(x = innerWidth / 2, y = innerHeight * 0.45, big = false) {
    Confetti.burst(x, y, { count: big ? 140 : 90, power: big ? 14 : 11, spread: Math.PI * 1.3 });
  }
  const centerOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  /* ═════════ cursor sparkles + gentle parallax (desktop only) ═════════ */
  if (finePointer && !reduced) {
    const layer = $("#cursorLayer");
    let last = 0, lx = 0, ly = 0, pending = null;
    addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const now = performance.now();
      if (now - last > 40 && Math.hypot(e.clientX - lx, e.clientY - ly) > 16 && layer.childElementCount < 26) {
        last = now; lx = e.clientX; ly = e.clientY;
        const s = document.createElement("i");
        s.style.setProperty("--x", e.clientX + rand(-6, 6) + "px");
        s.style.setProperty("--y", e.clientY + rand(-6, 6) + "px");
        s.style.setProperty("--c", pick(["#FF9FB5", "#FFD86B", "#B9A7E8", "#FFC7D6"]));
        s.addEventListener("animationend", () => s.remove());
        layer.appendChild(s);
      }
      pending = [e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5];
      requestAnimationFrame(() => {
        if (!pending) return;
        const sc = Scenes.el(Scenes.current);
        sc.style.setProperty("--px", (pending[0] * 2).toFixed(3));
        sc.style.setProperty("--py", (pending[1] * 2).toFixed(3));
        pending = null;
      });
    }, { passive: true });
  }

  /* ═════════ scene manager ═════════ */
  const Scenes = {
    current: 1, busy: false, total: 8, hooks: {},
    el: (n) => $(`.scene[data-scene="${n}"]`)
  };
  const progress = $("#progress");
  progress.innerHTML = Array.from({ length: Scenes.total }, (_, i) => `<li aria-label="Part ${i + 1}"></li>`).join("");
  function paintProgress() {
    $$("li", progress).forEach((li, i) => {
      li.className = i + 1 === Scenes.current ? "now" : i + 1 < Scenes.current ? "done" : "";
      if (i + 1 === Scenes.current) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
  }
  function goToScene(n, { reveal = false, force = false } = {}) {
    n = clamp(n, 1, Scenes.total);
    if ((Scenes.busy && !force) || n === Scenes.current) return;
    const from = Scenes.el(Scenes.current), to = Scenes.el(n), prev = Scenes.current;
    Scenes.busy = true;
    const leave = Scenes.hooks[prev] && Scenes.hooks[prev].leave; if (leave) leave();
    Scenes.current = n;
    to.scrollTop = 0; to.inert = false; to.removeAttribute("aria-hidden");
    document.body.dataset.tone = to.dataset.tone || "light";
    paintProgress();

    if (reveal) {
      // the new room is already there underneath; the old one is peeled away by a growing circle of light
      to.style.transition = "none"; to.classList.add("is-active"); void to.offsetWidth; to.style.transition = "";
      from.classList.add("is-leaving", "is-revealing");
      setTimeout(() => {
        from.style.transition = "none";
        from.classList.remove("is-active", "is-leaving", "is-revealing");
        void from.offsetWidth; from.style.transition = "";
        from.inert = true; from.setAttribute("aria-hidden", "true");
      }, reduced ? 650 : 1550);
    } else {
      sfx.whoosh();
      from.classList.remove("is-active"); from.classList.add("is-leaving");
      to.classList.add("is-active");
      from.inert = true; from.setAttribute("aria-hidden", "true");
      setTimeout(() => from.classList.remove("is-leaving"), 1000);
    }
    const enter = Scenes.hooks[n] && Scenes.hooks[n].enter; if (enter) enter();
    setTimeout(() => {
      Scenes.busy = false;
      const h = $("[tabindex='-1']", to); if (h) h.focus({ preventScroll: true });
    }, reveal ? 900 : 700);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-next]"); if (b) goToScene(Scenes.current + 1);
  });

  /* ═════════ 1 · envelope ═════════ */
  const envelope = $("#envelope"), openBtn = $("#openBtn");
  let opened = false;
  async function openSurprise() {
    if (opened) return;
    opened = true; openBtn.disabled = true;
    Sound.unlock(); Sound.autoStart();
    envelope.classList.add("is-open"); sfx.pop();
    await wait(380);
    const [x, y] = centerOf(envelope);
    playCelebration(x, y - 20);
    await wait(reduced ? 900 : 2100);
    goToScene(2);
  }
  openBtn.addEventListener("click", openSurprise);
  envelope.addEventListener("click", openSurprise);

  /* ═════════ 2 · dark room ═════════ */
  const dark = Scenes.el(2);
  (function makeStars() {
    const sky = $("#nightSky");
    const n = innerWidth < 600 ? 55 : 110;
    let html = "";
    for (let i = 0; i < n; i++) {
      html += `<i style="left:${rand(0, 100).toFixed(2)}%;top:${rand(0, 92).toFixed(2)}%;--s:${rand(1, 2.8).toFixed(1)}px;--t:${rand(2.2, 5).toFixed(1)}s;--dl:${rand(-5, 0).toFixed(1)}s"></i>`;
    }
    sky.innerHTML = html;
  })();
  let lit = false;
  async function lightsOn() {
    if (lit) return;
    lit = true; $("#lightsBtn").disabled = true;
    Sound.unlock(); Sound.autoStart();
    const bulb = $(".bulb", dark).getBoundingClientRect();
    dark.style.setProperty("--lx", ((bulb.left + bulb.width / 2) / innerWidth * 100).toFixed(1) + "%");
    dark.style.setProperty("--ly", ((bulb.top + bulb.height / 2) / innerHeight * 100).toFixed(1) + "%");
    dark.classList.add("lights-on"); sfx.click();
    await wait(reduced ? 300 : 750);
    sfx.chime();
    goToScene(3, { reveal: true });
  }
  $("#lightsBtn").addEventListener("click", lightsOn);
  $(".bulb", dark).addEventListener("click", lightsOn);
  $(".bulb", dark).style.pointerEvents = "auto";
  $(".bulb", dark).style.cursor = "pointer";

  /* ═════════ 3 · birthday room ═════════ */
  (function fairyLights() {
    const path = $("#fairyPath"), box = $("#fairyBulbs");
    if (!path.getTotalLength) return;
    const len = path.getTotalLength(), n = innerWidth < 600 ? 14 : 24;
    const cols = [["#FFD86B", "rgba(255,216,107,.7)"], ["#FF9FB5", "rgba(255,159,181,.7)"], ["#B9A7E8", "rgba(185,167,232,.7)"], ["#A8DCC8", "rgba(168,220,200,.7)"]];
    let html = "";
    for (let i = 1; i < n; i++) {
      const p = path.getPointAtLength((len * i) / n), c = cols[i % cols.length];
      html += `<i style="left:${(p.x / 10).toFixed(2)}%;top:${(p.y / 1.2).toFixed(2)}%;--c:${c[0]};--g:${c[1]};--dl:${(-i * 0.37).toFixed(2)}s"></i>`;
    }
    box.innerHTML = html;
  })();
  function renderName() {
    const el = $("#bdayName"), name = nameOf();
    el.innerHTML = Array.from(name).map((ch, k) => `<span class="ch" style="--k:${k}">${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("");
    el.setAttribute("aria-label", name);
    el.style.fontSize = name.length > 14 ? "0.7em" : name.length > 9 ? "0.85em" : "";
    if (Scenes.current === 3) el.classList.add("go");
  }
  Scenes.hooks[3] = {
    enter() {
      const el = $("#bdayName"); el.classList.remove("go"); void el.offsetWidth; el.classList.add("go");
      setTimeout(() => Confetti.rain(2600, 2), reduced ? 100 : 700);
    }
  };

  /* ═════════ 4 · cake ═════════ */
  const cakeZone = $("#cakeZone"), cake = $("#cake"), cutPath = $("#cutPath");
  $$(".cake-half", cake).forEach((h) => h.appendChild($("#cakeTpl").content.cloneNode(true)));
  let cut = false;
  function resetCake() {
    cut = false;
    cake.classList.remove("split", "celebrate"); cake.style.removeProperty("--cut");
    cakeZone.classList.remove("is-cut", "drawing"); cutPath.setAttribute("d", "");
    $("#cakeTitle").textContent = "Make the first cut ✨";
    $("#cakeHint").textContent = "Swipe down across the cake, top to bottom.";
    $("#cakeDone").hidden = true;
    cakeZone.setAttribute("aria-label", "Birthday cake. Swipe down across it to cut, or press Enter.");
  }
  async function completeCut(xPct) {
    if (cut) return;
    cut = true;
    cake.style.setProperty("--cut", clamp(xPct, 45, 55).toFixed(1) + "%");
    cakeZone.classList.add("is-cut"); cakeZone.classList.remove("drawing");
    sfx.slice();
    await wait(140);
    cake.classList.add("split", "celebrate");
    const r = cake.getBoundingClientRect();
    playCelebration(r.left + r.width / 2, r.top + r.height * 0.25);
    await wait(420);
    $("#cakeTitle").textContent = "You did it! 🎉";
    $("#cakeHint").textContent = "The first slice is always the sweetest one.";
    cakeZone.setAttribute("aria-label", "The cake is cut.");
    $("#cakeDone").hidden = false;
    setTimeout(() => { const b = $("#cakeDone .btn"); if (b) b.focus({ preventScroll: true }); }, 400);
  }
  function startCakeInteraction() {
    let drawing = false, pts = [], pid = null;
    const local = (e) => { const r = cakeZone.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const draw = () => { cutPath.setAttribute("d", pts.length ? "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L") : ""); };
    function measure() {
      const z = cakeZone.getBoundingClientRect(), c = cake.getBoundingClientRect();
      const left = c.left - z.left, top = c.top - z.top, cw = c.width, ch = c.height;
      const inside = pts.filter((p) => p[0] > left - cw * 0.08 && p[0] < left + cw * 1.08);
      if (inside.length < 3) return null;
      const ys = inside.map((p) => p[1]), minY = Math.min(...ys), maxY = Math.max(...ys);
      const ok = maxY - minY >= ch * 0.55 && minY <= top + ch * 0.45 && maxY >= top + ch * 0.82;
      const avgX = inside.reduce((s, p) => s + p[0], 0) / inside.length;
      return { ok, xPct: ((avgX - left) / cw) * 100 };
    }
    cakeZone.addEventListener("pointerdown", (e) => {
      if (cut || (e.pointerType === "mouse" && e.button !== 0)) return;
      Sound.unlock();
      drawing = true; pid = e.pointerId; pts = [local(e)];
      try { cakeZone.setPointerCapture(pid); } catch (err) {}
      cakeZone.classList.add("drawing"); draw();
      e.preventDefault();
    });
    cakeZone.addEventListener("pointermove", (e) => {
      if (!drawing || e.pointerId !== pid) return;
      const p = local(e), l = pts[pts.length - 1];
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 3) return;
      pts.push(p); if (pts.length > 240) pts.shift();
      draw();
      const m = measure(); if (m && m.ok) { drawing = false; completeCut(m.xPct); }
    });
    const end = (e) => {
      if (!drawing || (e && e.pointerId !== pid)) return;
      drawing = false; cakeZone.classList.remove("drawing");
      const m = measure();
      if (m && m.ok) { completeCut(m.xPct); return; }
      cutPath.setAttribute("d", "");
      if (pts.length > 2) {
        cakeZone.classList.remove("nope"); void cakeZone.offsetWidth; cakeZone.classList.add("nope");
        $("#cakeHint").textContent = "Almost! One long swipe from the candles all the way down.";
      }
    };
    cakeZone.addEventListener("pointerup", end);
    cakeZone.addEventListener("pointercancel", end);
    cakeZone.addEventListener("lostpointercapture", end);
    cakeZone.addEventListener("animationend", () => cakeZone.classList.remove("nope"));
    // keyboard: Enter / Space draws the cut for you
    cakeZone.addEventListener("keydown", async (e) => {
      if (cut || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault(); Sound.unlock();
      const z = cakeZone.getBoundingClientRect(), c = cake.getBoundingClientRect();
      const x = c.left - z.left + c.width / 2, y0 = c.top - z.top + c.height * 0.02, y1 = c.top - z.top + c.height * 0.98;
      pts = [];
      for (let i = 0; i <= 12; i++) { pts.push([x + Math.sin(i) * 1.5, y0 + ((y1 - y0) * i) / 12]); draw(); await wait(reduced ? 0 : 28); }
      completeCut(50);
    });
  }
  startCakeInteraction();
  Scenes.hooks[4] = { enter() { if (!cut) resetCake(); } };

  /* ═════════ 5 · make a wish ═════════ */
  const wishScene = Scenes.el(5);
  (function glowField() {
    const f = $("#glowField"); let html = "";
    const n = innerWidth < 600 ? 14 : 24;
    for (let i = 0; i < n; i++) html += `<i style="left:${rand(0, 100).toFixed(1)}%;--s:${rand(6, 16).toFixed(0)}px;--t:${rand(9, 18).toFixed(1)}s;--dl:${rand(-18, 0).toFixed(1)}s"></i>`;
    f.innerHTML = html;
  })();
    (function makeWishStars() {
    const sky = $("#wishSky");
    const n = innerWidth < 600 ? 55 : 110;
    let html = "";
    for (let i = 0; i < n; i++) {
      html += `<i style="left:${rand(0, 100).toFixed(2)}%;top:${rand(0, 92).toFixed(2)}%;--s:${rand(1, 2.8).toFixed(1)}px;--t:${rand(2.2, 5).toFixed(1)}s;--dl:${rand(-5, 0).toFixed(1)}s"></i>`;
    }
    sky.innerHTML = html;
  })();
  let wished = false;
  async function startWishAnimation() {
    if (wished) return;
    wished = true; $("#wishBtn").disabled = true;
    Sound.unlock(); wishScene.classList.add("wished");     wishScene.dataset.tone = "light"; document.body.dataset.tone = "light"; sfx.sparkle();
    const art = $(".wish-art", wishScene).getBoundingClientRect();
    const float = $("#wishFloat"); let html = "";
    const n = reduced ? 10 : 42;
    for (let i = 0; i < n; i++) {
      const dot = i % 3 === 0;
      html += `<i class="${dot ? "dot" : ""}" style="--x:${(art.left + art.width * rand(0.25, 0.9)).toFixed(0)}px;--y:${(art.top + art.height * rand(0.1, 0.5)).toFixed(0)}px;--s:${rand(dot ? 5 : 10, dot ? 10 : 22).toFixed(0)}px;--c:${pick(["#FFD86B", "#FFE8A3", "#FF9FB5", "#B9A7E8", "#fff"])};--t:${rand(2.2, 3.8).toFixed(2)}s;--dl:${rand(0, 1.2).toFixed(2)}s;--dx:${rand(-160, 160).toFixed(0)}px"></i>`;
    }
    float.innerHTML = html;
    Confetti.burst(art.left + art.width * 0.7, art.top + art.height * 0.3, { count: 50, power: 8, spread: Math.PI * 0.9 });
    await wait(600);
    $("#wishTitle").textContent = "Your wish is on its way ✨";
    $("#wishSub").textContent = "Somewhere, a tiny star just said yes.";
    await wait(reduced ? 1600 : 3000);
    goToScene(6);
  }
  function resetWish() {
    wished = false; $("#wishBtn").disabled = false;
    wishScene.classList.remove("wished");     wishScene.dataset.tone = "dark";$("#wishFloat").innerHTML = "";
    $("#wishTitle").textContent = "Close your eyes…";
    $("#wishSub").textContent = "Make a little wish for the year ahead.";
  }
  $("#wishBtn").addEventListener("click", startWishAnimation);

  /* ═════════ 6 · memories ═════════ */
  const ROT = [-4, 3, -2, 4, -3, 2];
  const DECOR = [["sticker-heart", "tr"], null, ["sticker-star", "bl"], ["sticker-sparkle", "tr"], null, ["sticker-heart", "br"]];
  const photoInput = document.createElement("input");
  photoInput.type = "file"; photoInput.accept = "image/*"; photoInput.hidden = true;
  document.body.appendChild(photoInput);
  let photoTarget = -1;
  function pickPhoto(i) { photoTarget = i; photoInput.value = ""; photoInput.click(); }

  function paintPh(el, src) {
    el.classList.remove("empty");
    if (!src) { el.style.backgroundImage = ""; el.classList.add("empty"); return; }
    const url = asset(src), img = new Image();
    img.onload = () => { el.style.backgroundImage = `url("${url}")`; };
    img.onerror = () => { el.style.backgroundImage = ""; el.classList.add("empty"); };
    img.src = url;
  }
  function renderPolaroids() {
    const box = $("#polaroids");
    const cards = data.photos.map((p, i) => {
      const d = DECOR[i];
      return `<figure class="pol" tabindex="0" style="--r:${ROT[i % ROT.length]}deg;--n:${i}">
        <div class="ph" data-slot="${i}" role="img" aria-label="${esc(p.caption || "A memory")}"></div>
        <button class="ph-add" type="button" data-pick="${i}">${p.src ? "Change" : "＋ Photo"}</button>
        <figcaption>${esc(p.caption)}</figcaption>
        ${d ? `<img class="pol-sticker ${d[1]} sticker" data-src="assets/stickers/${d[0]}.webp" alt="" aria-hidden="true">` : ""}
      </figure>`;
    });
    if (!viewer && data.photos.length < 6) cards.push(`<button class="pol-add" type="button" data-add-mem><b>＋</b>Add a memory</button>`);
    box.innerHTML = cards.join("");
    $$(".ph", box).forEach((el) => paintPh(el, data.photos[+el.dataset.slot].src));
    $$("img[data-src]", box).forEach((img) => { img.src = asset(img.dataset.src); });
  }
  $("#polaroids").addEventListener("click", (e) => {
    const p = e.target.closest("[data-pick]");
    if (p) { pickPhoto(+p.dataset.pick); return; }
    if (e.target.closest("[data-add-mem]")) {
      if (data.photos.length >= 6) return;
      data.photos.push({ src: "", caption: "a little moment" });
      renderPolaroids(); save(); pickPhoto(data.photos.length - 1);
      return;
    }
    const card = e.target.closest(".pol"); // tap to lift on touch screens
    if (card) { $$(".pol.lift").forEach((c) => c !== card && c.classList.remove("lift")); card.classList.toggle("lift"); }
  });
  photoInput.addEventListener("change", async () => {
    const f = photoInput.files[0]; if (!f || photoTarget < 0) return;
    const slot = photoTarget;
    try {
      let src;
      if (owner) {
        toast("Uploading your photo…");
        src = await Remote.upload(await readPhoto(f, 1400, true), "photo");
      } else src = await readPhoto(f);
      if (!data.photos[slot]) data.photos[slot] = { src: "", caption: "" };
      data.photos[slot].src = src;
      if (owner) await Remote.saveNow(); else { await persistPhotos(); save(); }
      renderPolaroids(); if (Editor.isOpen()) Editor.renderPhotos();
      toast("Photo added ✨");
    } catch (err) { toast(owner && err.message ? err.message : "That picture couldn’t be read — try a JPG or PNG."); }
  });
  /* shrink an upload so six of them still fit on the device */
  const readPhoto = (file, max = 1000, asBlob = false) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        if (asBlob) cv.toBlob((b) => (b ? res(b) : rej(new Error("That picture couldn’t be read — try a JPG or PNG."))), "image/jpeg", 0.84);
        else res(cv.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = rej; img.src = fr.result;
    };
    fr.onerror = rej; fr.readAsDataURL(file);
  });

  /* ═════════ 7 · letter ═════════ */
  const letterBody = $("#letterBody");
  function renderLetter() {
    const text = String(data.personalMessage || "").trim() || "Happy birthday. Today is all yours.";
    letterBody.innerHTML = text.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
    requestAnimationFrame(checkLetter);
  }
  function checkLetter() {
    const scrolls = letterBody.scrollHeight > letterBody.clientHeight + 4;
    letterBody.classList.toggle("scrolls", scrolls);
    letterBody.classList.toggle("at-end", letterBody.scrollTop + letterBody.clientHeight >= letterBody.scrollHeight - 6);
  }
  letterBody.addEventListener("scroll", checkLetter, { passive: true });
  addEventListener("resize", checkLetter);
  Scenes.hooks[7] = { enter() { letterBody.scrollTop = 0; setTimeout(checkLetter, 300); } };

  /* ═════════ 8 · finale ═════════ */
  let riseT = [];
  function launchBalloons() {
    const sky = $("#skyRise"); sky.innerHTML = "";
    const list = [
      ["sticker-balloon-group", 4, 22, 0], ["sticker-balloon-group", 72, 18, 1.4], ["sticker-heart", 30, 7, 2.2],
      ["sticker-star", 50, 6, 0.8], ["sticker-balloon-group", 44, 14, 3.4], ["sticker-sparkle", 86, 5, 2.8], ["sticker-heart", 12, 5, 4.2]
    ];
    const narrow = innerWidth < 600;
    sky.innerHTML = list.map(([n, x, wv, dl]) =>
      `<img class="sticker" src="${asset(`assets/stickers/${n}.webp`)}" alt="" style="--x:${x}%;--w:${narrow ? wv * 1.5 : wv}vmin;--t:${rand(11, 16).toFixed(1)}s;--dl:${dl}s">`).join("");
  }
  Scenes.hooks[8] = {
    enter() {
      launchBalloons();
      riseT.push(setTimeout(() => { playCelebration(innerWidth / 2, innerHeight * 0.4, true); Confetti.rain(5200, 3); }, reduced ? 100 : 650));
    },
    leave() { riseT.forEach(clearTimeout); riseT = []; }
  };
  function restartExperience() {
    Confetti.clear();
    opened = false; openBtn.disabled = false; envelope.classList.remove("is-open");
    lit = false; $("#lightsBtn").disabled = false; dark.classList.remove("lights-on", "is-revealing", "is-leaving");
    resetCake(); resetWish();
    $("#skyRise").innerHTML = "";
    $$(".pol.lift").forEach((c) => c.classList.remove("lift"));
    goToScene(1, { force: true });
  }
  $("#replayBtn").addEventListener("click", restartExperience);

  /* ═════════ editor: "make it yours" ═════════ */
  const Editor = (() => {
    const ed = $("#editor"), panel = $(".ed-panel", ed);
    let lastFocus = null;
    const isOpen = () => !ed.hidden;
    function open(sec) {
      if (viewer) return;
      if (mode === "demo") { Remote.create(); return; }
      lastFocus = document.activeElement;
      fill();
      ed.hidden = false;
      requestAnimationFrame(() => ed.classList.add("open"));
      document.documentElement.classList.add("editing");
      const fs = sec && $(`fieldset[data-sec="${sec}"]`, ed);
      setTimeout(() => {
        if (fs && sec !== "basics") fs.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        const first = fs ? $("input, textarea, button", fs) : $("input", ed);
        if (first) first.focus({ preventScroll: true });
      }, 350);
    }
    function close() {
      ed.classList.remove("open");
      document.documentElement.classList.remove("editing");
      setTimeout(() => { ed.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }, 420);
    }
    function fill() {
      $$("[data-k]", ed).forEach((el) => { el.value = data[el.dataset.k] || ""; });
      $("#edMusicName").textContent = data.musicFileName ? `Playing your song: ${data.musicFileName}` : "Using the built-in song.";
      renderPhotos();
    }
    function renderPhotos() {
      const box = $("#edPhotos");
      box.innerHTML = data.photos.map((p, i) => `
        <div class="ed-photo">
          <button class="ed-thumb" type="button" data-ed-pick="${i}" aria-label="Choose photo ${i + 1}"><span>${p.src ? "change" : "add"}</span></button>
          <input type="text" data-cap="${i}" maxlength="48" value="${esc(p.caption)}" aria-label="Caption for photo ${i + 1}" placeholder="a little caption">
          <button class="del" type="button" data-ed-del="${i}" aria-label="Remove memory ${i + 1}" ${data.photos.length <= 1 ? "disabled" : ""}>✕</button>
        </div>`).join("");
      $$(".ed-thumb", box).forEach((t, i) => {
        const src = data.photos[i].src;
        t.style.backgroundImage = src ? `url("${asset(src)}")` : "";
      });
      $("#edAddPhoto").disabled = data.photos.length >= 6;
    }
    ed.addEventListener("input", (e) => {
      const el = e.target;
      if (el.dataset.k) data[el.dataset.k] = el.value;
      if (el.dataset.cap != null) data.photos[+el.dataset.cap].caption = el.value;
      bind();
      if (owner) Remote.saveSoon();
    });
    ed.addEventListener("click", async (e) => {
      if (e.target.closest("[data-ed-close]")) { close(); return; }
      const p = e.target.closest("[data-ed-pick]"); if (p) { pickPhoto(+p.dataset.edPick); return; }
      const d = e.target.closest("[data-ed-del]");
      if (d && data.photos.length > 1) {
        data.photos.splice(+d.dataset.edDel, 1);
        await persistPhotos(); save(); renderPhotos(); renderPolaroids();
      }
    });
    $("#edAddPhoto").addEventListener("click", () => {
      if (data.photos.length >= 6) return;
      data.photos.push({ src: "", caption: "a little moment" });
      renderPhotos(); renderPolaroids(); pickPhoto(data.photos.length - 1);
    });
    ed.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { close(); return; }
      if (e.key !== "Tab") return;
      const f = $$("button:not([disabled]), input:not([hidden]), textarea, label.file-btn", panel).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });

    /* song */
    $("#edMusicFile").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 15e6) { toast("That song is over 15 MB — try a smaller file."); return; }
      if (owner) {
        try { toast("Uploading your song…"); data.music = await Remote.upload(f, "music"); }
        catch (err) { toast(err.message); return; }
        data.musicFileName = f.name; await Remote.saveNow(); fill(); Sound.load();
        toast("Song added — tap ♪ Music to hear it");
        return;
      }
      songBlob = f; if (songUrl) { URL.revokeObjectURL(songUrl); songUrl = ""; }
      data.musicFileName = f.name; delete data.musicData;
      await idb.set("song", { blob: f, name: f.name });
      save(); fill(); Sound.load();
      toast("Song added — tap ♪ Music to hear it");
    });
    $("#edMusicReset").addEventListener("click", async () => {
      songBlob = null; if (songUrl) { URL.revokeObjectURL(songUrl); songUrl = ""; }
      delete data.musicFileName; delete data.musicData; data.music = defaults.music;
      if (!owner) await idb.del("song");
      await save(); fill(); Sound.load();
    });

    /* save / preview / reset */
    $("#edSave").addEventListener("click", async () => { if (await save()) { toast(owner ? "Saved ✓ — your link is up to date" : "Saved on this device ✓"); sfx.chime(); } });
    $("#edPreview").addEventListener("click", async () => { await save(); close(); setTimeout(restartExperience, 300); });
    $("#edReset").addEventListener("click", async () => {
      if (owner) {
        if (confirm("Delete this surprise for good? The link will stop working and the photos are removed.")) {
          try { await Remote.remove(); } catch (e) { toast(e.message); }
        }
        return;
      }
      if (confirm("Clear every name, photo, message and song on this device and start fresh?")) resetAll();
    });

    /* share link: only the words that differ from the defaults travel in the #hash */
    $("#edLink").addEventListener("click", async () => {
      if (owner) {
        await save();
        const url = `${location.origin}/c/${Remote.slug}`;
        try { await navigator.clipboard.writeText(url); toast("Link copied ✨ Send it to the birthday person!"); }
        catch (err) { prompt("Copy this link:", url); }
        return;
      }
      save();
      const d = Object.assign(diff(), { sent: true });
      const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const url = location.href.split("#")[0] + "#d=" + b64;
      if (location.protocol === "file:") toast("Links work once the page is online. For WhatsApp, use Download my card.");
      try { await navigator.clipboard.writeText(url); toast("Share link copied ✨ (words only; photos travel in the downloaded card)"); }
      catch (err) { prompt("Copy this link:", url); }
    });

    /* one self-contained .html with the words, photos and song inside */
    $("#edEditLink").addEventListener("click", async () => {
      try {
        const url = await Remote.editLink();
        try { await navigator.clipboard.writeText(url); toast("Private edit link copied — keep it to yourself 🔒"); }
        catch (err) { prompt("Your private edit link (keep it secret):", url); }
      } catch (e) { toast(e.message); }
    });
    if (owner) {
      $("#edNote").textContent = "Changes save to your link automatically. Anyone with the link sees the finished surprise; only you can edit it.";
      $("#edSendNote").innerHTML = "<strong>Copy share link</strong> is what you send. Keep the <strong>private edit link</strong> to change things later from any phone or laptop.";
      $("#edDownload").hidden = true; $("#edEditLink").hidden = false;
      $("#edReset").textContent = "Delete this surprise";
      const st = document.createElement("span"); st.className = "ed-status"; st.id = "edStatus"; st.setAttribute("aria-live", "polite");
      $(".ed-foot").prepend(st);
      if (srv.views) { $("#edViews").hidden = false; $("#edViews").textContent = `💌 Opened ${srv.views} time${srv.views === 1 ? "" : "s"} so far`; }
    } else if (!built) $("#edDownloadNote").textContent = "Download works in the finished one-file page (run build.py, then open index.html).";
    const blobToDataUrl = (b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
    $("#edDownload").addEventListener("click", async () => {
      if (!built || !window.BS_PRISTINE) { toast("Open the finished index.html (built with build.py) to download the card."); return; }
      save();
      const d = clone(data); d.sent = true; delete d.musicFileName;
      if (songBlob) d.musicData = await blobToDataUrl(songBlob);
      const END = "<" + "/script>";
      const json = JSON.stringify(d).replace(/</g, "\\u003c");
      let html = window.BS_PRISTINE.replace(/(<script type="application\/json" id="bs-preset">)[\s\S]*?(<\/script>)/, (m0, a) => a + json + END);
      if (d.musicData) html = html.replace(/("assets\/music\/birthday\.mp3": ")data:[^"]+"/, '$1"');
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `happy-birthday-${(nameOf() === "you" ? "surprise" : nameOf()).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "surprise"}.html`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("Downloaded — send that file, it opens as the finished surprise ✨");
    });

    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-edit]"); if (b && !ed.contains(b)) open(b.dataset.edit || sectionFor(Scenes.current));
    });
    const sectionFor = (n) => ({ 6: "memories", 7: "letter", 8: "send" }[n] || "basics");
    return { open, close, isOpen, renderPhotos };
  })();

  /* ═════════ loading + boot ═════════ */
  async function boot() {
    const first = Scenes.el(1);
    first.classList.remove("is-active");
    $$(".scene").forEach((s) => { if (s !== first) { s.inert = true; s.setAttribute("aria-hidden", "true"); } });
    paintProgress();

    const started = performance.now();
    await Promise.race([loadLocalMedia(), wait(2500)]);
    bind();
    Sound.load();

    const srcs = new Set($$("img").map((i) => i.currentSrc || i.src).filter(Boolean));
    data.photos.forEach((p) => p.src && srcs.add(asset(p.src)));
    const preload = Array.from(srcs).map((s) => new Promise((res) => { const im = new Image(); im.onload = im.onerror = res; im.src = s; }));
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    await Promise.race([Promise.all([...preload, fonts]), wait(7000)]);
    const left = 1100 - (performance.now() - started);
    if (left > 0) await wait(left);

    $("#loader").classList.add("done");
    document.body.classList.add("ready");
    first.classList.add("is-active");
    if (wantsEdit && !viewer) setTimeout(() => Editor.open("basics"), 900);
  }
  if (window.__BS_HOSTED__) {
    window.addEventListener("message", function (ev) {
      var d = ev.data || {};
      if (d.type !== "vault-live" || !d.payload) return;
      var next = d.payload.bsurprise_payload;
      if (typeof next === "string") { try { next = JSON.parse(next); } catch (e) { next = null; } }
      if (!next || typeof next !== "object") return;
      Object.keys(next).forEach(function (k) {
        if (k === "photos" || k === "captions" || k === "sent") return;
        if (typeof next[k] === "string" && next[k] !== "") data[k] = next[k];
      });
      /* the memory wall: pictures come from the builder's grid, captions from
         the boxes under them */
      var urls = Array.isArray(d.payload.photos) ? d.payload.photos : null;
      var caps = Array.isArray(next.captions) ? next.captions
               : (Array.isArray(d.payload.photo_captions) ? d.payload.photo_captions : null);
      if (urls) {
        data.photos = urls.filter(Boolean).slice(0, 6).map(function (u, i) {
          return { src: u, caption: (caps && caps[i]) || "" };
        });
      }
      bind();
    });
    try { parent.postMessage({ type: "vault-ready", variety: "surprise" }, "*"); } catch (e) {}
  }

  if (mode === "demo") $$(".chip-edit span, .chip-make").forEach((el) => { el.textContent = el.classList.contains("chip-make") ? "✨ Make one for someone" : "Make yours"; });
  boot();

  // handy from the console while you personalise: birthdaySurprise.goToScene(6)
  window.birthdaySurprise = { goToScene: (n) => goToScene(n, { force: true }), restartExperience, playCelebration, toggleMusic: Sound.toggleMusic };
})();
