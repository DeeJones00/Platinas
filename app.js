const KEY = 'platinas.v1';
const $ = (s) => document.querySelector(s);
const view = $('#view'), title = $('#title'), actions = $('#actions'), back = $('#back');

let db = load();
let route = { name: 'home' };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { guides: [] }; }
  catch { return { guides: [] }; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
const uid = () => Math.random().toString(36).slice(2, 10);

// Texto -> blocos. "# x" = secao, "- x"/"* x"/"[ ] x"/linha = item riscavel, "> x" = nota.
function parse(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    let m;
    if ((m = l.match(/^#{1,6}\s*(.+)/))) return { t: 'h', x: m[1] };
    if ((m = l.match(/^>\s*(.+)/))) return { t: 'n', x: m[1] };
    return { t: 'i', x: l.replace(/^([-*+]|\d+[.)]|\[[ xX]?\])\s+/, ''), d: /^\[[xX]\]/.test(l) };
  });
}
const stats = (g) => {
  const it = g.blocks.filter((b) => b.t === 'i');
  const done = it.filter((b) => b.d).length;
  return { done, total: it.length, pct: it.length ? Math.round((done / it.length) * 100) : 0 };
};
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function go(r) { route = r; render(); window.scrollTo(0, 0); }
back.onclick = () => go(route.name === 'read' && route.from ? route.from : { name: 'home' });

function render() {
  back.hidden = route.name === 'home';
  actions.innerHTML = '';
  ({ home, edit, read }[route.name])();
}

function home() {
  title.textContent = 'Platinas';
  actions.innerHTML = '<button class="primary" id="new">+ Guia</button>';
  $('#new').onclick = () => go({ name: 'edit' });
  if (!db.guides.length) {
    view.innerHTML = '<p class="empty">Nenhum guia ainda.<br>Toque em "+ Guia" e cole o texto.</p>';
    return;
  }
  const games = {};
  db.guides.forEach((g) => (games[g.game || 'Sem jogo'] ||= []).push(g));
  view.innerHTML = Object.entries(games).map(([game, gs]) =>
    `<h2 class="sec">${esc(game)}</h2>` + gs.map((g) => {
      const s = stats(g);
      return `<div class="card" data-id="${g.id}"><div><b>${esc(g.name)}</b><small>${s.done}/${s.total} · ${s.pct}%</small>
        <div class="bar"><i style="width:${s.pct}%"></i></div></div></div>`;
    }).join('')).join('');
  view.querySelectorAll('.card').forEach((c) => (c.onclick = () => go({ name: 'read', id: c.dataset.id })));
}

function edit() {
  const g = db.guides.find((x) => x.id === route.id);
  title.textContent = g ? 'Editar guia' : 'Novo guia';
  const raw = g ? g.blocks.map((b) => (b.t === 'h' ? '# ' : b.t === 'n' ? '> ' : (b.d ? '[x] ' : '- ')) + b.x).join('\n') : '';
  view.innerHTML = `
    <input id="game" placeholder="Jogo" value="${esc(g?.game || '')}" list="games">
    <datalist id="games">${[...new Set(db.guides.map((x) => x.game).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <input id="name" placeholder="Nome do guia" value="${esc(g?.name || '')}">
    <textarea id="text" placeholder="Cole o guia aqui.\n# Secao\n- item riscavel\n> nota (nao riscavel)">${esc(raw)}</textarea>
    <p class="hint">Regras: "# " = secao. "> " = nota. Qualquer outra linha = item que voce risca.</p>
    <div class="row"><button class="primary" id="save">Salvar</button>${g ? '<button class="danger" id="del">Excluir</button>' : ''}</div>`;
  $('#save').onclick = () => {
    const blocks = parse($('#text').value);
    const name = $('#name').value.trim() || 'Sem nome';
    if (!blocks.length) return alert('Guia vazio.');
    const rec = g || { id: uid() };
    Object.assign(rec, { game: $('#game').value.trim(), name, blocks });
    if (!g) db.guides.push(rec);
    save(); go({ name: 'read', id: rec.id });
  };
  if (g) $('#del').onclick = () => {
    if (confirm('Excluir este guia?')) { db.guides = db.guides.filter((x) => x !== g); save(); go({ name: 'home' }); }
  };
}

function read() {
  const g = db.guides.find((x) => x.id === route.id);
  if (!g) return go({ name: 'home' });
  title.textContent = g.name;
  actions.innerHTML = '<button id="reset">Zerar</button><button id="ed">Editar</button>';
  $('#ed').onclick = () => go({ name: 'edit', id: g.id });
  $('#reset').onclick = () => {
    if (confirm('Desmarcar tudo?')) { g.blocks.forEach((b) => delete b.d); save(); render(); }
  };
  const s = stats(g);
  view.innerHTML = `<p class="hint">${esc(g.game)} · ${s.done}/${s.total} (${s.pct}%)</p>` +
    g.blocks.map((b, i) =>
      b.t === 'h' ? `<h2 class="sec">${esc(b.x)}</h2>`
      : b.t === 'n' ? `<div class="note">${esc(b.x)}</div>`
      : `<div class="item${b.d ? ' done' : ''}" data-i="${i}"><span class="box"></span><span>${esc(b.x)}</span></div>`).join('');
  view.querySelectorAll('.item').forEach((el) => (el.onclick = () => {
    const b = g.blocks[el.dataset.i];
    b.d = !b.d; save();
    el.classList.toggle('done', b.d);
    const t = stats(g);
    view.querySelector('.hint').textContent = `${g.game} · ${t.done}/${t.total} (${t.pct}%)`;
  }));
}

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
