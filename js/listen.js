/* Audiobooks on the phone: a player that keeps going while you use the rest of the app (a little bar at the bottom,
   the lock screen's controls), for a book's audiobook or one kept as an entry of its own. It plays only from the
   phone: an audiobook is downloaded first (⬇, on the book's page or here), never streamed. Your place is saved like a page is:
   it syncs, and the book's progress bar follows how far through the book you've listened. The reader (readers.js)
   uses this same player to light up the sentence being read. */
const Listen = (() => {
  const audio = new Audio();
  audio.preload = "auto";
  const L = { id: null, ch: 0, rate: 1, ...load("listen.json", {}) };
  let M = null, blobUrl = null, savedAt = 0, open = false, loading = 0, want = null, stuck = 0, lastT = -1, revived = 0;   // (want: the part to play once it's downloaded)
  const ticks = new Set();
  const RATES = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const keep = () => store("listen.json", { id: L.id, ch: L.ch, rate: L.rate });
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0"); };
  const ext = (c) => ((c.file || "").match(/\.\w+$/) || [".mp3"])[0].toLowerCase();
  const fname = (id, n, m) => `ab${id}-${n}${ext(m.chapters[n])}`;
  const here = (id, n, m) => !!S.files[fname(id, n, m)];
  const allHere = (id, m) => m && m.chapters.every((_, n) => here(id, n, m));
  const posOf = (it) => { const p = it && it.audio_pos; if (!p) return null; if (typeof p === "object") return p; try { return JSON.parse(p); } catch (e) { return null; } };

  /* the chapter list (and the sentences' times): from the computer, kept on the phone for offline */
  const mcache = {};
  const fresh = {};
  async function fetchManifest(id) {
    try {
      const m = await api("GET", `/sync/item/${id}/audiobook`);
      if (m && m.chapters) { fresh[id] = true; store(`ab-${id}.json`, m); if (mcache[id]) Object.assign(mcache[id], m); else mcache[id] = m; return mcache[id]; }
    } catch (e) {}
    return null;
  }
  // (the copy kept on the phone straight away, so pressing Listen never waits on the network; the computer's copy
  //  replaces it quietly in the background, for read-along times that have arrived since)
  async function manifest(id) {
    if (!mcache[id]) { const kept = load(`ab-${id}.json`, null); if (kept && kept.chapters) mcache[id] = kept; }
    if (mcache[id]) {
      if (!fresh[id] && S.conn.token) { fresh[id] = true; fetchManifest(id).then((m) => { if (m && L.id === id) { M = m; paint(); } }); }
      return mcache[id];
    }
    return fetchManifest(id);
  }
  /* how far through the book a place in the audiobook is (as on the computer: narrated.frac_at) */
  function withBp(m) {
    const ss = m.chapters.flatMap((c) => c.sentences || []);
    if (ss.length && ss[0].bp == null) { const tot = ss.reduce((a, s) => a + (s.text || "").length, 0) || 1; let run = 0; for (const s of ss) { s.bp = run / tot; run += (s.text || "").length; } }
    return m;
  }
  const timed = (m) => m.aligned || m.source !== "narrated";
  function fracAt(m, ch, t) {
    withBp(m);
    if (timed(m)) for (let i = ch; i >= 0; i--) {
      let best = null;
      for (const s of m.chapters[i].sentences || []) { if (i < ch || s.t0 <= t + 0.05) best = s; else break; }
      if (best) return best.bp;
    }
    const tot = m.chapters.reduce((a, c) => a + c.duration, 0) || 1;
    return Math.max(0, Math.min(1, (m.chapters.slice(0, ch).reduce((a, c) => a + c.duration, 0) + t) / tot));
  }
  function posAt(m, frac) {
    withBp(m);
    if (timed(m)) for (let i = 0; i < m.chapters.length; i++) for (const s of m.chapters[i].sentences || []) if (s.bp >= frac - 1e-6) return { ch: i, t: Math.max(0, s.t0 - 0.3) };
    let left = Math.max(0, Math.min(1, frac)) * m.chapters.reduce((a, c) => a + c.duration, 0);
    for (let i = 0; i < m.chapters.length; i++) { if (left < m.chapters[i].duration || i === m.chapters.length - 1) return { ch: i, t: Math.min(left, m.chapters[i].duration) }; left -= m.chapters[i].duration; }
    return { ch: 0, t: 0 };
  }

  /* ---------------- playing */
  async function loadCh(n, t, play) {
    const id = L.id, m = M, my = ++loading;
    L.ch = n; keep();
    paint();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    // only from the phone: an audiobook is downloaded to be listened to (no streaming). A part not here yet is got
    // first, and plays the moment it's in.
    if (!here(id, n, m)) {
      want = { id, n, t, play };
      if (!dl[id + ":" + n]) { toast("Downloading the audiobook… it starts playing as soon as this part is on the phone."); getAll(id, n); }
      else toast("This part is still downloading: it plays as soon as it's in.");
      paint();
      return;
    }
    want = null;
    // from the app's own little media server: WebView's handling of seeks into a big file stalls part-way through
    // (the freezing at one point), so the video and music players use it too
    const name = fname(id, n, m);
    let src = (A && A.mediaUrl && A.mediaUrl(name)) || "";
    if (!src && A && A.mediaUrlAsync) src = (await A.mediaUrlAsync(name)) || "";
    if (my !== loading) return;                     // (another part was asked for meanwhile)
    audio.src = src || "/local/" + encodeURIComponent(name);
    audio.playbackRate = audio.defaultPlaybackRate = L.rate || 1;
    stuck = 0; lastT = -1;
    const go = () => {
      if (my !== loading) return;
      try { audio.currentTime = Math.max(0, Math.min((audio.duration || 1e9) - 1, t || 0)); } catch (e) {}
      if (play) audio.play().catch(() => { if (my === loading) paint(); });
    };
    if (audio.readyState >= 1) go(); else audio.addEventListener("loadedmetadata", go, { once: true });
    session();
  }
  /** play an item's audiobook: from opts {ch, t}, or where you left it */
  async function play(id, opts) {
    const m = await manifest(id);
    if (!m) return toast(S.conn.token ? "Couldn't get the audiobook from your computer." : "This audiobook isn't on the phone.");
    if (window.Jukebox) try { Jukebox.pauseForVideo(); } catch (e) {}
    if (L.id && L.id !== id) save(false);
    L.id = id; M = m;
    let ch = opts && opts.ch, t = opts && opts.t;
    if (ch == null) { const p = posOf(S.items[id]); if (p && !p.done) { ch = p.ch || 0; t = p.t || 0; } }
    ch = Math.max(0, Math.min(m.chapters.length - 1, ch || 0));
    await loadCh(ch, Math.max(0, (t || 0) - (opts ? 0 : 1.5)), true);
  }
  function toggle() { if (!L.id || !audio.src) return L.id ? play(L.id) : null; if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
  function pause() { if (!audio.paused) audio.pause(); }
  /** stop: your place is kept, the audio is let go of and the little bar goes away (Listen carries on from there) */
  function stop() {
    if (!audio.src) return;
    save(false);
    audio.pause();
    audio.removeAttribute("src"); audio.load();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    if ("mediaSession" in navigator) try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = "none"; } catch (e) {}
    paint();
  }
  function skip(s) { if (audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration - 0.5, audio.currentTime + s)); }
  function chapter(d) { if (!M) return; const n = Math.max(0, Math.min(M.chapters.length - 1, L.ch + d)); loadCh(n, 0, !audio.paused || true); }
  function setRate(r) { L.rate = r; audio.playbackRate = audio.defaultPlaybackRate = r; keep(); paint(); }
  /** your place: saved (and synced), and the progress bar follows it */
  function save(done) {
    if (!L.id || !M) return;
    const it = S.items[L.id];
    if (!it) return;
    const t = audio.currentTime || 0;
    savedAt = Date.now();
    const f = done && L.ch >= M.chapters.length - 1 ? 1 : fracAt(M, L.ch, t);
    const fields = { audio_pos: JSON.stringify({ ch: L.ch, t: Math.round(t * 100) / 100, done: !!done, f: Math.round(f * 1e4) / 1e4 }) };
    if (it.kind !== "music") fields.progress = Math.round(f * 1e4) / 1e4;
    change(L.id, fields);
  }
  audio.addEventListener("timeupdate", () => {
    if (!audio.paused && Date.now() - savedAt > 15000) save(false);
    for (const f of ticks) try { f(); } catch (e) {}
    paintTime();
  });
  audio.addEventListener("pause", () => { save(false); paint(); });
  audio.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    const e = audio.error;
    toast(`This part couldn't be played${e ? " (" + ({ 1: "stopped", 2: "couldn't read it", 3: "couldn't decode it", 4: "the phone can't play this kind of file" }[e.code] || "error " + e.code) + ")" : ""}.`);
    paint();
  });
  audio.addEventListener("play", () => { if (window.Jukebox) try { Jukebox.pauseForVideo(); } catch (e) {} paint(); session(); });
  audio.addEventListener("ended", () => {
    if (M && L.ch + 1 < M.chapters.length) loadCh(L.ch + 1, 0, true);
    else { save(true); paint(); }
  });
  // playing but not moving for ~9 s (the phone's player got stuck): the part is opened again at the same place
  setInterval(() => {
    if (!audio.getAttribute("src") || audio.paused || audio.ended || want) { stuck = 0; return; }
    const t = audio.currentTime || 0;
    if (Math.abs(t - lastT) < 0.05) stuck++; else { stuck = 0; revived = 0; }
    lastT = t;
    if (stuck >= 3 && revived < 3) { stuck = 0; revived++; loadCh(L.ch, t + 0.3, true); }
  }, 3000);
  function session() {
    if (!("mediaSession" in navigator) || !M) return;
    const it = S.items[L.id] || {}, c = M.chapters[L.ch] || {};
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: c.title || it.title || "", artist: (it.authors || [])[0] || "", album: it.title || "" });
      navigator.mediaSession.setActionHandler("play", toggle); navigator.mediaSession.setActionHandler("pause", toggle);
      navigator.mediaSession.setActionHandler("seekbackward", () => skip(-30)); navigator.mediaSession.setActionHandler("seekforward", () => skip(30));
      try { navigator.mediaSession.setActionHandler("stop", stop); } catch (e) {}
      navigator.mediaSession.setActionHandler("previoustrack", () => chapter(-1)); navigator.mediaSession.setActionHandler("nexttrack", () => chapter(1));
    } catch (e) {}
  }

  /* ---------------- keeping it on the phone (for offline) */
  const dl = load("abdl.json", {});                       // "id:n" -> download id
  const keepDl = () => store("abdl.json", dl);
  let dlTimer = null;
  async function getAll(id, first) {
    const m = await manifest(id);
    if (!m) return;
    if (A && A.freeSpace && A.freeSpace() < 300e6) return toast("Not enough space on the phone for this audiobook.");
    let n0 = 0;
    // (the part you're about to listen to first, then the rest in order)
    const order = m.chapters.map((_, n) => n);
    if (first != null && first > 0) order.unshift(...order.splice(first, m.chapters.length - first));
    for (const n of order) {
      if (here(id, n, m) || dl[id + ":" + n]) continue;
      const r = await bridge("downloadPath", `/sync/item/${id}/audio/${n}`, fname(id, n, m), `${(S.items[id] || {}).title || "Audiobook"} · ${m.chapters[n].title}`);
      if (r.status !== 200) { toast(r.text || "Couldn't start the download."); break; }
      dl[id + ":" + n] = Number(r.text); n0++;
    }
    keepDl();
    if (n0 && first == null) toast(`Downloading the audiobook (${n0} ${n0 === 1 ? "part" : "parts"})…`);
    watch();
  }
  function watch() {
    clearTimeout(dlTimer);
    const keys = Object.keys(dl);
    if (!keys.length || !A) return paint();
    let st = {};
    try { st = JSON.parse(A.downloads(JSON.stringify(keys.map((k) => dl[k])))); } catch (e) {}
    let changed = false;
    for (const k of keys) {
      const s = st[dl[k]];
      if (!s || s.state === "done") { delete dl[k]; changed = true; }
      else if (s.state === "failed") { delete dl[k]; changed = true; toast("Part of the audiobook couldn't be got. Try ⬇ again."); }
    }
    if (changed) {
      keepDl(); refreshFiles();
      // the part you pressed play on has arrived: it plays now
      if (want && want.id === L.id && M && here(want.id, want.n, M)) { const w = want; want = null; loadCh(w.n, w.t, w.play); }
    }
    paint(); paintSheet();
    if (Object.keys(dl).length) dlTimer = setTimeout(watch, 1500);
  }
  function removeAll(id) {
    const m = mcache[id] || load(`ab-${id}.json`, null);
    if (!m) return;
    for (const k of Object.keys(dl)) if (k.startsWith(id + ":")) { try { A.cancelDownload(dl[k]); } catch (e) {} delete dl[k]; }
    keepDl();
    m.chapters.forEach((_, n) => { if (here(id, n, m)) A.deleteFile(fname(id, n, m)); });
    refreshFiles(); setTimeout(paintSheet, 300);
    toast("Removed from the phone (download it again to listen)");
    paint();
  }
  const getting = (id) => Object.keys(dl).filter((k) => k.startsWith(id + ":")).length;
  /** the audiobook's download button for the book's page */
  function sheetButton(it) {
    const m = mcache[it.id] || load(`ab-${it.id}.json`, null), busy = getting(it.id);
    if (m && allHere(it.id, m)) return `<button class="btn sm" data-ab-rmid="${it.id}">✓ Audiobook on phone · remove</button>`;
    if (busy) return `<span class="hint ab-sheet-dl">⬇ Downloading the audiobook… ${m ? m.chapters.length - busy + " of " + m.chapters.length + " parts" : ""}</span>`;
    return `<button class="btn" data-ab-getid="${it.id}">⬇ Download audiobook</button>`;
  }
  function paintSheet() {
    const sh = $("#sheet");
    if (!sh || !S.sheetId) return;
    const slot = sh.querySelector("[data-ab-slot]"), it = S.items[S.sheetId];
    if (slot && it) slot.innerHTML = sheetButton(it);
  }

  /* ---------------- the player window and the little bar */
  function bar() {
    let b = $("#abBar");
    if (!b) {
      b = document.createElement("div");
      b.id = "abBar"; b.className = "ab-bar";
      b.innerHTML = `<button class="ab-bar-main" data-ab-open></button><button class="ab-bar-pp" data-ab-pp aria-label="Play or pause"></button><button class="ab-bar-x" data-ab-stop aria-label="Stop">✕</button>`;
      document.body.append(b);
    }
    return b;
  }
  // (beside the side tabs like the music bar; the page and the corner buttons move up while it's there: app.css)
  function placeBar(show) { document.body.classList.toggle("has-ab", !!show); }
  function paint() {
    const it = L.id && S.items[L.id];
    const b = bar();
    const show = !!(it && audio.src && !open && !(typeof Reader !== "undefined" && Reader.open));
    b.hidden = !show;
    placeBar(show);
    if (show) {
      const c = M && M.chapters[L.ch];
      b.querySelector("[data-ab-open]").innerHTML = `<span class="ab-bar-ic">🎧</span><span><b>${esc(it.title || "")}</b><small>${esc(c ? c.title : "")}</small></span>`;
      b.querySelector("[data-ab-pp]").textContent = audio.paused ? "▶" : "❚❚";
    }
    if (open) paintWin();
  }
  function paintTime() {
    const w = $("#abWin");
    if (!w || !M) return;
    const d = audio.duration || (M.chapters[L.ch] || {}).duration || 0, t = audio.currentTime || 0;
    const sl = w.querySelector("#abSeek");
    if (sl && document.activeElement !== sl) { sl.max = d; sl.value = t; }
    const tm = w.querySelector("#abTime");
    if (tm) tm.textContent = `${fmt(t)} / ${fmt(d)}`;
    const tot = M.chapters.reduce((a, c) => a + c.duration, 0), done = M.chapters.slice(0, L.ch).reduce((a, c) => a + c.duration, 0) + t;
    const left = w.querySelector("#abLeft");
    if (left) left.textContent = `${Math.round(100 * fracAt(M, L.ch, t))}% through the book · ${fmt((tot - done) / (L.rate || 1))} left`;
  }
  async function openWin(it) {
    const m = await manifest(it.id);
    if (!m) return toast(S.conn.token ? "Couldn't get the audiobook from your computer." : "This audiobook isn't on the phone.");
    if (L.id !== it.id || !audio.src) {           // (another book, or nothing loaded since the app started)
      if (L.id && L.id !== it.id && audio.src) { save(false); pause(); }
      const p = posOf(it); L.ch = p && !p.done ? p.ch || 0 : 0;
      if (L.id !== it.id) audio.removeAttribute("src");
      L.id = it.id; keep();
    }
    M = m;
    open = true;
    let w = $("#abWin");
    if (!w) { w = document.createElement("div"); w.id = "abWin"; w.className = "ab-win"; document.body.append(w); }
    w.hidden = false;
    paintWin();
    paint();
  }
  function closeWin() { open = false; const w = $("#abWin"); if (w) w.hidden = true; paint(); }
  function paintWin() {
    const w = $("#abWin");
    if (!w || !M) return;
    const it = S.items[L.id] || {}, c = M.chapters[L.ch] || {};
    const p = posOf(it), started = !!audio.src;
    const kept = allHere(L.id, M), busy = getting(L.id);
    const book = (it.file_type === "epub" || it.file_type === "pdf") && hereAny(it);
    const align = M.source === "narrated" ? (M.align || {}).status : "done";
    w.innerHTML = `<div class="ab-top"><button class="back" data-ab-close aria-label="Close">⌄</button><span>Audiobook</span>${started ? `<button class="ab-stop" data-ab-stop>■ Stop</button>` : "<span></span>"}</div>
      <div class="ab-art">${cover(it, false)}</div>
      <h2>${esc(it.title || "")}</h2><p class="ab-by">${esc((it.authors || []).join(", "))}</p>
      <p class="ab-ch"><b>${esc(c.title || "")}</b> · ${M.chapters.length > 1 ? `chapter ${L.ch + 1} of ${M.chapters.length}` : "one part"}</p>
      <input type="range" id="abSeek" class="ab-seek" min="0" step="1" value="0">
      <div class="ab-times"><span id="abTime"></span><span id="abLeft"></span></div>
      <div class="ab-ctl"><button data-ab-ch="-1" aria-label="Previous chapter">⏮</button><button data-ab-skip="-30" aria-label="Back 30 seconds">↺30</button>
        <button class="ab-pp" data-ab-pp aria-label="Play or pause">${started && !audio.paused ? "❚❚" : "▶"}</button>
        <button data-ab-skip="30" aria-label="Forward 30 seconds">30↻</button><button data-ab-ch="1" aria-label="Next chapter">⏭</button></div>
      ${!started && p && !p.done && (p.ch || p.t > 20) ? `<p class="hint ab-resume">Carries on from ${M.chapters.length > 1 ? `chapter ${(p.ch || 0) + 1}, ` : ""}${fmt(p.t)}</p>` : ""}
      <div class="ab-rates">${RATES.map((r) => `<button class="${(L.rate || 1) === r ? "on" : ""}" data-ab-rate="${r}">${r}×</button>`).join("")}</div>
      <div class="btns ab-acts">
        ${book ? `<button class="btn" data-ab-read>📖 Read along</button>` : ""}
        ${kept ? `<span class="hint">✓ Downloaded</span><button class="btn sm danger" data-ab-rm>Remove from phone</button>`
          : busy ? `<span class="hint">⬇ Downloading… ${M.chapters.length - busy} of ${M.chapters.length} parts</span>`
          : `<button class="btn primary" data-ab-get>⬇ Download to listen</button>`}
      </div>
      ${align === "running" || align === "waiting" ? `<p class="hint">The computer is still matching it to the book's text for read-along.</p>` : ""}
      <details class="ab-list"${M.chapters.length > 1 ? "" : " hidden"}><summary>Chapters</summary><ol>${M.chapters.map((x, n) => `<li><button data-ab-go="${n}" class="${n === L.ch ? "on" : ""}"><span>${esc(x.title)}</span><small>${fmt(x.duration)}${here(L.id, n, M) ? " · ✓" : ""}</small></button></li>`).join("")}</ol></details>`;
    paintTime();
    w.querySelector("#abSeek").oninput = (e) => { if (audio.src) audio.currentTime = Number(e.target.value); };
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-ab-stop],[data-ab-open],[data-ab-pp],[data-ab-close],[data-ab-skip],[data-ab-ch],[data-ab-rate],[data-ab-go],[data-ab-get],[data-ab-rm],[data-ab-read],[data-listen-open],[data-ab-getid],[data-ab-rmid]");
    if (!t) return;
    if (t.dataset.abGetid) { getAll(Number(t.dataset.abGetid)).then(paintSheet); paintSheet(); return; }
    if (t.dataset.abRmid) { if (confirm("Remove this audiobook from the phone? You can download it again.")) removeAll(Number(t.dataset.abRmid)); return; }
    if (t.dataset.listenOpen) { const it = S.items[t.dataset.listenOpen]; if (it) openWin(it); return; }
    if (t.hasAttribute("data-ab-open")) { const it = S.items[L.id]; if (it) openWin(it); return; }
    if (t.hasAttribute("data-ab-close")) return closeWin();
    if (t.hasAttribute("data-ab-stop")) { stop(); if (open) closeWin(); return toast("Stopped. Listen carries on from here."); }
    if (t.hasAttribute("data-ab-pp")) { if (!audio.src && L.id) return play(L.id); return toggle(); }
    if (t.dataset.abSkip) return skip(Number(t.dataset.abSkip));
    if (t.dataset.abCh) return audio.src ? chapter(Number(t.dataset.abCh)) : play(L.id, { ch: Math.max(0, Math.min(M.chapters.length - 1, L.ch + Number(t.dataset.abCh))), t: 0 });
    if (t.dataset.abRate) return setRate(Number(t.dataset.abRate));
    if (t.dataset.abGo) return play(L.id, { ch: Number(t.dataset.abGo), t: 0 });
    if (t.hasAttribute("data-ab-get")) return getAll(L.id);
    if (t.hasAttribute("data-ab-rm")) return removeAll(L.id);
    if (t.hasAttribute("data-ab-read")) { const it = S.items[L.id]; closeWin(); if (it) readHere(it); }
  });
  addEventListener("resize", () => paint());
  setTimeout(() => { if (Object.keys(dl).length) watch(); }, 1500);

  return {
    audio, play, pause, stop, toggle, open: openWin, manifest, sheetButton, posOf, fracAt, posAt, paint,
    state: () => ({ id: L.id, ch: L.ch, t: audio.currentTime || 0, playing: !!audio.src && !audio.paused, loaded: !!audio.src }),
    onTick: (f) => ticks.add(f), offTick: (f) => ticks.delete(f),
  };
})();
