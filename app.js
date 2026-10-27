// ---------- Armazenamento (IndexedDB) ----------
// guides: conteudo do guia. progress: itens feitos e grupos abertos, por guia. meta: lista de jogos.
const OLD_KEY = 'platinas.v1';
const $ = (s) => document.querySelector(s);
const view = $('#view'), title = $('#title'), actions = $('#actions'), back = $('#back');

const idb = new Promise((ok, fail) => {
  const r = indexedDB.open('platinas', 1);
  r.onupgradeneeded = () => ['guides', 'progress', 'meta'].forEach((s) => r.result.createObjectStore(s));
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
const tx = async (store, mode, fn) => {
  const db = await idb;
  return new Promise((ok, fail) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => ok(req && req.result);
    t.onerror = () => fail(t.error);
  });
};
const get = (s, k) => tx(s, 'readonly', (o) => o.get(k));
const put = (s, k, v) => tx(s, 'readwrite', (o) => o.put(v, k));
const del = (s, k) => tx(s, 'readwrite', (o) => o.delete(k));
const all = async (s) => {
  const db = await idb;
  return new Promise((ok) => {
    const out = {}, c = db.transaction(s).objectStore(s).openCursor();
    c.onsuccess = () => { const x = c.result; if (x) { out[x.key] = x.value; x.continue(); } else ok(out); };
  });
};

let guides = {};   // id -> {id, game, name, tree, total}
let progress = {}; // id -> {done:{ordinal:1}, open:{groupId:1}}
let games = [];    // nomes das pastas
let route = { name: 'home' };

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Formato de texto ----------
// "# t" / "## t" / "### t" = grupo. "- t" ou linha solta = item. "> t" = detalhe do item (ou do grupo, antes do 1o item).
// "[x] t" = item ja feito. Ids: grupos "g<n>" por ordem, itens numerados por ordem (n).
function parse(text) {
  const root = { g: 1, x: '', c: [], d: [], id: 'g0' };
  const stack = [{ depth: 0, node: root }];
  let gid = 1, n = 0, last = null;
  const done = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^(#{1,6})\s*(.+)/))) {
      const depth = m[1].length;
      while (stack[stack.length - 1].depth >= depth) stack.pop();
      const g = { g: 1, x: m[2], c: [], d: [], id: 'g' + gid++ };
      stack[stack.length - 1].node.c.push(g);
      stack.push({ depth, node: g });
      last = g;
    } else if ((m = line.match(/^>\s*(.*)/))) {
      let k;
      if (last && !last.g && (k = m[1].match(/^@img\s+(\S+)/))) last.i = k[1];
      else if (last && !last.g && (k = m[1].match(/^@link\s+(\S+)/))) last.l = k[1];
      else (last || root).d.push(m[1]);
    } else {
      const it = { x: line.replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]?\]\s*/, ''), n: n++, d: [] };
      if (/^(?:[-*+]\s+)?\[[xX]\]/.test(line)) done[it.n] = 1;
      stack[stack.length - 1].node.c.push(it);
      last = it;
    }
  }
  return { tree: root.c, notes: root.d, total: n, done };
}
const toText = (tree, notes = [], done = {}) => {
  const out = notes.map((d) => '> ' + d);
  const walk = (nodes, depth) => nodes.forEach((x) => {
    if (x.g) {
      out.push('#'.repeat(depth) + ' ' + x.x);
      x.d.forEach((d) => out.push('> ' + d));
      walk(x.c, depth + 1);
    } else {
      out.push((done[x.n] ? '[x] ' : '- ') + x.x);
      if (x.i) out.push('> @img ' + x.i);
      if (x.l) out.push('> @link ' + x.l);
      x.d.forEach((d) => out.push('> ' + d));
    }
  });
  walk(tree, 1);
  return out.join('\n');
};

