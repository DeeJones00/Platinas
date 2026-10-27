#!/usr/bin/env python3
"""Build guides/gwent.txt (Gwent card checklist by faction, with art, strength and class) from guides/witcher3.txt.

Card art and card data (strength, row, type, ability) come from the Witcher wiki (Fandom); the app loads the
images from there at runtime. Each card links back to its entry in the main guide
("@link lib-witcher3.txt:<item number>") so ticks stay in sync. Cards that appear more than once in the guide
(copies 1, 2, 3 ...) get "@copy i/n".

Usage: build_gwent_guide.py [guides/witcher3.txt] [guides/gwent.txt]
"""
import json
import re
import sys
import urllib.parse
import urllib.request

WIKI = 'https://witcher.fandom.com/api.php'
FACTIONS = {'northernrealms': 'Northern Realms', 'nilfgaard': 'Nilfgaard', 'nilgaard': 'Nilfgaard',
            'scoiatael': "Scoia'tael", 'monsters': 'Monsters', 'skellige': 'Skellige', 'neutral': 'Neutral'}
CATEGORIES = ['Northern_Realms_gwent_deck_cards', 'Nilfgaardian_Empire_gwent_deck_cards', "Scoia'tael_gwent_deck_cards",
              'Monsters_gwent_deck_cards', 'Skellige_gwent_deck_cards', 'Neutral_gwent_cards']
ROWS = {'close combat': 'Corpo a corpo', 'closed-ranged': 'Ágil (corpo a corpo ou distância)',
        'ranged': 'À distância', 'siege': 'Cerco'}
TYPES = {'hero': 'Herói', 'leader': 'Líder', 'weather': 'Clima', 'special': 'Especial'}
MAIN_ID = 'lib-witcher3.txt'
# Cards whose name differs from the art file name. Leaders share one art per hero (the "gold" file).
ALIAS = {
    'biting frost': 'neutral_frost', 'impenetrable fog': 'neutral_fog', 'torrential rain': 'neutral_rain',
    'clear weather': 'neutral_clear_sky', 'zoltan chivay': 'neutral_zoltan', 'villentretenmerth': 'neutral_villen',
    'yennefer of vengerberg': 'neutral_yennefer', 'emiel regis rohellec terzieff': 'neutral_emiel',
    'letho of gulet': 'nilfgaard_letho', 'renuald aep matsen': 'nilfgaard_renuald',
    'shilard fitz-oesterlen': 'nilgaard_shilard', 'filavandrel aen fidhail': 'scoiatael_filavandrel',
    'ciaran aep easnillien': 'scoiatael_ciaran', 'sabrina glevissig': 'northernrealms_sabrina',
    'blue stripes commando': 'northernrealms_blue_stripes', 'crinfrid reavers dragon hunter': 'northernrealms_crinfrid_reavers',
    'foltest': 'northernrealms_foltest_gold', 'emhyr var emreis': 'nilfgaard_emhyr_gold',
    'francesca findabair': 'scoiatael_francesca_gold', 'eredin': 'monsters_eredin_gold',
    'síle de tansarville': 'northernrealms_sheala_de_tansarville', 'poor fockin': 'northernrealms_poor_infantry',
    'kaedweni siege expert': 'northernrealms_kaedwen_siege', 'commander': 'neutral_commander_horn',
    'griffon': 'monsters_griffin', 'vattier de ridaux': 'nilfgaard_vattier_de_rideaux',
    'tibor eggebracht': 'nilfgaard_tibor_rggebracht', 'cirilla': 'neutral_ciri', 'ida emean': 'scoiatael_ida',
    'mysterious elf': 'neutral_avallach', 'crach an craite': 'skellige_leader_crach', 'king bran': 'skellige_leader_king_bran',
    'war longship': 'skellige_war_drakkar', 'light longship': 'skellige_light_drakkar', 'mardroeme': 'skellige_special_mushroom',
    'kambi': 'skellige_cock',  # best guess, check by eye
}
# Guide card names that differ from the wiki card name (both normalized).
NAME_ALIAS = {'poorfockininfantry': 'poorfuckinginfantry', 'vattierderidaux': 'vattierderideaux', 'griffon': 'griffin',
              'heavyzerrikanainfirescorpion': 'heavyzerrikanianfirescorpion',
              'francescafindabairqueenofdolbathanna': 'francescafindabairqueenofdolblathanna'}


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def wiki(**p):
    p['format'] = 'json'
    req = urllib.request.Request(WIKI + '?' + urllib.parse.urlencode(p), headers={'User-Agent': 'Mozilla/5.0'})
    return json.load(urllib.request.urlopen(req))


def images():
    r = wiki(action='query', list='allimages', aiprefix='Tw3_cardart_', ailimit=500)
    return {i['name'][len('Tw3_cardart_'):-4]: i['url'] for i in r['query']['allimages']}


def thumb(url, w=200):
    base, _, q = url.partition('/revision/latest')
    return base + '/revision/latest/scale-to-width-down/%d' % w + q


