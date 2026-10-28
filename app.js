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
      else if (last && !last.g && (k = m[1].match(/^@lt\s+(.+)/))) last.lt = k[1].trim();
      else if (last && !last.g && (k = m[1].match(/^@grp\s+(\S+)/))) last.grp = k[1];
      else if (last && !last.g && (k = m[1].match(/^@ico\s+(\S+)/))) last.ico = k[1];
      else if (last && !last.g && (k = m[1].match(/^@pow\s+(\d+)/))) last.p = k[1];
      else if (last && !last.g && (k = m[1].match(/^@tag\s+(.+)/))) (last.t ||= []).push(k[1].trim());
      else if (last && !last.g && (k = m[1].match(/^@copy\s+(\d+\/\d+)/))) last.c2 = k[1];
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
      if (x.lt) out.push('> @lt ' + x.lt);
      if (x.grp) out.push('> @grp ' + x.grp);
      if (x.ico) out.push('> @ico ' + x.ico);
      if (x.p) out.push('> @pow ' + x.p);
      (x.t || []).forEach((t) => out.push('> @tag ' + t));
      if (x.c2) out.push('> @copy ' + x.c2);
      x.d.forEach((d) => out.push('> ' + d));
    }
  });
  walk(tree, 1);
  return out.join('\n');
};

