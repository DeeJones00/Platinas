#!/usr/bin/env python3
"""Build guides/gwent.txt (Gwent card checklist by faction, with art) from guides/witcher3.txt.

Card art comes from the Witcher wiki (Fandom) file list; the app loads the images from there at runtime.
Each card links back to its entry in the main guide ("@link lib-witcher3.txt:<item number>") so ticks stay in sync.
Cards whose art could not be matched are listed on stdout and placed in "Outras cartas".

Usage: build_gwent_guide.py [guides/witcher3.txt] [guides/gwent.txt]
"""
import json
import re
import sys
import urllib.request

API = 'https://witcher.fandom.com/api.php?action=query&list=allimages&aiprefix=Tw3_cardart_&ailimit=500&format=json'
FACTIONS = {'northernrealms': 'Northern Realms', 'nilfgaard': 'Nilfgaard', 'nilgaard': 'Nilfgaard',
            'scoiatael': "Scoia'tael", 'monsters': 'Monsters', 'skellige': 'Skellige', 'neutral': 'Neutral'}
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


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def images():
    req = urllib.request.Request(API, headers={'User-Agent': 'Mozilla/5.0'})
    out = {}
    for i in json.load(urllib.request.urlopen(req))['query']['allimages']:
        out[i['name'][len('Tw3_cardart_'):-4]] = i['url']
    return out


def thumb(url, w=200):
    base, _, q = url.partition('/revision/latest')
    return base + '/revision/latest/scale-to-width-down/%d' % w + q


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


def main(src, dst):
    imgs = images()
    cards, n = [], 0
    for line in open(src, encoding='utf8').read().split('\n'):
        m = re.match(r'^(\[x\]|-) (.*)$', line)
        if not m:
            continue
        t = re.match(r'(Unique Gwent Card|Unique Card|Skellige Cards?) #\d+ – (.*)', m.group(2))
        if t:
            cards.append({'n': n, 'name': t.group(2), 'done': m.group(1) == '[x]', 'detail': []})
        n += 1
    # details: lines following a card entry, until the next item or group
    cur, items = None, iter(cards)
    nxt = next(items, None)
    k = -1
    for line in open(src, encoding='utf8').read().split('\n'):
        if re.match(r'^(\[x\]|-) ', line):
            k += 1
            cur = nxt if nxt and nxt['n'] == k else None
            if cur:
                nxt = next(items, None)
        elif line.startswith('#'):
            cur = None
        elif line.startswith('> ') and cur is not None:
            cur['detail'].append(line[2:])
    groups, missing = {}, []
    for c in cards:
        hit = find(c['name'], imgs)
        if hit:
            fac = FACTIONS[hit[0].partition('_')[0]]
            c['img'] = thumb(hit[1])
        else:
            fac = 'Outras cartas'
            missing.append(c['name'])
        groups.setdefault(fac, []).append(c)
    order = ['Northern Realms', 'Nilfgaard', "Scoia'tael", 'Monsters', 'Skellige', 'Neutral', 'Outras cartas']
    out = ['> Cartas de Gwent do guia, por facção. Marcar aqui também marca no guia principal (e vice-versa).']
    for fac in order:
        if fac not in groups:
            continue
        out.append('# ' + fac)
        for c in groups[fac]:
            out.append(('[x] ' if c['done'] else '- ') + c['name'])
            if c.get('img'):
                out.append('> @img ' + c['img'])
            out.append('> @link %s:%d' % (MAIN_ID, c['n']))
            out += ['> ' + d for d in c['detail']]
    open(dst, 'w', encoding='utf8').write('\n'.join(out) + '\n')
    print(len(cards), 'cards;', {f: len(v) for f, v in groups.items()})
    print('without art:', missing)


if __name__ == '__main__':
    main(*(sys.argv[1:3] or ['guides/witcher3.txt', 'guides/gwent.txt']))