def clean(t):
    t = re.sub(r'<br\s*/?>', ' ', t)
    t = re.sub(r'\{\{[^{}]*\}\}', '', t)
    t = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', t)
    t = t.replace("'''", '').replace("''", '')
    return re.sub(r'\s+', ' ', t).strip()


def field(text, key):
    m = re.search(r'\|\s*%s\s*=\s*(.*?)(?=\n\|[a-z_]+\s*=|\n\}\})' % key, text, re.S)
    return m.group(1).strip() if m else ''


def copies_in_game(src):
    """Number of copies of a card, from the wiki "source" lines ("2 are part of the base deck<br/>1 is ...")."""
    n = 0
    for line in re.split(r'<br\s*/?>|\n', re.sub(r'\{\{(?:HoS|BaW|B&W)[^}]*\}\}:?', '', src)):
        line = clean(line)
        if line:
            m = re.match(r'(\d+)\b', line)
            n += int(m.group(1)) if m else 1
    return n


def card_data():
    """Return {normalized name: {pow, tags, ability}} from the wiki card infoboxes."""
    titles = []
    for c in CATEGORIES:
        r = wiki(action='query', list='categorymembers', cmtitle='Category:' + c, cmlimit=500)
        titles += [m['title'] for m in r['query']['categorymembers'] if m['ns'] == 0]
    out, titles = {}, sorted(set(titles))
    for i in range(0, len(titles), 40):
        r = wiki(action='query', prop='revisions', rvprop='content', rvslots='main', titles='|'.join(titles[i:i + 40]))
        for pg in r['query']['pages'].values():
            w = pg['revisions'][0]['slots']['main']['*']
            name = clean(field(w, 'name'))
            if not name:
                continue
            typ = clean(field(w, 'type')).lower()
            row = re.sub(r'[{}]', '', field(w, 'row')).replace('Gwent', '').strip().lower()
            tags = [TYPES[typ]] if typ in TYPES else []
            if row in ROWS:
                tags.append(ROWS[row])
            st = re.match(r'\d+', clean(field(w, 'strength')))
            out[norm(name)] = {'pow': st.group(0) if st else '', 'tags': tags, 'ability': clean(field(w, 'spec_ability')),
                               'copies': copies_in_game(field(w, 'source')), 'name': name}
    return out


def card_info(name, data):
    base = re.sub(r'\s*\((\d+|Leader|Hero|Leader Card)\)', '', name).strip()
    k = norm(base)
    k = NAME_ALIAS.get(k, k)
    if k in data:
        return data[k]
    hits = [v for kk, v in data.items() if kk.startswith(k) or k.startswith(kk)]
    return hits[0] if len(hits) == 1 else None


def find(name, imgs):
    """Return (image key, url) for a card name like 'Trebuchet (2)', or None."""
    num = re.search(r'\((\d+)\)', name)
    base = re.sub(r'\s*\((\d+|Leader|Hero)\)', '', name).strip()
    low = base.lower()
    key = next((v for k, v in ALIAS.items() if low.startswith(k)), None)
    if key and key in imgs:
        return key, imgs[key]
    cands = [k for k in imgs if key and k.startswith(key)]  # alias may be a prefix (numbered copies)
    n = norm(base)
    for k in imgs:
        rest = k.partition('_')[2]
        if norm(re.sub(r'_?\d$', '', rest)) == n or norm(rest) == n:
            cands.append(k)
    if not cands:  # partial: art name contained in card name or the reverse
        for k in imgs:
            rest = norm(re.sub(r'_?\d$', '', k.partition('_')[2]))
            if len(rest) > 4 and (rest in n or n in rest):
                cands.append(k)
    if not cands:
        return None
    cands = sorted(set(cands))
    idx = int(num.group(1)) if num else 1
    pick = next((c for c in cands if re.search(r'_?%d$' % idx, c)), None)
    pick = pick or next((c for c in cands if not re.search(r'\d$', c)), cands[0])
    return pick, imgs[pick]


CARD_RE = re.compile(r'(Unique Gwent Card|Unique Card|Gwent Card|Skellige Cards?) #\d+ – (.*)')
EXTRA_ACH = ('Gwent Master', 'Card Collector', 'I Have A Gwent Problem')


def read_main(src):
    """Cards and other Gwent entries of the main guide: item ordinal, titles, done flag, detail lines."""
    cards, others, n, cur, seq = [], [], 0, None, ''
    for line in open(src, encoding='utf8').read().split('\n'):
        m = re.match(r'^(\[x\]|-) (.*)$', line)
        if m:
            title, cur = m.group(2), None
            rec = {'n': n, 'title': title, 'done': m.group(1) == '[x]', 'detail': [], 'seq': seq}
            t = CARD_RE.match(title)
            if t:
                rec['name'] = t.group(2)
                cards.append(rec)
                cur = rec
            elif (re.match(r'(Random (Gwent )?Player|Gwent Player)\b', title)
                  or (title.startswith('Secondary Quest – Gwent'))
                  or any(title.endswith(a) for a in EXTRA_ACH)):
                others.append(rec)
                cur = rec
            n += 1
        elif line.startswith('# '):
            seq, cur = line[2:], None
        elif line.startswith('#'):
            cur = None
        elif line.startswith('> ') and cur is not None:
            cur['detail'].append(line[2:])
    return cards, others