// contagem [feitos, total] de um grupo
const count = (node, done) => {
  let d = 0, t = 0;
  for (const c of node.c) {
    if (c.g) { const r = count(c, done); d += r[0]; t += r[1]; } else { t++; if (done[c.n]) d++; }
  }
  return [d, t];
};
const guideStats = (g) => {
  const done = progress[g.id]?.done || {};
  const [d, t] = count({ c: g.tree }, done);
  return { d, t, pct: t ? Math.round((d / t) * 100) : 0 };
};

// Itens ligados entre guias ("@link guia:n"): marcar um marca o outro, nos dois sentidos.
let linkAdj = {};
function buildLinks() {
  linkAdj = {};
  const walk = (gid, nodes) => nodes.forEach((x) => {
    if (x.g) return walk(gid, x.c);
    if (!x.l) return;
    const a = gid + ':' + x.n;
    (linkAdj[a] ||= []).push(x.l);
    (linkAdj[x.l] ||= []).push(a);
  });
  Object.values(guides).forEach((g) => walk(g.id, g.tree));
}
async function propagate(gid, n, val) {
  for (const t of linkAdj[gid + ':' + n] || []) {
    const [tg, tn] = [t.slice(0, t.lastIndexOf(':')), t.slice(t.lastIndexOf(':') + 1)];
    if (!guides[tg]) continue;
    const pr = (progress[tg] ||= { done: {}, open: {} });
    if (val) pr.done[tn] = 1; else delete pr.done[tn];
    await saveProgress(tg);
  }
}
// Ao importar um guia ligado, herda o que ja estava marcado no outro lado.
async function pullLinks(gid) {
  const g = guides[gid], pr = (progress[gid] ||= { done: {}, open: {} });
  const walk = (nodes) => nodes.forEach((x) => {
    if (x.g) return walk(x.c);
    if (!x.l) return;
    const i = x.l.lastIndexOf(':');
    if (progress[x.l.slice(0, i)]?.done[x.l.slice(i + 1)]) pr.done[x.n] = 1;
  });
  walk(g.tree);
  await saveProgress(gid);
}

async function saveGuide(g) { await put('guides', g.id, g); }
const saveProgress = (id) => put('progress', id, progress[id]);
const saveGames = () => put('meta', 'games', games);

async function init() {
  guides = await all('guides');
  progress = await all('progress');
  games = (await get('meta', 'games')) || [];
  await migrateOld();
  await syncLibrary();
  buildLinks();
  Object.values(guides).forEach((g) => g.game && !games.includes(g.game) && games.push(g.game));
  render();
}

// Guias da pasta guides/ entram sozinhos na primeira abertura. Guia excluido pelo usuario nao volta.
async function syncLibrary() {
  const libNew = [];
  let list;
  try { list = await (await fetch('guides/index.json')).json(); } catch { return; }
  const skip = (await get('meta', 'libSkip')) || [];
  for (const e of list) {
    const id = 'lib-' + e.file;
    if (skip.includes(id)) continue;
    if (guides[id]) {
      // Guia ja importado: so soma marcacoes novas (rev maior), nunca desmarca nada.
      if ((guides[id].rev || 0) >= (e.rev || 0)) continue;
      try {
        const p = parse(await (await fetch('guides/' + e.file)).text());
        if (p.total === guides[id].total) {
          Object.assign((progress[id] ||= { done: {}, open: {} }).done, p.done);
          guides[id].rev = e.rev || 0;
          await saveGuide(guides[id]); await saveProgress(id);
        }
      } catch { /* sem rede */ }
      continue;
    }
    try {
      const p = parse(await (await fetch('guides/' + e.file)).text());
      const g = { id, game: e.game, name: e.name, tree: p.tree, notes: p.notes, total: p.total, rev: e.rev || 0 };
      guides[id] = g;
      progress[id] = { done: p.done, open: {} };
      if (!games.includes(e.game)) { games.push(e.game); await saveGames(); }
      await saveGuide(g); await saveProgress(id);
      libNew.push(id);
    } catch { /* sem rede: tenta na proxima abertura */ }
  }
  if (libNew.length) { buildLinks(); for (const id of libNew) await pullLinks(id); }
}

