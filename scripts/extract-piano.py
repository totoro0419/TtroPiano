"""Extract a compact two-velocity stereo piano bank. Requires Python 3 and FFmpeg.

Usage: python3 scripts/extract-piano.py /path/to/MuseScore_General_Full.sf3
The original 86 MB SoundFont is intentionally not stored in this repository.
This is an adapted sample player, not a full SF3/FluidSynth implementation.
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile

source = Path(sys.argv[1])
data = source.read_bytes()
chunks = {}

def walk(start, end):
    while start + 8 <= end:
        tag = data[start:start + 4]
        size = struct.unpack_from('<I', data, start + 4)[0]
        if tag == b'LIST':
            walk(start + 12, start + 8 + size)
        else:
            chunks[tag] = data[start + 8:start + 8 + size]
        start += 8 + size + size % 2

walk(12, len(data))
assert data[:4] == b'RIFF' and b'MuseScore_General_HQ v0.2.1' in chunks[b'INAM']
out = Path(__file__).resolve().parents[1] / 'public/piano'
out.mkdir(parents=True, exist_ok=True)
(out / 'LICENSE.txt').write_text(chunks[b'ICMT'].decode().rstrip('\0\n') + '\n', encoding='utf-8')
manifest = {'name': 'Splendid Grand · MuseScore General', 'version': 1,
            'sourceSha256': hashlib.sha256(data).hexdigest(), 'samples': []}

with tempfile.TemporaryDirectory() as tmp:
    for layer, instruments in [('soft', [181, 182]), ('hard', [183, 184])]:
        pairs = {}
        for inst in instruments:
            first = struct.unpack_from('<20sH', chunks[b'inst'], inst * 22)[1]
            last = struct.unpack_from('<20sH', chunks[b'inst'], (inst + 1) * 22)[1]
            for zone in range(first, last):
                a = struct.unpack_from('<HH', chunks[b'ibag'], zone * 4)[0]
                z = struct.unpack_from('<HH', chunks[b'ibag'], (zone + 1) * 4)[0]
                gen = dict(struct.unpack_from('<HH', chunks[b'igen'], i * 4) for i in range(a, z))
                if 53 not in gen:
                    continue
                header = struct.unpack_from('<20sIIIIIBbHH', chunks[b'shdr'], gen[53] * 46)
                name, start, end, ls, le, rate, root, correction, link, kind = header
                key = (root, name.decode().split('(')[0].strip('\0 '))
                channel = 'left' if kind & 4 else 'right'
                pairs.setdefault(key, {})[channel] = (start, end, rate, correction)
        roots = sorted({k[0] for k in pairs})
        # Keep both original velocity layers, about one stereo anchor every 4 semitones.
        keep = [roots[0]]
        for root in roots[1:]:
            if root - keep[-1] >= 4:
                keep.append(root)
        if roots[-1] not in keep:
            keep.append(roots[-1])
        for root in keep:
            pair = next(v for k, v in pairs.items() if k[0] == root and 'left' in v and 'right' in v)
            for channel in ['left', 'right']:
                a, z, rate, correction = pair[channel]
                Path(tmp, channel + '.ogg').write_bytes(chunks[b'smpl'][a:z])
            filename = f'{layer}-{root}.mp3'
            encoded = Path(tmp, filename)
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(Path(tmp, 'left.ogg')),
                            '-i', str(Path(tmp, 'right.ogg')), '-filter_complex',
                            '[0:a]asetpts=PTS-STARTPTS[L];[1:a]asetpts=PTS-STARTPTS[R];[L][R]amerge=inputs=2[a]', '-map', '[a]', '-c:a', 'libmp3lame',
                            '-b:a', '128k', '-ar', '32000', str(encoded)], check=True)
            assert encoded.stat().st_size > 1000, f'Empty conversion: {filename}'
            subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(encoded), '-f', 'null', '-'], check=True)
            # Stage outside the served directory, then atomically publish complete bytes.
            staged = out / (filename + '.part')
            staged.write_bytes(encoded.read_bytes())
            staged.replace(out / filename)
            manifest['samples'].append({'file': filename, 'root': root, 'layer': layer,
                                        'cents': pair['left'][3], 'bytes': (out / filename).stat().st_size,
                                        'sha256': hashlib.sha256((out / filename).read_bytes()).hexdigest()})
manifest['bytes'] = sum(s['bytes'] for s in manifest['samples'])
(out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'samples': len(manifest['samples']), 'bytes': manifest['bytes'], 'sourceSha256': manifest['sourceSha256']}))
