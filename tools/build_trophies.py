#!/usr/bin/env python3
"""Build guides/trofeus.txt: every trophy/achievement of The Witcher 3 (base game and both expansions) up to the
PlayStation Platinum, with the ones the guide marks as missable flagged. Each links to its entry in the main guide.

Usage: build_trophies.py [private/witcher3-full.txt] [guides/trofeus.txt] [guides/witcher3.txt]
"""
import re
import sys

# Split follows the guide's own counts: base 53, Hearts of Stone 12, Blood & Wine 13 (78 on Steam/Xbox, 79 on PlayStation).
SECTIONS = [('Jogo base', range(1, 54)), ('Hearts of Stone (DLC)', range(54, 66)), ('Blood & Wine (DLC)', range(66, 79))]
MAIN_ID = 'lib-witcher3.txt'
PLATINUM = ('The Limits of the Possible', 'Platina da PlayStation, ganha ao concluir os demais troféus. '
            'Fontes consultadas dão esse nome para o jogo base; veja na sua lista de troféus se Hearts of Stone e Blood & Wine entram na sua versão. '
            'No Steam e no Xbox não existe platina (78 conquistas).')
PLAT_NOTE = ('Contagem do guia (Steam): 53 no jogo base, 12 em Hearts of Stone e 13 em Blood & Wine = 78. A PlayStation soma a platina. '
             'A divisão entre expansões segue as contagens do guia; confira na sua lista de troféus.')


def read(src):
    ach, cur, seq = [], None, ''
    for line in open(src, encoding='utf8').read().split('\n'):
        if line.startswith('# '):
            seq, cur = line[2:], None
        m = re.match(r'^(?:\[x\]|-) Achievement #(\d+) – (.*)$', line)
        if m:
            cur = {'n': int(m.group(1)), 'name': m.group(2), 'seq': seq, 'd': []}
            ach.append(cur)
        elif re.match(r'^(\[x\]|- )', line):
            cur = None
        elif line.startswith('> ') and cur is not None:
            cur['d'].append(line[2:])
    return ach


def main(src, dst, main_path):
    items = [re.sub(r'^(\[x\]|-) ', '', l) for l in open(main_path, encoding='utf8').read().split('\n') if re.match(r'^(\[x\]|-) ', l)]
    done = {re.sub(r'^(\[x\]|-) ', '', l) for l in open(main_path, encoding='utf8').read().split('\n') if l.startswith('[x] ')}
    ach = {a['n']: a for a in read(src)}
    missable = {n for n, a in ach.items() if any(re.search(r'\bmissable\b', d, re.I) for d in a['d'])}
    out = ['> Todos os troféus do jogo, do primeiro até a platina. 🔴 Perdível = o guia avisa que dá para perder o troféu. Marcar aqui também marca no guia principal.',
           '> %d troféus (53 no jogo base, 12 em Hearts of Stone, 13 em Blood & Wine) + a platina. Perdíveis: %d.' % (len(ach), len(missable)),
           '> ' + PLAT_NOTE]
    for title, rng in SECTIONS:
        lst = [ach[n] for n in rng if n in ach]
        out.append('# %s – %d troféus, %d perdíveis' % (title, len(lst), sum(a['n'] in missable for a in lst)))
        for a in lst:
            full = 'Achievement #%d – %s' % (a['n'], a['name'])
            out.append(('[x] ' if full in done else '- ') + a['name'])
            out.append('> @ico 🏆')
            out.append('> @link %s:%d' % (MAIN_ID, items.index(full)))
            out.append('> @lt ' + full)
            if a['n'] in missable:
                out.append('> @tag 🔴 Perdível')
            out.append('> @tag #%d' % a['n'])
            desc = [d for d in a['d'] if d.strip().lower() != 'missable.']
            if a['n'] in missable:
                out.append('> Perdível, segundo o guia.')
            out += ['> ' + d for d in desc[:3]]
            out.append('> Aparece na ' + a['seq'] + '.')
    out.append('# Platina (só PlayStation)')
    out.append('- ' + PLATINUM[0])
    out.append('> @ico 🏆')
    out.append('> @tag Platina')
    out.append('> ' + PLATINUM[1])
    open(dst, 'w', encoding='utf8').write('\n'.join(out) + '\n')
    print(len(ach), 'trophies,', len(missable), 'missable:', sorted(missable))


if __name__ == '__main__':
    main(*(sys.argv[1:4] or ['private/witcher3-full.txt', 'guides/trofeus.txt', 'guides/witcher3.txt']))