// Guias do formato antigo (localStorage) viram guias novos uma unica vez.
async function migrateOld() {
  let old;
  try { old = JSON.parse(localStorage.getItem(OLD_KEY)); } catch { return; }
  if (!old?.guides?.length) return;
  for (const o of old.guides) {
    const g = { id: o.id, game: o.game || 'Sem jogo', name: o.name, tree: [], notes: [] };
    let grp = null, n = 0;
    const done = {};
    for (const b of o.blocks) {
      if (b.t === 'h') { grp = { g: 1, x: b.x, c: [], d: [], id: 'g' + (g.tree.length + 1) }; g.tree.push(grp); }
      else if (b.t === 'i') { const it = { x: b.x, n: n++, d: [] }; if (b.d) done[it.n] = 1; (grp ? grp.c : g.tree).push(it); }
    }
    g.total = n;
    guides[g.id] = g;
    progress[g.id] = { done, open: {} };
    await saveGuide(g); await saveProgress(g.id);
  }
  localStorage.removeItem(OLD_KEY);
}

// ---------- Navegacao ----------
function go(r) { route = r; render(); window.scrollTo(0, 0); }
back.onclick = () => go(route.name === 'read' || route.name === 'edit' && route.id
  ? { name: 'game', game: guides[route.id]?.game } : { name: route.game ? 'game' : 'home', game: route.game });

function render() {
  back.hidden = route.name === 'home';
  actions.innerHTML = '';
  $('#hbar').innerHTML = '';
  ({ home, game: gameView, edit, read }[route.name])();
}

const bar = (p) => `<div class="bar${p >= 100 ? ' full' : ''}"><i style="width:${p}%"></i></div>`;

// Icones so estetica: por tipo de item e por regiao do grupo.
const ITEM_ICONS = [
  [/^Main Quest|^Ciri/, '⚔️'], [/^Achievement|^Secret/, '🏆'], [/^Secondary Quest|^Treasure|^Scavenger|^Kaer Morhen Ally/, '📜'],
  [/^Witcher Contract/, '🐺'], [/^(HoS|Hos|B&W|DLC)/, '🗡️'], [/^Nightmare/, '👻'],
  [/^(Unique|Gwent Card)/, '🃏'], [/^(Random|Gwent Player|Skellige Card)/, '🎴'],
];
const itemIcon = (t) => (ITEM_ICONS.find(([r]) => r.test(t)) || [0, '◆'])[1];
const GROUP_ICONS = [
  [/Cartas/, '🃏'], [/Velen/, '🌲'], [/Novigrad|Oxenfurt/, '🏙️'], [/Skellige|Faroe|Hindarsfjall|Undvik|Spikeroog|Kaer Trolde/, '⚓'],
  [/Toussaint|Beauclair/, '🍷'], [/Kaer Morhen/, '🏰'], [/White Orchard/, '🌾'], [/Vizima/, '👑'], [/Eastern|Painted/, '🌫️'],
];
const groupIcon = (t, depth) => (GROUP_ICONS.find(([r]) => r.test(t)) || [0, depth === 1 ? '📖' : '◈'])[1];
const pctOf = (d, t) => (t ? Math.round((d / t) * 100) : 0);

