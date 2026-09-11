"""Running example from EVALUATION.md section 3: a 3x3 lattice, 12 edges.

Verifies that the IGARSS'25 Metric 1 is not scale-invariant - numbering A' is
identical to A with every number doubled, and scores exactly twice as badly -
while Moran's I and Geary's C are unchanged, as they should be.

    python3 analysis/verify_metrics.py
"""

import math, statistics

# 3x3 lattice, 100 m spacing. 12 edges.
nodes = {1:(0,0),2:(100,0),3:(200,0),4:(0,100),5:(100,100),6:(200,100),
         7:(0,200),8:(100,200),9:(200,200)}
E = {  # edge -> (nodeA, nodeB, orientation)
 'e1':(1,2,'EW'), 'e2':(2,3,'EW'), 'e3':(4,5,'EW'), 'e4':(5,6,'EW'),
 'e5':(7,8,'EW'), 'e6':(8,9,'EW'),
 'e7':(1,4,'NS'), 'e8':(4,7,'NS'), 'e9':(2,5,'NS'), 'e10':(5,8,'NS'),
 'e11':(3,6,'NS'),'e12':(6,9,'NS')}
mid = {k:((nodes[a][0]+nodes[b][0])/2,(nodes[a][1]+nodes[b][1])/2) for k,(a,b,o) in E.items()}
ids = list(E)

def dist(u,v):
    (x1,y1),(x2,y2)=mid[u],mid[v]; return math.hypot(x1-x2,y1-y2)

R = 120.0
W = {u:[v for v in ids if v!=u and dist(u,v)<=R] for u in ids}
print("neighbour counts:", {u:len(W[u]) for u in ids})
print("W (ordered pairs) =", sum(len(v) for v in W.values()), " n =", len(ids))

A = {'e1':2,'e2':2,'e3':4,'e4':4,'e5':6,'e6':6,'e7':1,'e8':1,'e9':3,'e10':3,'e11':5,'e12':5}
B = {'e1':2,'e2':4,'e3':6,'e4':8,'e5':10,'e6':12,'e7':1,'e8':5,'e9':3,'e10':9,'e11':7,'e12':11}
A2 = {k:2*v for k,v in A.items()}   # identical structure, doubled numbers

def metric1(N):
    return statistics.fmean(statistics.fmean(abs(N[u]-N[v]) for v in W[u]) for u in ids)

def moran(N, subset=None):
    S = subset or ids
    Wl = {u:[v for v in W[u] if v in S] for u in S}
    n = len(S); Wt = sum(len(v) for v in Wl.values())
    xb = statistics.fmean(N[u] for u in S)
    num = sum((N[u]-xb)*sum(N[v]-xb for v in Wl[u]) for u in S)
    den = sum((N[u]-xb)**2 for u in S)
    return (n/Wt)*(num/den), -1/(n-1)

def geary(N, subset=None):
    S = subset or ids
    Wl = {u:[v for v in W[u] if v in S] for u in S}
    n=len(S); Wt=sum(len(v) for v in Wl.values())
    xb=statistics.fmean(N[u] for u in S)
    num=sum(sum((N[u]-N[v])**2 for v in Wl[u]) for u in S)
    den=sum((N[u]-xb)**2 for u in S)
    return ((n-1)*num)/(2*Wt*den)

print()
for name,N in [('A (street-based)',A),('A2 (=A, doubled)',A2),('B (BFS gradient)',B)]:
    m=metric1(N); mi,_=moran(N); gc=geary(N)
    print(f"{name:20s} range={min(N.values())}-{max(N.values())}  Metric1={m:.4f}  MoranI={mi:+.4f}  GearyC={gc:.4f}")

NS=[u for u in ids if E[u][2]=='NS']; EW=[u for u in ids if E[u][2]=='EW']
print()
print("parity-stratified Moran's I  (E[I] null shown):")
for name,N in [('A',A),('B',B)]:
    ins,e0=moran(N,NS); iew,_=moran(N,EW)
    print(f"  {name}:  N-S stratum I={ins:+.4f}   E-W stratum I={iew:+.4f}   (null E[I]={e0:+.4f})")
