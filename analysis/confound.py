"""Quantify the number-range confound in the IGARSS'25 Metric 1.

Recomputes Metric 1 and Moran's I (row-standardised, with a permutation null)
for every algorithm variant, and reports how strongly Metric 1 tracks the size
of the number range rather than spatial coherence.

    python3 analysis/confound.py

See EVALUATION.md section 2.1 for the interpretation.
"""

import math, os, random, statistics, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

from rna import dataset as ds

random.seed(0)


def spearman(a, b):
    def rk(x):
        s = sorted(range(len(x)), key=lambda i: x[i]); r = [0]*len(x); i = 0
        while i < len(s):
            j = i
            while j+1 < len(s) and x[s[j+1]] == x[s[i]]: j += 1
            avg = (i+j)/2 + 1
            for k in range(i, j+1): r[s[k]] = avg
            i = j+1
        return r
    ra, rb = rk(a), rk(b); n = len(a)
    ma, mb = statistics.fmean(ra), statistics.fmean(rb)
    num = sum((ra[i]-ma)*(rb[i]-mb) for i in range(n))
    den = math.sqrt(sum((r-ma)**2 for r in ra) * sum((r-mb)**2 for r in rb))
    return num/den if den else float('nan')


def build(city, net, buf=250.0):
    netw = ds.load_network(f'data/{city}/{net}')
    feats = netw['roads']['features']
    lat0 = statistics.fmean(f['geometry']['coordinates'][0][1] for f in feats)
    kx = 111320*math.cos(math.radians(lat0)); ky = 110540
    mid = {}
    for f in feats:
        c = f['geometry']['coordinates']; p = c[len(c)//2]
        mid[f['properties']['road_id']] = (p[0]*kx, p[1]*ky)
    ids = list(mid); W = {u: [] for u in ids}
    for i, u in enumerate(ids):
        xu, yu = mid[u]
        for v in ids[i+1:]:
            xv, yv = mid[v]
            if (xu-xv)**2 + (yu-yv)**2 <= buf*buf:
                W[u].append(v); W[v].append(u)
    return ids, W


def moran_rowstd(N, S, Wl):
    """Moran's I with row-standardised weights (each row sums to 1)."""
    xb = statistics.fmean(N[u] for u in S)
    den = sum((N[u]-xb)**2 for u in S)
    num = sum((N[u]-xb)*statistics.fmean(N[v]-xb for v in Wl[u]) for u in S)
    return num/den * len(S) / len(S) if False else num/den


for city, net in [('Brooklyn', 'Network-1'), ('Hyderabad', 'Network-2')]:
    ids, W = build(city, net)
    r = f'results/{city}/{net}'
    algos = [a['id'] for a in ds.list_algorithms(r)]
    m1s = []; rngs = []; mis = []; rows = []
    for a in algos:
        num = ds.load_numbering(r, a, set(ids))['numbering']
        N = {int(k): v['road_no'] for k, v in num.items() if not v.get('unassigned')}
        S = [u for u in ids if u in N and any(v in N for v in W[u])]
        Wl = {u: [v for v in W[u] if v in N] for u in S}
        m1 = statistics.fmean(statistics.fmean(abs(N[u]-N[v]) for v in Wl[u]) for u in S)
        mi = moran_rowstd(N, S, Wl)
        vals = [N[u] for u in S]; perms = []
        for _ in range(199):
            random.shuffle(vals)
            perms.append(moran_rowstd(dict(zip(S, vals)), S, Wl))
        mu = statistics.fmean(perms); sd = statistics.pstdev(perms)
        z = (mi-mu)/sd if sd else float('nan')
        rng = max(N.values())-min(N.values())
        m1s.append(m1); rngs.append(rng); mis.append(mi)
        rows.append((a, m1, rng, mi, z))
    print(f"===== {city}/{net} =====")
    print(f"{'algorithm':<20}{'Metric1':>9}{'range':>7}{'MoranI':>9}{'z':>8}")
    for a, m1, rng, mi, z in sorted(rows, key=lambda t: t[1]):
        print(f"{a:<20}{m1:>9.2f}{rng:>7}{mi:>+9.4f}{z:>+8.1f}")
    print(f"  Spearman(Metric1, number range) = {spearman(m1s, rngs):+.3f}")
    print(f"  Spearman(Metric1, Moran's I)    = {spearman(m1s, mis):+.3f}")
    print()