// ---------- Pastas de jogos ----------
function home() {
  title.textContent = 'Platinas';
  actions.innerHTML = '<button id="bk">Backup</button><button id="imp">Importar</button><button class="primary" id="newgame">+ Jogo</button>';
  $('#newgame').onclick = async () => {
    const n = (prompt('Nome do jogo:') || '').trim();
    if (n && !games.includes(n)) { games.push(n); await saveGames(); render(); }
  };
  $('#imp').onclick = () => importFile();
  $('#bk').onclick = exportBackup;
  if (!games.length) {
    view.innerHTML = '<p class="empty">Nenhum jogo ainda.<br>Toque em "+ Jogo" para criar uma pasta,<br>ou em "Importar" para abrir um guia ou backup.</p>';
    return;
  }
  view.innerHTML = games.map((n) => {
    const gs = Object.values(guides).filter((g) => g.game === n);
    const s = gs.map(guideStats).reduce((a, x) => ({ d: a.d + x.d, t: a.t + x.t }), { d: 0, t: 0 });
    const pct = s.t ? Math.round((s.d / s.t) * 100) : 0;
    return `<div class="card" data-game="${esc(n)}"><div style="flex:1"><b>📁 ${esc(n)}</b>
      <small>${gs.length} guia(s)${s.t ? ` · ${s.d}/${s.t} · ${pct}%` : ''}</small>${s.t ? bar(pct) : ''}</div></div>`;
  }).join('');
  view.querySelectorAll('.card').forEach((c) => (c.onclick = () => go({ name: 'game', game: c.dataset.game })));
}

function gameView() {
  const game = route.game;
  title.textContent = game;
  actions.innerHTML = '<button id="more">⋯</button><button id="imp">Importar</button><button class="primary" id="new">+ Guia</button>';
  $('#new').onclick = () => go({ name: 'edit', game });
  $('#imp').onclick = () => importFile(game);
  $('#more').onclick = async () => {
    const act = (prompt('Digite: renomear ou excluir') || '').trim().toLowerCase();
    if (act === 'renomear') {
      const n = (prompt('Novo nome:', game) || '').trim();
      if (!n || games.includes(n)) return;
      games[games.indexOf(game)] = n;
      for (const g of Object.values(guides)) if (g.game === game) { g.game = n; await saveGuide(g); }
      await saveGames(); go({ name: 'game', game: n });
    } else if (act === 'excluir' && confirm(`Excluir "${game}" e todos os guias dentro?`)) {
      for (const g of Object.values(guides)) if (g.game === game) { await del('guides', g.id); await del('progress', g.id); delete guides[g.id]; delete progress[g.id]; }
      games = games.filter((x) => x !== game); await saveGames(); go({ name: 'home' });
    }
  };
  const gs = Object.values(guides).filter((g) => g.game === game);
  if (!gs.length) { view.innerHTML = '<p class="empty">Pasta vazia.<br>Toque em "+ Guia" ou "Importar".</p>'; return; }
  view.innerHTML = gs.map((g) => {
    const s = guideStats(g);
    return `<div class="card" data-id="${g.id}"><div style="flex:1"><b>${esc(g.name)}</b><small>${s.d}/${s.t} · ${s.pct}%</small>${bar(s.pct)}</div></div>`;
  }).join('');
  view.querySelectorAll('.card').forEach((c) => (c.onclick = () => go({ name: 'read', id: c.dataset.id })));
}

// ---------- Editor ----------
function edit() {
  const g = guides[route.id];
  title.textContent = g ? 'Editar guia' : 'Novo guia';
  const raw = g ? toText(g.tree, g.notes, progress[g.id]?.done) : '';
  view.innerHTML = `
    <input id="name" placeholder="Nome do guia" value="${esc(g?.name || '')}">
    <textarea id="text" placeholder="# Seção&#10;## Subseção&#10;- item riscável&#10;> detalhe do item">${esc(raw)}</textarea>
    <p class="hint"># ## ### = grupos (recolhidos). "- " = item. "> " = detalhe do item acima. Dá para editar sem perder o progresso se a ordem dos itens não mudar.</p>
    <div class="row"><button class="primary" id="save">Salvar</button>${g ? '<button class="danger" id="del">Excluir</button>' : ''}</div>`;
  $('#save').onclick = async () => {
    const p = parse($('#text').value);
    if (!p.total) return alert('Guia vazio.');
    const rec = g || { id: uid(), game: route.game || 'Sem jogo' };
    Object.assign(rec, { name: $('#name').value.trim() || 'Sem nome', tree: p.tree, notes: p.notes, total: p.total });
    guides[rec.id] = rec;
    progress[rec.id] ||= { done: p.done, open: {} };
    await saveGuide(rec); await saveProgress(rec.id);
    buildLinks();
    go({ name: 'read', id: rec.id });
  };
  if (g) $('#del').onclick = async () => {
    if (!confirm('Excluir este guia?')) return;
    await del('guides', g.id); await del('progress', g.id);
    if (g.id.startsWith('lib-')) await put('meta', 'libSkip', [...((await get('meta', 'libSkip')) || []), g.id]);
    delete guides[g.id]; delete progress[g.id];
    go({ name: 'game', game: g.game });
  };
}

