#!/usr/bin/env python3
"""Remove the "## Cartas de Gwent" groups (cards, players) from a Platinas guide text.

Usage: strip_gwent.py <full.txt> <out.txt>

The Gwent deck is tracked in its own guide (guides/gwent.txt, built by build_gwent_guide.py from the full text).
"""
import sys

lines = open(sys.argv[1], encoding='utf8').read().split('\n')
out, skip = [], False
for line in lines:
    if line.startswith('#'):
        skip = line.startswith('## Cartas de Gwent')
    if not skip:
        out.append(line)
open(sys.argv[2], 'w', encoding='utf8').write('\n'.join(out))