def main(src, dst):
    imgs, data = images(), card_data()
    cards, others = read_main(src)
    base_of = lambda c: re.sub(r'\s*\((\d+)\)', '', c['name']).strip()
    copies = {}
    for c in cards:
        copies.setdefault(base_of(c), []).append(c)
    for c in cards:
        c['info'] = card_info(c['name'], data)
    # copies per game card: guide entries first, then extra copies the wiki lists (neutral weather, Decoy, ...)
    by_card = {}
    for c in cards:
        if c['info']:
            by_card.setdefault(id(c['info']), []).append(c)
    extras = []
    for lst in by_card.values():
        inf = lst[0]['info']
        total = max(inf['copies'], len(lst))
        for i, c in enumerate(lst, 1):
            c['copy'] = (i, total) if total > 1 else None
        last = lst[-1]
        for k in range(len(lst) + 1, total + 1):
            extras.append({'after': last, 'name': '%s (cópia extra %d)' % (base_of(last), k), 'copy': (k, total),
                           'info': inf, 'detail': ['Cópia extra: não conta para o Card Collector, serve para montar o baralho.'],
                           'extra': True, 'done': False, 'n': None, 'src': last})
    for c in cards:
        if not c['info']:
            c['copy'] = None
            lst = copies[base_of(c)]
            if len(lst) > 1:
                c['copy'] = (lst.index(c) + 1, len(lst))
    groups, noart, nodata = {}, [], []
    for c in cards:
        hit = find(c['name'], imgs)
        if not c['info']:
            nodata.append(c['name'])
        if hit:
            fac = FACTIONS[hit[0].partition('_')[0]]
            c['img'] = thumb(hit[1])
        else:
            fac = 'Outras cartas'
            noart.append(c['name'])
        c['fac'], c['hit'] = fac, hit
        groups.setdefault(fac, []).append(c)
        for e in extras:
            if e['after'] is c:
                e['img'] = c.get('img')
                groups[fac].append(e)
    title_of = {c['n']: c['title'] for c in cards}
    order = ['Northern Realms', 'Nilfgaard', "Scoia'tael", 'Monsters', 'Skellige', 'Neutral', 'Outras cartas']
    out = ['> Cartas de Gwent do guia, por facção. Marcar aqui também marca no guia principal (e vice-versa).',
           '> %d entradas do guia (cada cópia conta), %d cartas distintas e %d cópias extras (etiqueta Extra, só aqui, não contam para a conquista).'
           % (len(cards), len(copies), len(extras))]
    for fac in order:
        if fac not in groups:
            continue
        lst = groups[fac]
        out.append('# ' + fac)
        real = [c for c in lst if not c.get('extra')]
        out.append('> %d entradas, %d distintas, %d cópias extras.' % (len(real), len({base_of(c) for c in real}), len(lst) - len(real)))
        for c in lst:
            out.append(('[x] ' if c['done'] else '- ') + c['name'])
            if c.get('img'):
                out.append('> @img ' + c['img'])
            if not c.get('extra'):
                out.append('> @link %s:%d' % (MAIN_ID, c['n']))
                out.append('> @lt ' + title_of[c['n']])
            inf = c['info']
            if inf:
                if inf['pow']:
                    out.append('> @pow ' + inf['pow'])
                out += ['> @tag ' + t for t in inf['tags']]
            if c.get('extra'):
                out.append('> @tag Extra')
            if c['copy']:
                out.append('> @copy %d/%d' % c['copy'])
            if inf and inf['ability']:
                out.append('> Habilidade: ' + inf['ability'])
            out += ['> ' + d for d in c['detail']]
    # jogadores, quests e conquistas de Gwent (ligados ao guia principal)
    out.append('# Jogadores e quests de Gwent')
    out.append('> Quem enfrentar, quests e conquistas de Gwent. Ligados ao guia principal.')
    seq = None
    for o in others:
        if o['seq'] != seq:
            seq = o['seq']
            out.append('## ' + seq)
        out.append(('[x] ' if o['done'] else '- ') + o['title'])
        out.append('> @link %s:%d' % (MAIN_ID, o['n']))
        out.append('> @lt ' + o['title'])
        out += ['> ' + d for d in o['detail']]
    open(dst, 'w', encoding='utf8').write('\n'.join(out) + '\n')
    print(len(cards), 'cards;', len(extras), 'extra copies;', len(others), 'players/quests;', {f: len(v) for f, v in groups.items()})
    print('without art:', noart)
    print('without data:', nodata)


if __name__ == '__main__':
    main(*(sys.argv[1:3] or ['guides/witcher3.txt', 'guides/gwent.txt']))
