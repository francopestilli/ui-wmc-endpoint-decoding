#!/usr/bin/env python3
"""
export_network_atlases.py — network atlases for the brain workspace

Builds assets/atlases/<CODE>.json for each reference atlas of the Network
Correspondence Toolbox (Kong et al. 2025) used in the paper, so the website
can paint canonical functional networks on the same fsaverage surface it
draws tract endpoints on.

The toolbox ships the atlases as fsaverage6 hard parcellations
(40,962 vertices / hemisphere, .mat files with lh_labels / rh_labels):
    https://github.com/rubykong/cbig_network_correspondence_data
fsaverage6 is an exact vertex subset of fsaverage (the first 40,962 vertices,
icosahedral nesting), so each full-resolution vertex takes the label of its
nearest fsaverage6 vertex on the sphere.

Parcel atlases (AS200Y17, XS268_8) are first collapsed to networks with the
toolbox's network_assignment/<CODE>.mat mapping, exactly as the toolbox
does before computing Dice. Network names follow the toolbox convention:
sorted unique non-zero label ids ↔ lines of network_names/<CODE>.

Output JSON (per atlas):
    { "code", "title", "names": [...], "colors": [...],
      "n": 163842, "lh": [v, run, v, run, …], "rh": [...] }
with labels 0 = no network, 1..K = index into names, run-length encoded.

Usage:
    python3 scripts/export_network_atlases.py <toolbox-data-dir>
where <toolbox-data-dir> holds atlases/fsaverage6/, network_assignment/,
network_names/ from the cbig_network_correspondence_data repository
(tag v1.1.0). Requires numpy, scipy, nibabel.
"""
import json
import os
import sys

import nibabel as nib
import numpy as np
import scipy.io as sio
from scipy.spatial import cKDTree

THIS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(THIS)
SPHERES = {
    'lh': os.path.join(ROOT, 'assets/TractEndpointImages/neuromaps/atlases/fsaverage/tpl-fsaverage_den-164k_hemi-L_sphere.surf.gii'),
    'rh': os.path.join(ROOT, 'assets/TractEndpointImages/neuromaps/atlases/fsaverage/tpl-fsaverage_den-164k_hemi-R_sphere.surf.gii'),
}
OUT = os.path.join(ROOT, 'assets/atlases')
FS6 = 40962

ATLASES = {
    'TY7':      ('YeoLab/TY7',      'Yeo 7 networks'),
    'EG17':     ('WashU/EG17',      'Gordon 17 networks'),
    'AS200Y17': ('YeoLab/AS200Y17', 'Schaefer 200 parcels / Yeo 17 networks'),
    'MG360J12': ('Glasser/MG360J12','Glasser 360 parcels / 12 networks (Ji)'),
    'XS268_8':  ('Shen/XS268_8',    'Shen 268 parcels / 8 networks'),
    'EG286_12': ('WashU/EG286_12',  'Gordon 286 parcels / 12 networks'),
}

# Canonical Yeo colours where they exist; a distinct categorical palette elsewhere.
YEO7 = {'Visual': '#781286', 'Somatomotor': '#4682B4', 'DorsAttn': '#00760E', 'Sal/VenAttn': '#C43AFA',
        'Limbic': '#DCF8A4', 'Control': '#E69422', 'Default': '#CD3E4E'}
PALETTE = ['#CD3E4E', '#781286', '#E69422', '#00760E', '#C43AFA', '#4682B4', '#DCF8A4', '#2AB0A0',
           '#F4A261', '#7FB3D5', '#D4A843', '#E080C0', '#6BBF6B', '#B0C93E', '#9B75D4', '#5AACCC', '#FF9F1C']


def rle(a):
    a = np.asarray(a).ravel()
    out = []
    i = 0
    n = len(a)
    while i < n:
        v = int(a[i])
        j = i + 1
        while j < n and a[j] == v:
            j += 1
        out += [v, j - i]
        i = j
    return out


def main(data_dir):
    os.makedirs(OUT, exist_ok=True)
    # nearest fsaverage6 vertex for every fsaverage vertex, per hemisphere
    nn = {}
    for hemi, path in SPHERES.items():
        xyz = nib.load(path).darrays[0].data.astype(np.float64)
        tree = cKDTree(xyz[:FS6])
        _, idx = tree.query(xyz, k=1)
        assert np.array_equal(idx[:FS6], np.arange(FS6)), 'fsaverage6 vertices should map to themselves'
        nn[hemi] = idx
    index = []
    for code, (rel, title) in ATLASES.items():
        m = sio.loadmat(os.path.join(data_dir, 'atlases/fsaverage6', rel + '.mat'))
        lab = {'lh': np.asarray(m['lh_labels']).ravel().astype(np.int64),
               'rh': np.asarray(m['rh_labels']).ravel().astype(np.int64)}
        mapfile = os.path.join(data_dir, 'network_assignment', code + '.mat')
        if os.path.exists(mapfile):
            mp = np.asarray(sio.loadmat(mapfile)['mapping']).ravel().astype(np.int64)
            for h in lab:
                v = lab[h]
                out = np.zeros_like(v)
                nz = v > 0
                out[nz] = mp[v[nz] - 1]
                lab[h] = out
        names = [l.strip() for l in open(os.path.join(data_dir, 'network_names', code)) if l.strip()]
        ids = np.setdiff1d(np.unique(np.concatenate([lab['lh'], lab['rh']])), [0])
        assert len(ids) == len(names), (code, len(ids), len(names))
        remap = {int(i): k + 1 for k, i in enumerate(ids)}
        colors = [YEO7.get(nm, PALETTE[k % len(PALETTE)]) if code == 'TY7' else PALETTE[k % len(PALETTE)] for k, nm in enumerate(names)]
        rec = {'code': code, 'title': title, 'names': names, 'colors': colors, 'n': int(len(nn['lh']))}
        for h in ('lh', 'rh'):
            full = lab[h][nn[h]]
            full = np.vectorize(lambda x: remap.get(int(x), 0))(full) if len(remap) else full
            rec[h] = rle(full.astype(np.uint8))
        path = os.path.join(OUT, code + '.json')
        with open(path, 'w') as f:
            json.dump(rec, f, separators=(',', ':'))
        index.append({'code': code, 'title': title, 'names': names, 'colors': colors})
        print(f'{code}: {len(names)} networks, {os.path.getsize(path) // 1024} KB')
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump({'atlases': index}, f, separators=(',', ':'))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
