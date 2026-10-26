#   python tools/i18n/i18n_check.py es fr ...
# checks one or more language lists against KEYS: same length, same {n} count per entry; prints problems
import sys, re, importlib
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i18n_keys import KEYS
for lang in sys.argv[1:]:
    T = importlib.import_module('i18n_' + lang).T
    bad = []
    if len(T) != len(KEYS): bad.append(f'{lang}: {len(T)} entries, want {len(KEYS)}')
    for i, (k, t) in enumerate(zip(KEYS, T)):
        if k.count('{n}') != t.count('{n}'): bad.append(f'{lang} #{i}: {{n}} {k.count("{n}")}≠{t.count("{n}")} | {k} | {t}')
        if not t.strip(): bad.append(f'{lang} #{i}: empty | {k}')
    print(lang, 'OK' if not bad else '\n'.join(bad[:12]))
    if True:  # a few anchors, to see the order lines up
        for a in ['Canyon Lake', 'Bolts', 'Integrity', 'Account', 'Welcome to Cogwild', 'Daily deals', 'First Steps', 'Matches played', 'Watch', 'Trending', 'Haunted Harvest', 'How it works', 'Online', 'Type a message…']:
            i = KEYS.index(a); print(f'   {a} -> {T[i]}')