// contagem [feitos, total] de um grupo
// Chave estavel de cada item (titulo + n-esima ocorrencia): permite recuperar marcacoes quando um guia muda de estrutura.
const itemKeys = (tree) => {
  const seen = {}, out = [];
  const walk = (nodes) => nodes.forEach((x) => {
    if (x.g) return walk(x.c);
    seen[x.x] = (seen[x.x] || 0) + 1;
    out[x.n] = x.x + '#' + seen[x.x];
  });
  walk(tree);
  return out;
};
const doneKeys = (tree, done) => { const ks = itemKeys(tree); return Object.keys(done).map((n) => ks[n]).filter(Boolean); };
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
// "@link guia:n" aponta para o item n do outro guia; "@lt titulo" confere o titulo. Se o outro guia foi editado
// (itens mudaram de posicao), o vinculo segue o titulo quando ele e unico.
function buildLinks() {
  linkAdj = {};
  const ord = {}, titles = {};
  const index = (gid, nodes) => nodes.forEach((x) => {
    if (x.g) return index(gid, x.c);
    (ord[gid] ||= {})[x.n] = x;
    ((titles[gid] ||= {})[x.x] ||= []).push(x.n);
  });
  Object.values(guides).forEach((g) => index(g.id, g.tree));
  const walk = (gid, nodes) => nodes.forEach((x) => {
    if (x.g) return walk(gid, x.c);
    if (!x.l) return;
    const i = x.l.lastIndexOf(':');
    const tg = x.l.slice(0, i);
    let tn = x.l.slice(i + 1);
    if (x.lt && ord[tg]?.[tn]?.x !== x.lt) {
      const c = titles[tg]?.[x.lt];
      if (c && c.length === 1) tn = c[0];
    }
    x.rl = tg + ':' + tn;
    const a = gid + ':' + x.n;
    (linkAdj[a] ||= []).push(x.rl);
    (linkAdj[x.rl] ||= []).push(a);
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
// Ao abrir o app: se um lado de um vinculo esta marcado e o outro nao (edicao, offline), marca os dois.
async function reconcileLinks() {
  const touched = new Set();
  for (const [a, targets] of Object.entries(linkAdj)) {
    const [ag, an] = [a.slice(0, a.lastIndexOf(':')), a.slice(a.lastIndexOf(':') + 1)];
    if (!progress[ag]?.done[an]) continue;
    for (const t of targets) {
      const [tg, tn] = [t.slice(0, t.lastIndexOf(':')), t.slice(t.lastIndexOf(':') + 1)];
      if (!guides[tg]) continue;
      const pr = (progress[tg] ||= { done: {}, open: {} });
      if (!pr.done[tn]) { pr.done[tn] = 1; touched.add(tg); }
    }
  }
  for (const id of touched) await saveProgress(id);
}
async function pullLinks(gid) {
  const g = guides[gid], pr = (progress[gid] ||= { done: {}, open: {} });
  const walk = (nodes) => nodes.forEach((x) => {
    if (x.g) return walk(x.c);
    if (!x.rl) return;
    const i = x.rl.lastIndexOf(':');
    if (progress[x.rl.slice(0, i)]?.done[x.rl.slice(i + 1)]) pr.done[x.n] = 1;
  });
  walk(g.tree);
  await saveProgress(gid);
}

async function saveGuide(g) { await put('guides', g.id, g); }
const saveProgress = (id) => {
  if (guides[id] && progress[id]) progress[id].keys = doneKeys(guides[id].tree, progress[id].done);
  return put('progress', id, progress[id]);
};
const saveGames = () => put('meta', 'games', games);

// Copia automatica do progresso (no maximo 1 a cada 6 h, guarda as 6 ultimas) antes de qualquer atualizacao de guia.
async function snapshotProgress() {
  const snaps = (await get('meta', 'snaps')) || [];
  if (snaps.length && Date.now() - snaps[0].t < 6 * 3600 * 1000) return;
  if (!Object.values(progress).some((p) => Object.keys(p.done || {}).length)) return;
  snaps.unshift({ t: Date.now(), progress: JSON.parse(JSON.stringify(progress)) });
  await put('meta', 'snaps', snaps.slice(0, 6));
}

async function init() {
  try { navigator.storage?.persist?.(); } catch { /* sem suporte */ }
  guides = await all('guides');
  progress = await all('progress');
  games = (await get('meta', 'games')) || [];
  await snapshotProgress();
  await migrateOld();
  await syncLibrary();
  buildLinks();
  await reconcileLinks();
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
          if (!guides[id].edited) { guides[id].tree = p.tree; guides[id].notes = p.notes; }
          guides[id].rev = e.rev || 0;
          await saveGuide(guides[id]); await saveProgress(id);
          libNew.push(id);
        } else if (!guides[id].edited) {
          // Guia reestruturado: as marcacoes antigas seguem pelo titulo; os itens ligados voltam do outro guia (pullLinks).
          const oldDone = new Set();
          const oldPr = progress[id]?.done || {};
          const collect = (nodes) => nodes.forEach((x) => { if (x.g) collect(x.c); else if (oldPr[x.n]) oldDone.add(x.x.replace('cópia extra', 'cópia')); });
          collect(guides[id].tree);
          const done = { ...p.done };
          // Itens removidos do guia: alinha pela ordem dos titulos (o novo e o antigo menos alguns itens).
          const flat = (nodes, out = []) => { nodes.forEach((x) => (x.g ? flat(x.c, out) : (out[x.n] = x))); return out; };
          const oldItems = flat(guides[id].tree), newItems = flat(p.tree);
          const map = {};
          for (let i = 0, j = 0; i < oldItems.length && j < newItems.length; i++) if (oldItems[i].x === newItems[j].x) map[i] = j++;
          if (Object.keys(map).length === newItems.length) Object.keys(oldPr).forEach((i) => { if (map[i] != null) done[map[i]] = 1; });
          // alem do alinhamento: chaves (titulo + ocorrencia) guardadas junto com o progresso
          const oldKeys = new Set([...(progress[id]?.keys || []), ...doneKeys(guides[id].tree, oldPr)]);
          itemKeys(p.tree).forEach((k, n) => { if (oldKeys.has(k)) done[n] = 1; });
          Object.assign(guides[id], { tree: p.tree, notes: p.notes, total: p.total, rev: e.rev || 0 });
          progress[id] = { done, open: {} };
          await saveGuide(guides[id]); await saveProgress(id);
          libNew.push(id);
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
  buildLinks();
  for (const id of libNew) await pullLinks(id);
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
  $('#bk').onclick = async () => {
    const snaps = (await get('meta', 'snaps')) || [];
    const act = (prompt('Backup: digite "baixar" para salvar um arquivo' + (snaps.length ? ' ou "restaurar" para voltar a uma cópia automática anterior.' : '.')) || '').trim().toLowerCase();
    if (act === 'baixar') exportBackup();
    else if (act === 'restaurar' && snaps.length) {
      const list = snaps.map((s, i) => `${i + 1}) ${new Date(s.t).toLocaleString('pt-BR')} – ${Object.values(s.progress).reduce((a, p) => a + Object.keys(p.done || {}).length, 0)} marcações`).join('\n');
      const i = parseInt(prompt('Qual cópia restaurar?\n' + list), 10) - 1;
      if (snaps[i] && confirm('Restaurar essa cópia? O progresso atual será substituído.')) {
        for (const [id, p] of Object.entries(snaps[i].progress)) { progress[id] = p; await put('progress', id, p); }
        go({ name: 'home' });
      }
    }
  };
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
  const gs = Object.values(guides).filter((g) => g.game === game).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
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
    if (rec.id.startsWith('lib-')) rec.edited = true; // edicao do usuario nao e sobrescrita por novas versoes do guia
    guides[rec.id] = rec;
    // o texto traz [x] nos itens feitos: ele manda, assim inserir/apagar itens nao desloca as marcacoes
    progress[rec.id] = { done: p.done, open: progress[rec.id]?.open || {} };
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
  actions.innerHTML = '<button id="srch" aria-label="Buscar">🔍</button><button id="hide">Ocultar feitos</button><button id="clr">Limpar</button><button id="ed">Editar</button>';
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

  view.innerHTML = '<div id="sbar" hidden><input id="q" type="search" placeholder="Buscar neste guia (nome, texto, carta, facção…)" autocomplete="off"><div id="qinfo" class="hint"></div></div><div id="results" hidden></div><div id="links"></div><div id="tree"></div>';
  // Atalhos para guias ligados (ex.: guia principal <-> Cartas de Gwent): abrir e limpar so os itens ligados.
  const linked = {};
  Object.keys(linkAdj).filter((k) => k.startsWith(g.id + ':')).forEach((k) =>
    linkAdj[k].forEach((t) => { const tg = t.slice(0, t.lastIndexOf(':')); if (guides[tg]) (linked[tg] ||= []).push(k.slice(g.id.length + 1)); }));
  $('#links').innerHTML = Object.keys(linked).map((tg) => `<div class="linkbar"><button class="chip" data-open="${esc(tg)}">↗ ${esc(guides[tg].name)}</button><button class="chip danger" data-clear="${esc(tg)}">Limpar só estes itens</button></div>`).join('');
  $('#links').insertAdjacentHTML('beforeend', '<div class="linkbar"><button class="chip" id="collapse">⇡ Recolher tudo</button></div>');
  $('#collapse').onclick = async () => {
    pr.open = {};
    await saveProgress(g.id);
    render();
    window.scrollTo(0, 0);
  };
  $('#links').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => go({ name: 'read', id: b.dataset.open })));
  $('#links').querySelectorAll('[data-clear]').forEach((b) => (b.onclick = async () => {
    const ns = linked[b.dataset.clear].filter((n) => pr.done[n]);
    if (!ns.length) return alert('Nenhum desses itens está marcado.');
    if (!confirm(`Desmarcar ${ns.length} item(ns) ligados a "${guides[b.dataset.clear].name}" (aqui e lá)? O resto deste guia não muda.`)) return;
    for (const n of ns) delete pr.done[n];
    await saveProgress(g.id);
    for (const n of ns) await propagate(g.id, n, false);
    render();
  }));
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
    el.className = 'item' + (pr.done[it.n] ? ' done' : '') + ((it.t || []).some((t) => /perd/i.test(t)) ? ' missable' : '');
    el.dataset.n = it.n;
    const hasD = it.d && it.d.length;
    const img = it.i ? `<img class="thumb" loading="lazy" crossorigin="anonymous" alt="" src="${esc(it.i)}">` : '';
    const thumb = it.i ? `<div class="tw">${img}${it.p ? `<b class="pow" title="Poder">${esc(it.p)}</b>` : ''}</div>` : `<span class="ico">${it.ico || itemIcon(it.x)}</span>`;
    const meta = (it.t || it.c2) ? `<div class="meta">${(it.t || []).map((t) => `<span class="tag${/perd/i.test(t) ? ' warn' : ''}">${esc(t)}</span>`).join('')}${it.c2 ? `<span class="tag copy">cópia ${esc(it.c2)}</span>` : ''}</div>` : '';
    el.innerHTML = `<span class="box"></span>${thumb}<div class="txt"><div class="ttl">${esc(it.x)}</div>${meta}${hasD ? '<div class="detail" hidden>' + noteHtml(it.d) + '</div>' : ''}</div>${hasD ? '<span class="more">ⓘ</span>' : ''}`;
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

  // Itens seguidos com o mesmo "@grp" sao copias da mesma carta: uma linha, um quadradinho por copia.
  const cardEl = (members) => {
    const first = members[0];
    const el = document.createElement('div');
    el.className = 'item cardrow';
    el.dataset.n = first.n;
    const baseTitle = first.x.replace(/\s*\((\d+|cópia \d+)\)$/, '');
    const hasInfo = members.some((m) => m.d && m.d.length);
    const detail = members.map((m, i) => (m.d || []).length
      ? `<div class="dcopy">${members.length > 1 ? `<b>Cópia ${i + 1}:</b> ` : ''}${(m.d).map((x) => esc(x)).join('<br>')}</div>` : '').join('');
    el.innerHTML = `<div class="tw"><img class="thumb" loading="lazy" crossorigin="anonymous" alt="" src="${esc(first.i || '')}">${first.p ? `<b class="pow" title="Poder">${esc(first.p)}</b>` : ''}</div>
      <div class="txt"><div class="ttl">${esc(baseTitle)}</div>
      <div class="meta">${(first.t || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="sqrow"><span class="sqs"></span><span class="owned"></span></div>
      ${hasInfo ? `<div class="detail" hidden>${detail}</div>` : ''}</div>${hasInfo ? '<span class="more">ⓘ</span>' : ''}`;
    if (!first.i) el.querySelector('.tw').innerHTML = `<span class="ico">${itemIcon(first.x)}</span>`;
    const sqs = el.querySelector('.sqs'), owned = el.querySelector('.owned');
    const paint = () => {
      const d = members.filter((m) => pr.done[m.n]).length;
      owned.textContent = `${d}/${members.length}${members.length > 1 ? ' cópias' : ''}`;
      el.classList.toggle('done', d === members.length);
      el.classList.toggle('partial', d > 0 && d < members.length);
    };
    members.forEach((m, i) => {
      const b = document.createElement('button');
      b.className = 'sq' + (pr.done[m.n] ? ' on' : '');
      b.textContent = i + 1;
      b.title = `Cópia ${i + 1}`;
      b.onclick = (ev) => {
        ev.stopPropagation();
        if (pr.done[m.n]) delete pr.done[m.n]; else pr.done[m.n] = 1;
        b.classList.toggle('on', !!pr.done[m.n]);
        saveProgress(g.id); paint(); refreshCounts();
        propagate(g.id, m.n, !!pr.done[m.n]);
      };
      sqs.appendChild(b);
    });
    paint();
    const im = el.querySelector('.thumb');
    if (im) im.onclick = () => {
      const big = el.classList.toggle('bigimg');
      im.src = big ? first.i.replace('/scale-to-width-down/200', '/scale-to-width-down/480') : first.i;
    };
    if (hasInfo) el.querySelectorAll('.txt .ttl, .more').forEach((x) => (x.onclick = () => { const dt = el.querySelector('.detail'); dt.hidden = !dt.hidden; }));
    return el;
  };
  const appendNodes = (parent, nodes, depth) => {
    for (let i = 0; i < nodes.length; i++) {
      const c = nodes[i];
      if (c.g) { parent.appendChild(groupEl(c, depth)); continue; }
      if (c.grp) {
        const run = [c];
        while (nodes[i + 1] && !nodes[i + 1].g && nodes[i + 1].grp === c.grp) run.push(nodes[++i]);
        parent.appendChild(cardEl(run));
      } else parent.appendChild(itemEl(c));
    }
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
      appendNodes(body, node.c, depth + 1);
    };
    el.querySelector('.gh').onclick = () => { open(body.hidden); saveProgress(g.id); };
    if (pr.open[node.id]) open(true);
    return el;
  };

  // ---- Busca: procura em titulo, detalhe, etiquetas e nome dos grupos, mesmo com os grupos recolhidos ----
  const fold = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let flat = null;
  const buildFlat = () => {
    flat = [];
    const walk = (nodes, path) => nodes.forEach((x) => {
      if (x.g) return walk(x.c, [...path, x]);
      flat.push({ it: x, path, hay: fold([x.x, ...(x.d || []), ...(x.t || []), x.c2 || '', ...path.map((p) => p.x)].join(' \n ')) });
    });
    walk(g.tree, []);
  };
  const sbar = $('#sbar'), q = $('#q'), resEl = $('#results');
  const closeSearch = () => {
    sbar.hidden = resEl.hidden = true;
    tree.hidden = false; $('#links').hidden = false;
    q.value = '';
  };
  const runSearch = () => {
    const terms = fold(q.value).split(/\s+/).filter(Boolean);
    if (!terms.length) { resEl.hidden = true; tree.hidden = false; $('#links').hidden = false; $('#qinfo').textContent = ''; return; }
    flat ||= (buildFlat(), flat);
    const hits = flat.filter((f) => terms.every((t) => f.hay.includes(t)));
    tree.hidden = true; $('#links').hidden = true; resEl.hidden = false;
    $('#qinfo').textContent = `${hits.length} resultado(s)` + (hits.length > 100 ? ' (mostrando 100)' : '');
    resEl.innerHTML = '';
    hits.slice(0, 100).forEach((f) => {
      const wrap = document.createElement('div');
      wrap.className = 'hit';
      const el = itemEl(f.it);
      const where = f.path.map((p) => p.x).join(' › ');
      const inTitle = terms.every((t) => fold(f.it.x).includes(t));
      const snip = !inTitle && (f.it.d || []).find((l) => terms.some((t) => fold(l).includes(t)));
      wrap.innerHTML = `<div class="where">${esc(where)}</div>`;
      wrap.appendChild(el);
      if (snip) el.querySelector('.txt').insertAdjacentHTML('beforeend', `<div class="snip">${esc(snip.length > 140 ? snip.slice(0, 140) + '…' : snip)}</div>`);
      const go2 = document.createElement('button');
      go2.className = 'chip'; go2.textContent = 'Ir ao item ↘';
      go2.onclick = async () => {
        f.path.forEach((p) => (pr.open[p.id] = 1));
        await saveProgress(g.id);
        go({ name: 'read', id: g.id, jump: f.it.n });
      };
      wrap.appendChild(go2);
      resEl.appendChild(wrap);
    });
  };
  $('#srch').onclick = () => {
    if (sbar.hidden) { sbar.hidden = false; q.focus(); } else closeSearch();
  };
  let timer;
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(runSearch, 150); };
  q.onkeydown = (e) => { if (e.key === 'Escape') closeSearch(); };

  appendNodes(tree, g.tree, 1);
  if (route.jump != null) {
    const target = tree.querySelector(`.item[data-n="${route.jump}"]`) || [...tree.querySelectorAll('.cardrow')].find((r) => r.querySelector('.sq'));
    if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('flash'); }
    delete route.jump;
  }
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