// ---------- Leitor ----------
function read() {
  const g = guides[route.id];
  if (!g) return go({ name: 'home' });
  const pr = (progress[g.id] ||= { done: {}, open: {} });
  title.textContent = g.name;
  actions.innerHTML = '<button id="hide">Ocultar feitos</button><button id="clr">Limpar</button><button id="ed">Editar</button>';
  $('#ed').onclick = () => go({ name: 'edit', id: g.id });
  // Limpar selecao: desmarca todos os itens deste guia (e os ligados em outros guias). Grupos abertos continuam.
  $('#clr').onclick = async () => {
    const ns = Object.keys(pr.done);
    if (!ns.length) return alert('Nada marcado neste guia.');
    if (!confirm(`Limpar a seleção de "${g.name}"? Isso desmarca ${ns.length} item(ns)` + (Object.keys(linkAdj).some((k) => k.startsWith(g.id + ':')) ? ' e os itens ligados em outros guias.' : '.'))) return;
    pr.done = {};
    await saveProgress(g.id);
    for (const n of ns) await propagate(g.id, n, false);
    render();
  };
  // Feitos continuam visiveis (so riscados). "Ocultar feitos" e opcional e comeca desligado a cada abertura.
  view.classList.remove('hidedone');
  $('#hide').onclick = () => {
    const on = view.classList.toggle('hidedone');
    $('#hide').textContent = on ? 'Mostrar feitos' : 'Ocultar feitos';
    view.querySelectorAll('.item.just').forEach((x) => x.classList.remove('just'));
  };

  view.innerHTML = '<div id="tree"></div>';
  const tree = $('#tree');
  const noteHtml = (d) => d.map((x) => `<p>${esc(x)}</p>`).join('');
  if (g.notes?.length) tree.insertAdjacentHTML('beforebegin', `<div class="note">${noteHtml(g.notes)}</div>`);

  const summary = () => {
    const s = guideStats(g);
    $('#hbar').innerHTML = `<div class="sumrow"><span>${esc(g.game)}</span><span><b>${s.pct}%</b> · ${s.d}/${s.t}</span></div>${bar(s.pct)}`;
  };
  const refreshCounts = () => {
    tree.querySelectorAll('[data-gid]').forEach((el) => {
      const [d, t] = count(el._node, pr.done);
      const gh = el.querySelector(':scope > .gh');
      gh.querySelector('.cnt').textContent = `${d}/${t}`;
      const p = pctOf(d, t);
      gh.querySelector('.gbar i').style.width = p + '%';
      el.classList.toggle('complete', t > 0 && d === t);
    });
    summary();
  };

  const itemEl = (it) => {
    const el = document.createElement('div');
    el.className = 'item' + (pr.done[it.n] ? ' done' : '');
    const hasD = it.d && it.d.length;
    const thumb = it.i ? `<img class="thumb" loading="lazy" crossorigin="anonymous" alt="" src="${esc(it.i)}">` : `<span class="ico">${itemIcon(it.x)}</span>`;
    el.innerHTML = `<span class="box"></span>${thumb}<div class="txt"><div class="ttl">${esc(it.x)}</div>${hasD ? '<div class="detail" hidden>' + noteHtml(it.d) + '</div>' : ''}</div>${hasD ? '<span class="more">ⓘ</span>' : ''}`;
    el.querySelector('.box').onclick = () => {
      if (pr.done[it.n]) delete pr.done[it.n]; else pr.done[it.n] = 1;
      el.classList.toggle('done', !!pr.done[it.n]);
      el.classList.add('just'); // nao some na hora, mesmo com "Ocultar feitos" ligado
      saveProgress(g.id); refreshCounts();
      propagate(g.id, it.n, !!pr.done[it.n]);
    };
    const im = el.querySelector('.thumb');
    if (im) im.onclick = () => {
      const big = el.classList.toggle('bigimg');
      im.src = big ? it.i.replace('/scale-to-width-down/200', '/scale-to-width-down/480') : it.i;
    };
    if (hasD) el.querySelectorAll('.txt, .more').forEach((x) => (x.onclick = () => { const dt = el.querySelector('.detail'); dt.hidden = !dt.hidden; }));
    return el;
  };

  const groupEl = (node, depth) => {
    const el = document.createElement('section');
    el.className = 'group d' + Math.min(depth, 3);
    el.dataset.gid = node.id;
    el._node = node;
    const [d, t] = count(node, pr.done);
    el.innerHTML = `<div class="gh"><div class="gtop"><span class="chev">▸</span><span class="ico">${groupIcon(node.x, depth)}</span><span class="gt">${esc(node.x)}</span><span class="tick">✔</span><span class="cnt">${d}/${t}</span></div><div class="gbar"><i style="width:${pctOf(d, t)}%"></i></div></div><div class="gb" hidden></div>`;
    const body = el.querySelector('.gb');
    const open = (state) => {
      body.hidden = !state;
      el.classList.toggle('open', state);
      if (state) fill();
      if (state) pr.open[node.id] = 1; else delete pr.open[node.id];
    };
    let filled = false;
    const fill = () => {
      if (filled) return;
      filled = true;
      if (node.d?.length) body.insertAdjacentHTML('beforeend', `<div class="note">${noteHtml(node.d)}</div>`);
      node.c.forEach((c) => body.appendChild(c.g ? groupEl(c, depth + 1) : itemEl(c)));
    };
    el.querySelector('.gh').onclick = () => { open(body.hidden); saveProgress(g.id); };
    if (pr.open[node.id]) open(true);
    return el;
  };

  g.tree.forEach((c) => tree.appendChild(c.g ? groupEl(c, 1) : itemEl(c)));
  refreshCounts();
}

