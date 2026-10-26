# Builds js/i18n.js (the engine + KEYS) and js/lang/<id>.js from the lists here.   python tools/i18n/i18n_build.py
import sys, json, importlib, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from i18n_keys import KEYS
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
eng = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'i18n_engine.js'), encoding='utf-8').read()
eng = eng.replace('const KEYS = /*KEYS*/[];', 'const KEYS = ' + json.dumps(KEYS, ensure_ascii=False) + ';')
eng = eng.replace("s.src = `js/lang/${I.lang}.js?v=${CW.LANG_V || 1}`;", "s.src = `js/lang/${I.lang}.js${V}`;")
eng = eng.replace("  const KEYS =", r"  const V = ((document.currentScript && document.currentScript.src.match(/\?v=\d+/)) || [''])[0]; // the same cache buster as this file" + "\n  const KEYS =", 1)
open(root + '/js/i18n.js', 'w', encoding='utf-8', newline='\n').write(eng)
os.makedirs(root + '/js/lang', exist_ok=True)
for lang in ['es', 'pt', 'fr', 'de', 'it', 'ru', 'tr', 'hi', 'ar', 'he', 'zh', 'ja']:
    T = importlib.import_module('i18n_' + lang).T
    assert len(T) == len(KEYS)
    body = '// Cogwild: ' + lang + ' translations, one per entry of KEYS in js/i18n.js (same order)\nwindow.CW.LANG_DATA = window.CW.LANG_DATA || {};\nwindow.CW.LANG_DATA.' + lang + ' = ' + json.dumps(T, ensure_ascii=False, indent=0).replace('\n', '') + ';\n'
    open(root + f'/js/lang/{lang}.js', 'w', encoding='utf-8', newline='\n').write(body)
print('built', len(KEYS))
