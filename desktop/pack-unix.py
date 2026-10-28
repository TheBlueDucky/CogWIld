# Packs the Linux and macOS apps on Windows (run by build-apps.ps1):
#   python -I pack-unix.py <version> <out dir> <macOS x64 electron zip> <macOS arm64 electron zip>
# Linux: dist/linux-unpacked and dist/linux-arm64-unpacked (electron-builder) -> Cogwild-<v>-linux-x64/-arm64.tar.gz, with the program files marked
#   runnable (Windows can't mark them) and a script that adds Cogwild to the app menu.
# macOS: Electron's official Mac app (from its release zip, symlinks kept) renamed to Cogwild.app, with the game inside,
#   the Cogwild icon, name, id and version -> Cogwild-<v>-mac-x64.zip (Intel) and -mac-arm64.zip (Apple Silicon).
#   It isn't signed by Apple (that needs a Mac and a $99/year Apple account): the first time, players open it with
#   right-click > Open (macOS 15+: System Settings > Privacy & Security > Open Anyway).
import io, os, re, stat, sys, tarfile, time, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ver, out, mac_x64, mac_arm64 = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(out, exist_ok=True)

# the files of the game app itself (what electron-builder puts in its app.asar)
def app_files():
    pkg = '{"name": "cogwild", "productName": "Cogwild", "version": "%s", "main": "main.js", "author": "BlueDucky Games"}\n' % ver
    yield 'package.json', pkg.encode()
    for f in ('main.js', 'preload.js', 'discord.js'):
        yield f, open(os.path.join(HERE, f), 'rb').read()
    root = os.path.join(HERE, 'app')
    for d, _, files in os.walk(root):
        for f in files:
            full = os.path.join(d, f)
            yield 'app/' + os.path.relpath(full, root).replace(os.sep, '/'), open(full, 'rb').read()

# ---------------- Linux ----------------
RUNNABLE = {'cogwild', 'cogwild-bin', 'chrome-sandbox', 'chrome_crashpad_handler', 'install-shortcut.sh'}
# ./cogwild starts the real program (cogwild-bin) without Chromium's sandbox helper: many distributions block it, and it
# has to be switched off before the game's own code runs
LAUNCHER = '''#!/bin/sh
exec "$(dirname "$(readlink -f "$0")")/cogwild-bin" --no-sandbox "$@"
'''
SHORTCUT = '''#!/bin/sh
# Adds Cogwild to your app menu (run once: ./install-shortcut.sh). Cogwild itself runs from this folder: ./cogwild
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/cogwild.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Cogwild
Comment=Build any mech, then rule the land, water and sky.
Exec="$DIR/cogwild" %U
Icon=$DIR/resources/cogwild.png
Terminal=false
Categories=Game;
EOF
echo "Cogwild is in your app menu now."
'''
README = '''Cogwild for Linux
Start it:            ./cogwild
App menu shortcut:   ./install-shortcut.sh   (once)
More: https://cogwild.duckdns.org
'''.encode()
for arch, folder in (('x64', 'linux-unpacked'), ('arm64', 'linux-arm64-unpacked')):
    src = os.path.join(HERE, 'dist', folder)
    if not os.path.isdir(src): continue
    top = 'Cogwild-%s-linux-%s' % (ver, arch)
    tar_path = os.path.join(out, top + '.tar.gz')
    with tarfile.open(tar_path, 'w:gz') as t:
        def add_bytes(name, data, mode):
            ti = tarfile.TarInfo(top + '/' + name)
            ti.size, ti.mode, ti.mtime = len(data), mode, time.time()
            t.addfile(ti, io.BytesIO(data))
        for d, _, files in os.walk(src):
            for f in files:
                full = os.path.join(d, f)
                rel = os.path.relpath(full, src).replace(os.sep, '/')
                if rel == "cogwild": rel = "cogwild-bin"
                add_bytes(rel, open(full, 'rb').read(), 0o755 if os.path.basename(rel) in RUNNABLE or rel.endswith('.so') or '.so.' in rel else 0o644)
        add_bytes("cogwild", LAUNCHER.encode(), 0o755)
        add_bytes('install-shortcut.sh', SHORTCUT.encode(), 0o755)
        add_bytes('resources/cogwild.png', open(os.path.join(HERE, 'build', 'icon.png'), 'rb').read(), 0o644)
        add_bytes('README.txt', README, 0o644)
    print('linux %s:' % arch, tar_path, round(os.path.getsize(tar_path) / 1e6, 1), 'MB')

# ---------------- macOS ----------------
icns = open(os.path.join(HERE, 'build', 'icon.icns'), 'rb').read()
def plist(text):
    def put(key, value):
        nonlocal text
        pat = r'(<key>%s</key>\s*<string>)[^<]*(</string>)' % key
        if re.search(pat, text): text = re.sub(pat, lambda m: m.group(1) + value + m.group(2), text)
        else: text = text.replace('<dict>', '<dict>\n\t<key>%s</key>\n\t<string>%s</string>' % (key, value), 1)
    put('CFBundleDisplayName', 'Cogwild')
    put('CFBundleName', 'Cogwild')
    put('CFBundleIdentifier', 'com.cogwild.game')
    put('CFBundleShortVersionString', ver)
    put('CFBundleVersion', ver)
    put('NSMicrophoneUsageDescription', 'Cogwild uses your microphone for voice chat with your party and match (only while voice chat is on).')
    put('NSHumanReadableCopyright', 'Copyright 2026 BlueDucky Games')
    return text
for arch, zsrc in (('x64', mac_x64), ('arm64', mac_arm64)):
    dst = os.path.join(out, 'Cogwild-%s-mac-%s.zip' % (ver, arch))
    with zipfile.ZipFile(zsrc) as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            name = info.filename
            if not name.startswith('Electron.app/') or name.endswith('Contents/Resources/default_app.asar'): continue
            data = zin.read(info)
            if name == 'Electron.app/Contents/Info.plist': data = plist(data.decode()).encode()
            if name == 'Electron.app/Contents/Resources/electron.icns': data = icns
            ni = zipfile.ZipInfo('Cogwild.app/' + name[len('Electron.app/'):], info.date_time)
            ni.external_attr, ni.create_system = info.external_attr, info.create_system  # keeps symlinks and runnable files
            ni.compress_type = zipfile.ZIP_STORED if stat.S_ISLNK(info.external_attr >> 16) else zipfile.ZIP_DEFLATED
            zout.writestr(ni, data)
        now = time.localtime()[:6]
        for rel, data in app_files():
            ni = zipfile.ZipInfo('Cogwild.app/Contents/Resources/app/' + rel, now)
            ni.external_attr, ni.create_system, ni.compress_type = (0o100644 << 16), 3, zipfile.ZIP_DEFLATED
            zout.writestr(ni, data)
    print('mac %s:' % arch, dst, round(os.path.getsize(dst) / 1e6, 1), 'MB')