// ---------- Importar / backup ----------
function importFile(game) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.txt,.md,.json,text/plain,application/json';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    const text = await f.text();
    if (f.name.endsWith('.json')) return importBackup(text);
    const p = parse(text);
    if (!p.total) return alert('Arquivo sem itens.');
    const name = (prompt('Nome do guia:', f.name.replace(/\.\w+$/, '')) || '').trim();
    if (!name) return;
    const gm = game || (prompt('Jogo (pasta):') || 'Sem jogo').trim();
    const g = { id: uid(), game: gm, name, tree: p.tree, notes: p.notes, total: p.total };
    guides[g.id] = g;
    progress[g.id] = { done: p.done, open: {} };
    if (!games.includes(gm)) { games.push(gm); await saveGames(); }
    await saveGuide(g); await saveProgress(g.id);
    go({ name: 'game', game: gm });
  };
  inp.click();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ v: 2, games, guides, progress })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'platinas-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { return alert('JSON inválido.'); }
  if (!b.guides || !confirm('Restaurar backup? Guias com o mesmo id serão substituídos.')) return;
  for (const g of Object.values(b.guides)) { guides[g.id] = g; await saveGuide(g); }
  for (const [id, p] of Object.entries(b.progress || {})) { progress[id] = p; await saveProgress(id); }
  (b.games || []).forEach((n) => !games.includes(n) && games.push(n));
  await saveGames(); go({ name: 'home' });
}

init();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
