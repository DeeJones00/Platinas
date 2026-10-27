#!/usr/bin/env python3
"""Convert the Steam guide "100% Achievement Guide: The Witcher 3" into Platinas text format.

Usage: steam_guide_to_text.py <guide.html|URL> <output.txt>

The output holds the guide author's text, so keep it out of the repository (private/ is git-ignored)
and import it from the app instead.
"""
import html
import re
import sys
import urllib.request

ITEM_LABELS = (
    'Main Quest|Secondary Quest|Witcher Contract|HoS Quest|Hos Quest|B&W Quest|DLC Quest|Ciri Quest|'
    'Treasure Hunt|Scavenger Hunt|Achievement|Secret Achievement|Gwent Player|Random Gwent Player|'
    'Random Player|Unique Gwent Card|Unique Card|Gwent Card|Skellige Cards?|Nightmare|Kaer Morhen Ally'
)
CARD_LABELS = re.compile(r'^(Unique Gwent Card|Unique Card|Gwent Card|Random (Gwent )?Player|Gwent Player|Skellige Cards?)\b')
ITEM = re.compile(r'^(?P<label>(?:%s))(?: #(?P<n>\d+))? – (?P<rest>.+)$' % ITEM_LABELS)
NUMBERED_ITEM = re.compile(r'^(?P<label>[A-Za-z&’\' ]{2,30}) #(?P<n>\d+) – (?P<rest>.+)$')
LOCATION = re.compile(r'^[^.!?]{3,70}:$')


def clean(h):
    h = re.sub(r'<br\s*/?>', '\n', h)
    h = re.sub(r'</?(li|ul|ol|div|p|h\d)[^>]*>', '\n', h)
    return html.unescape(re.sub(r'<[^>]+>', '', h))


def load(src):
    if src.startswith('http'):
        req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
        return urllib.request.urlopen(req).read().decode('utf8')
    return open(src, encoding='utf8').read()


def sections(page):
    for p in re.split(r'<div class="subSection detailBox"[^>]*>', page)[1:]:
        title = clean(re.search(r'class="subSectionTitle">(.*?)</div>', p, re.S).group(1)).strip()
        body = re.search(r'class="subSectionDesc">(.*)', p, re.S).group(1)
        lines = [l.strip() for l in clean(body).split('\n')]
        yield title.rstrip(':').strip(), [l for l in lines if l]


def split_item(m):
    """Return (title, first detail line) for an entry line."""
    head = m.group('label') + (' #' + m.group('n') if m.group('n') else '')
    title, _, desc = m.group('rest').partition(': ')
    return '%s – %s' % (head, title.rstrip(':')), desc.strip()


def convert_section(title, lines):
    """Return (intro notes, locations[{name, items}], cards[items])."""
    notes, groups, cards = [], [], []
    seen_sep = False
    loc = None
    last = None  # entry currently collecting detail lines
    for line in lines:
        if re.fullmatch(r'-{10,}', line):
            seen_sep = True
            continue
        if line.startswith('$J('):
            break
        m = ITEM.match(line) or NUMBERED_ITEM.match(line)
        if seen_sep and m:
            t, d = split_item(m)
            last = {'title': t, 'detail': [d] if d else [], 'loc': loc['name'] if loc else ''}
            if CARD_LABELS.match(m.group('label')):
                cards.append(last)
            else:
                if loc is None:
                    loc = {'name': 'Geral', 'items': []}
                    groups.append(loc)
                loc['items'].append(last)
            continue
        if seen_sep and LOCATION.match(line):
            loc = {'name': line.rstrip(':').strip(), 'items': []}
            groups.append(loc)
            last = None
            continue
        if last is not None:
            last['detail'].append(line)
        else:
            notes.append(line)
    return notes, groups, cards


def emit_item(out, it, extra=None):
    out.append('- ' + it['title'])
    if extra:
        out.append('> Local: ' + extra)
    for d in it['detail']:
        out.append('> ' + d)


def main(src, dst):
    out = []
    for title, lines in sections(load(src)):
        notes, groups, cards = convert_section(title, lines)
        out.append('# ' + title)
        out += ['> ' + n for n in notes]
        for g in groups:
            if not g['items']:
                continue
            out.append('## ' + g['name'])
            for it in g['items']:
                emit_item(out, it)
        if cards:
            out.append('## Cartas de Gwent')
            for it in cards:
                emit_item(out, it, it['loc'])
        out.append('')
    open(dst, 'w', encoding='utf8').write('\n'.join(out))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
