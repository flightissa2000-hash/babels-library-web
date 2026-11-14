/* The library's layouts (the compass at the end of the kinds row): a list, a table, a progress board,
   an A–Z index, the star chart (the real sky, sky.js), a corkboard and a manga page. Each one is handed the same cards (a series is one card: its next volume, with
   the series' count) and their group labels; a card opens its item (data-item) or its series (data-lay-series). */
const LibLayouts = window.LibLayouts = (() => {
  const LIST = [
    ["list", "List", "One line each: cover, title, where you are", "☰"],
    ["table", "Table", "A sortable table: tap a heading to sort by it", "▤"],
    ["board", "Progress board", "Columns: up next, reading, on hold, not started, finished", "📋"],
    ["index", "A–Z index", "Alphabetical, a letter bar to jump; a series files under its name", "🔤"],
    ["stars", "Star chart", "The real night sky: each genre a region, each series its own constellation", "✨"],
    ["cork", "Corkboard", "Pinned polaroids with stamps", "📌"],
    ["panels", "Manga page", "Panels, screentone and speech bubbles, read right to left", "💥"],
  ];
  const has = (k) => LIST.some((l) => l[0] === k);
  const cur = () => (has(S.libLayout) ? S.libLayout : "list");

  const st = (it) => W.status(it);             // ["new"|"now"|"done"|"hold"|"dropped", label]
  const title = (it, s) => (s ? it.series : it.kind === "tv" ? it.series || it.title : it.title) || "Untitled";
  const sub = (it, s) => (s ? `${s.n} in the series · next: ${it.series_index ? "#" + +it.series_index + " " : ""}${it.title || ""}` : byline(it) || "");
  const open = (it, s) => (s ? `data-lay-series="${it.id}"` : `data-item="${it.id}"`);
  const bar = (it) => { const p = pct(it); return p > 1 ? `<span class="ll-bar"><i style="width:${p}%"></i></span>` : ""; };
  const groupsOf = (flat, labels) => { const g = []; flat.forEach((it, i) => { const l = labels[i] || ""; if (!g.length || g[g.length - 1][0] !== l) g.push([l, []]); g[g.length - 1][1].push(it); }); return g; };
  const hsh = (x) => { let h = 0; for (const c of String(x)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const named = (it, s) => esc(title(it, s)) + (s ? ` <i class="ll-sn">${s.n}</i>` : "");
  const no = (n) => String(n).padStart(3, "0");

  const R = {
    list(flat, labels, stacks) {
      return `<div class="ll ll-list">${groupsOf(flat, labels).map(([g, list]) => `<h3>${esc(g || "Everything")}<small>${list.length}</small></h3>${list.map((it) => {
        const s = stacks[it.id], [k, lab] = st(it), p = pct(it);
        return `<button class="ll-row st-${k}" ${open(it, s)}><span class="ll-cov">${cover(it, false)}</span><span class="ll-t"><b>${esc(title(it, s))}</b><small>${esc(sub(it, s))}</small></span>
          <span class="ll-r">${k !== "new" ? `<em>${esc(lab)}</em>` : ""}${p > 1 && p < 98 ? `<small>${p}%</small>` : ""}</span></button>`;
      }).join("")}`).join("")}</div>`;
    },
    table(flat, labels, stacks) {
      const k = S.libTableSort || "", dir = S.libTableDir || 1;
      const cols = [["title", "Title"], ["year", "Year"], ["status", "Status"], ["progress", "%"]];
      const val = (it) => ({ title: title(it, stacks[it.id]).toLowerCase(), year: parseInt(it.year) || 0, status: st(it)[0], progress: pct(it) })[k];
      const rows = (list) => (k ? [...list].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; }) : list);
      return `<div class="ll ll-table"><div class="lq-head">${cols.map(([c, n]) => `<button data-lq-sort="${c}" class="${k === c ? "on" : ""}">${n}${k === c ? (dir > 0 ? " ▲" : " ▼") : ""}</button>`).join("")}</div>
        ${groupsOf(flat, labels).map(([g, list]) => `<h3>${esc(g || "Everything")}<small>${list.length}</small></h3>${rows(list).map((it) => { const s = stacks[it.id], [sk, lab] = st(it), p = sk === "done" ? 100 : pct(it);
          return `<button class="lq-row" ${open(it, s)}><span class="lq-t"><b>${named(it, s)}</b><small>${esc(byline(it) || "")}</small></span><span class="lq-y">${esc(it.year || "")}</span><span class="lq-s s-${sk}">${sk === "new" ? "" : esc(lab)}</span><span class="lq-p">${p ? p + "%" : ""}</span></button>`; }).join("")}`).join("")}</div>`;
    },
    // the star chart: the computer's real night sky (sky.js), handed every book with its series whole again
    stars(flat, labels, stacks) {
      const groups = groupsOf(flat, labels).map(([g, list]) => [g || "Everything", list.flatMap((it) => (stacks[it.id] ? stacks[it.id].ids.map((id) => S.items[id]).filter(Boolean) : [it]))]);
      setTimeout(() => { const el = document.getElementById("skyRoot"); if (el && window.Sky) Sky.mount(el, groups); }, 0);
      return `<div class="sky" id="skyRoot"></div>`;
    },
    board(flat, labels, stacks) {
      const cols = [["next", "Up next"], ["now", "Reading"], ["hold", "On hold"], ["new", "Not started"], ["done", "Finished"]];
      const by = Object.fromEntries(cols.map(([k]) => [k, []]));
      for (const it of flat) { const k = st(it)[0]; (by[k === "dropped" ? "hold" : k] || by.new).push(it); }
      return `<div class="ll ll-board">${cols.map(([k, n]) => `<section class="lb-col c-${k}"><h3>${n}<small>${by[k].length}</small></h3>${by[k].map((it) => { const s = stacks[it.id];
        return `<button class="lb-card" ${open(it, s)}><span class="ll-cov">${cover(it, false)}</span><span><b>${named(it, s)}</b><small>${esc(byline(it) || "")}</small>${k === "now" ? bar(it) : ""}</span></button>`; }).join("") || `<p class="hint">Nothing here</p>`}</section>`).join("")}</div>`;
    },
    index(flat, labels, stacks) {
      const filing = (it) => title(it, stacks[it.id]).replace(/^(the|a|an)\s+/i, "");
      const all = [...flat].sort((a, b) => filing(a).localeCompare(filing(b), undefined, { sensitivity: "base" }));
      const by = new Map();
      for (const it of all) { const c = filing(it).charAt(0).toUpperCase(), l = /[A-Z]/.test(c) ? c : "#"; if (!by.has(l)) by.set(l, []); by.get(l).push(it); }
      return `<div class="ll ll-index"><nav class="li-az">${[..."#ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((l) => by.has(l) ? `<button data-az="${l === "#" ? "num" : l}">${l}</button>` : `<span>${l}</span>`).join("")}</nav>
        ${[...by].map(([l, list]) => `<section class="li-letter" id="laz-${l === "#" ? "num" : l}"><h3>${l}</h3>${list.map((it) => { const s = stacks[it.id];
          return `<button class="li-entry" ${open(it, s)}><b>${named(it, s)}</b> <small>${esc(byline(it) || "")}${it.year ? ", " + esc(it.year) : ""}</small>${st(it)[0] === "done" ? ` <span class="li-tick">✓</span>` : ""}</button>`; }).join("")}</section>`).join("")}</div>`;
    },
    cork(flat, labels, stacks) {
      const pins = ["#d9534f", "#f0ad4e", "#5bc0de", "#5cb85c"];
      return `<div class="ll ll-cork">${groupsOf(flat, labels).map(([g, list]) => `<h3 class="lc-tape">${esc(g || "Everything")}</h3><div class="lc-pins">${list.map((it) => {
        const s = stacks[it.id], k = st(it)[0];
        return `<button class="lc-pol" ${open(it, s)} style="--r:${(hsh(it.id + "r") % 9) - 4}deg;--pin:${pins[hsh(it.id) % 4]}"><span class="lc-photo">${cover(it, false)}</span><span class="lc-scrawl">${named(it, s)}</span>${k === "done" ? `<span class="lc-stamp">READ</span>` : k === "next" ? `<span class="lc-stamp next">NEXT</span>` : ""}</button>`;
      }).join("")}</div>`).join("")}</div>`;
    },
    panels(flat, labels, stacks) {
      const fx = ["ドン!", "ゴゴゴ", "バン!", "ザワ…", "キラ", "ドキ!"];
      return `<div class="ll ll-manga">${flat.map((it, i) => { const s = stacks[it.id], k = st(it)[0];
        return `<button class="mg-panel p${i % 7}" ${open(it, s)}>${cover(it, false)}<span class="mg-bubble">${esc(title(it, s))}</span>${k === "now" ? `<span class="mg-fx">${fx[i % fx.length]}</span>` : k === "done" ? `<span class="mg-fx done">完</span>` : ""}</button>`; }).join("")}</div>`;
    },
  };

  function html(flat, labels, stacks) {
    const k = cur();
    const lim = k === "stars" ? Infinity : S.limit || 60, cut = flat.length > lim;      // (the sky holds everything at once)
    const shown = cut ? flat.slice(0, lim) : flat;
    return R[k](shown, labels.slice(0, shown.length), stacks) + (cut ? `<button class="btn more" id="more">Show more (${flat.length - lim} more)</button>` : "");
  }
  // the compass: a round button at the end of the kinds row, opening the list of layouts
  const compass = () => `<span class="ll-compass"><button id="libCompass" aria-label="Layout" title="Layout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><path d="M15.8 8.2l-2.3 5.3-5.3 2.3 2.3-5.3z" fill="currentColor" stroke-linejoin="round"/></svg></button>
    <span class="ll-menu" hidden>${LIST.map(([k, n, d, z]) => `<button data-lay="${k}" class="${cur() === k ? "on" : ""}"><i>${z}</i><span><b>${esc(n)}</b><small>${esc(d)}</small></span></button>`).join("")}</span></span>`;
  document.addEventListener("click", (e) => {
    const t = e.target;
    const sr = t.closest("[data-lay-series]");
    if (sr) { const s = Deck.stacks[sr.dataset.laySeries]; if (s) Deck.openSeries(s); return; }
    if (t.closest("#libCompass")) { const m = document.querySelector(".ll-menu"); if (m) m.hidden = !m.hidden; return; }
    const ly = t.closest("[data-lay]"); if (ly) { S.libLayout = ly.dataset.lay; saveState(); return render(); }
    const ts = t.closest("[data-lq-sort]"); if (ts) { const k = ts.dataset.lqSort; S.libTableDir = S.libTableSort === k ? -(S.libTableDir || 1) : 1; S.libTableSort = k; return render(); }
    const az = t.closest("[data-az]"); if (az) { const el = document.getElementById("laz-" + az.dataset.az); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
    if (!t.closest(".ll-menu")) document.querySelectorAll(".ll-menu").forEach((m) => (m.hidden = true));
  });
  return { LIST, html, compass, cur };
})();

/* sky.js (shared with the computer) speaks the computer's helpers: these are the phone's versions of them */
window.seriesTogether ||= (items) => {
  const by = new Map();
  for (const it of items) if (inSeries(it)) { const k = seriesKey(it.series); if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
  const out = [], done = new Set();
  for (const it of items) { if (!inSeries(it)) { out.push(it); continue; } const k = seriesKey(it.series); if (done.has(k)) continue; done.add(k); out.push(...by.get(k).sort(seriesOrder)); }
  return out;
};
window.seriesRuns ||= (items) => { const runs = []; for (const it of items) { const l = runs[runs.length - 1]; if (l && inSeries(it) && inSeries(l[0]) && seriesKey(l[0].series) === seriesKey(it.series)) l.push(it); else runs.push([it]); } return runs; };
window.lvStatus ||= (it) => { const [k, w] = W.status(it); return { k: k === "now" ? "reading" : k === "dropped" ? "hold" : k, w: k === "new" ? "" : w }; };
window.pctOf ||= (it) => pct(it);
window.coverHTML ||= (it) => cover(it, false);
window.authorLine ||= (it) => byline(it) || "";
window.openDrawer ||= (id) => openSheet(id);
