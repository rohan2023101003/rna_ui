# Evaluating Automated Road Numbering — A Research Plan

Companion to *Automated Road Numbering for Geospatial Maps Using Search
Algorithms* (IGARSS 2025). This document exists because the journal extension
was rejected on the grounds that **the evaluation metrics were invented by the
authors**. It sets out what that criticism actually means, shows with numbers
from our own data that the criticism is correct and more serious than it
sounds, and then lays out a three-tier evaluation programme that fixes it.

Every metric below is either (a) a standard statistic with a literature and a
significance test, (b) a measurement against external ground truth, or (c) a
human measurement with a validated instrument. Nothing is invented here
without being validated against something outside itself.

---

> **Looking for a plain explanation instead?** This document is the research
> plan and assumes statistical background. For what each measurement means in
> ordinary language, how to run the evaluation and how to read the numbers, read
> **[EVALUATION_GUIDE.md](EVALUATION_GUIDE.md)** instead.
>
> **Tier 1 and Tier 2 are now implemented and running.** Open the **Evaluate**
> tab in the interface, or see [§14](#14-what-is-implemented) for the mapping
> from each section below to the code, and [§15](#15-first-results) for what the
> implemented metrics say about the algorithms so far.

## Contents

1. [The one-paragraph answer to the reviewer](#1-the-one-paragraph-answer-to-the-reviewer)
2. [Diagnosis: what is actually wrong](#2-diagnosis-what-is-actually-wrong)
3. [The running example](#3-the-running-example)
4. [Tier 1 — Intrinsic metrics, externally grounded](#4-tier-1--intrinsic-metrics-externally-grounded)
5. [Tier 2 — Extrinsic, task-based evaluation](#5-tier-2--extrinsic-task-based-evaluation)
6. [Tier 3 — Human evaluation](#6-tier-3--human-evaluation)
7. [The spine: metric validation](#7-the-spine-metric-validation)
8. [Learning-based directions (RL / RLHF)](#8-learning-based-directions-rl--rlhf)
9. [Statistical protocol](#9-statistical-protocol)
10. [Baselines you must include](#10-baselines-you-must-include)
11. [Threats to validity](#11-threats-to-validity)
12. [Paper plan, venues, timeline](#12-paper-plan-venues-timeline)
13. [Reading list](#13-reading-list)
14. [What is implemented](#14-what-is-implemented)
15. [First results](#15-first-results)

---

## 1. The one-paragraph answer to the reviewer

> "Our original metrics were bespoke. We have replaced them with standard
> spatial-autocorrelation statistics (Moran's *I*, Geary's *C*) evaluated
> against a permutation null, standard graph-labelling measures (bandwidth,
> profile) benchmarked against Cuthill–McKee and spectral orderings, and an
> external ground-truth comparison against the real street identities in
> OpenStreetMap. We additionally validate every intrinsic metric against human
> performance in a pre-registered study of *N* participants, and report the
> criterion validity of each metric as a correlation with human error. In
> re-analysing our IGARSS results we discovered that the original Metric 1 was
> confounded with the size of the number range used (Spearman ρ = 0.97); we
> report this, and show that our headline conclusion survives correct analysis
> while the original ranking does not."

That last sentence is the paper. Read on for why it is true.

---

## 2. Diagnosis: what is actually wrong

There are five defects. The first is fatal and we can prove it from our own
data.

### 2.1 Metric 1 measures the number range, not spatial quality

Metric 1 is defined in the paper as

$$d(u,v) = |N(u) - N(v)|, \qquad d_{\text{Avg}}(u) = \frac{1}{|B_r(u)|}\sum_{v \in B_r(u)} d(u,v), \qquad M_1 = \frac{1}{|E|}\sum_{u \in E} d_{\text{Avg}}(u)$$

where $B_r(u)$ is the set of road segments whose geometry falls within a
buffer of radius $r$ of segment $u$, and $N(u)$ is the assigned road number.

**The problem: $M_1$ has units of "road numbers".** It is not scale-invariant.
An algorithm that uses the integers 1–17 will beat an algorithm that uses
1–201 *on identical spatial structure*, purely because its differences are
numerically smaller.

I recomputed $M_1$ on the actual data (buffer $r=250$ m, as in the paper),
alongside Moran's *I* — the textbook statistic for exactly this question — for
all 17 algorithm variants:

**Brooklyn / Network-1**

| Algorithm | $M_1$ | rank | number range | Moran's *I* | rank |
|---|---:|---:|---:|---:|---:|
| `mucs_BGP` | 3.74 | **1** | 17 | +0.182 | 13 |
| `middfs_BGP_d5` | 4.03 | 2 | 17 | +0.120 | 15 |
| `middfs_BucsGP_d5` | 4.21 | 3 | 17 | +0.080 | 17 |
| `middfs_B_d5` | 7.18 | 4 | 42 | +0.636 | 4 |
| `mucs_B` | 7.19 | 5 | 42 | +0.617 | 5 |
| … | | | | | |
| `mucs` | 24.22 | 10 | 201 | **+0.853** | **1** |
| `middfs_d1` | 25.29 | 11 | 201 | +0.828 | 2 |
| `bfs` | 63.11 | 17 | 226 | +0.236 | 12 |

The confound, quantified over all 17 variants:

| | Brooklyn/N-1 | Hyderabad/N-2 |
|---|---:|---:|
| **Spearman(*M*₁, number range)** | **+0.973** | **+0.948** |
| Spearman(*M*₁, Moran's *I*) | +0.200 | −0.079 |

$M_1$ is a near-perfect proxy for *how few distinct numbers an algorithm used*,
and is **uncorrelated with the spatial coherence it claims to measure**. The
bucketed/partitioned variants win Metric 1 because bucketing collapses many
segments onto one number and partitioning restarts the count — both shrink the
range. That is an artefact, not a result.

Under Moran's *I*, the ranking substantially inverts: `mucs_BGP`, ranked first
by $M_1$, is near the bottom; plain `mucs` is first.

> **The silver lining, and the story for the new paper.** MUCS is the best
> algorithm under Moran's *I* in *both* cities (0.853 Brooklyn, 0.944
> Hyderabad). **The paper's headline conclusion is correct — but Metric 1 could
> never have established it, and in fact points at a different algorithm.**
> "Right answer, wrong evidence, here is the right evidence" is a publishable
> and honest contribution.

### 2.2 Metric 1 is an unstandardised special case of a 1954 statistic

Geary's contiguity ratio is

$$C = \frac{(n-1)\sum_i\sum_j w_{ij}(x_i - x_j)^2}{2W\sum_i (x_i-\bar{x})^2}, \qquad W = \sum_i\sum_j w_{ij}$$

Metric 1 is the same numerator structure with $|x_i - x_j|$ instead of
$(x_i-x_j)^2$ and **without the variance normalisation in the denominator**.
That denominator is precisely what makes $C$ scale-invariant. So we did not
invent a metric — we re-derived Geary (1954) and dropped the part that makes it
valid. Saying this plainly in the paper turns the weakness into evidence of
diligence.

### 2.3 Normalising by the row minimum, then averaging, is a known error

Tables IV and V normalise each row by that row's minimum, then average the
normalised values down the column. This guarantees a 1.000 winner in every row
by construction, and averaging normalised ratios arithmetically is the error
Fleming & Wallace (1986) wrote a whole CACM paper about: **normalised ratios
must be summarised with the geometric mean**, otherwise the summary depends on
which system you chose as the baseline.

Fix: report raw values with confidence intervals, and if you must aggregate
normalised scores, use $\left(\prod_i r_i\right)^{1/n}$.

### 2.4 No uncertainty, and the winning margins are tiny

Table IV reports MUCS = 1.000 against MIDDFS *k*=1 = 1.0139 for Brooklyn
Network-1 — a **1.4 % margin**, from 30 random start points, with no standard
error, no confidence interval, and no test. With $n=30$ that margin is very
unlikely to be distinguishable from noise. Every headline comparison in the
paper is of this magnitude.

### 2.5 The metrics are circular, and there are no external baselines

All three metrics reward *numeric locality*. The modified search algorithms
are designed to traverse locally. The metrics therefore reward the algorithms
for doing the thing they were built to do, with no external reference point.
There is no comparison against:

- a **random** numbering (the floor),
- a **coordinate sort** (sort by *x*, then *y*) — trivial and often strong,
- a **space-filling curve** (Hilbert), which has *provable* locality bounds,
- **Cuthill–McKee** / spectral ordering, the standard bandwidth heuristics,
- the **actual street names** in the source data (real ground truth),
- **human judgement**.

Without a floor and a ceiling, a score of 1.0355 means nothing.

---

## 3. The running example

Everything below is demonstrated on one small network so the arithmetic can be
checked by hand. All numbers in this document were computed and verified.

### 3.1 The network

A 3×3 lattice, 100 m spacing: 9 nodes, 12 edges, every edge 100 m long.

```
      n7 ──e5── n8 ──e6── n9        y=200
      │         │         │
     e8        e10       e12
      │         │         │
      n4 ──e3── n5 ──e4── n6        y=100
      │         │         │
     e7        e9        e11
      │         │         │
      n1 ──e1── n2 ──e2── n3        y=0
     x=0      x=100     x=200
```

E–W edges (`e1`–`e6`) take **even** numbers, N–S edges (`e7`–`e12`) take
**odd**, per the paper's convention. Edge midpoints: `e1`=(50,0),
`e2`=(150,0), `e3`=(50,100), `e4`=(150,100), `e5`=(50,200), `e6`=(150,200),
`e7`=(0,50), `e8`=(0,150), `e9`=(100,50), `e10`=(100,150), `e11`=(200,50),
`e12`=(200,150).

### 3.2 Three candidate numberings

| | `e1` | `e2` | `e3` | `e4` | `e5` | `e6` | `e7` | `e8` | `e9` | `e10` | `e11` | `e12` |
|---|--|--|--|--|--|--|--|--|--|--|--|--|
| **A** street-based | 2 | 2 | 4 | 4 | 6 | 6 | 1 | 1 | 3 | 3 | 5 | 5 |
| **A′** = A doubled | 4 | 4 | 8 | 8 | 12 | 12 | 2 | 2 | 6 | 6 | 10 | 10 |
| **B** BFS gradient | 2 | 4 | 6 | 8 | 10 | 12 | 1 | 5 | 3 | 9 | 7 | 11 |

**A** buckets each physical street: the three N–S columns get 1, 3, 5 west to
east; the three E–W rows get 2, 4, 6 south to north. **A′** is *the same
scheme with every number doubled* — spatially identical, structurally
identical, only the range differs. **B** numbers edges in BFS order from `n1`.

### 3.3 Worked computation

With buffer $r=120$ m, the neighbour sets are (e.g.) $B_r(\texttt{e1}) =
\{\texttt{e2},\texttt{e3},\texttt{e7},\texttt{e9}\}$; total ordered
neighbour pairs $W = 60$, $n = 12$.

For **A**, segment `e1` with $N=2$: neighbours carry 2, 4, 1, 3, giving
$|0|,|2|,|1|,|1|$ and $d_{\text{Avg}}(\texttt{e1}) = 4/4 = 1.00$. Repeating
for all twelve and averaging gives $M_1(A) = 1.56$.

**The result that matters:**

| Numbering | range | $M_1$ ↓ | Moran's *I* ↑ | Geary's *C* ↓ |
|---|---:|---:|---:|---:|
| **A** street-based | 1–6 | **1.56** | +0.177 | 0.587 |
| **A′** = A, doubled | 2–12 | 3.12 | +0.177 | 0.587 |
| **B** BFS gradient | 1–12 | 2.83 | **+0.452** | **0.400** |

Read the first two rows. **A′ is the identical numbering scheme and scores
exactly twice as badly on $M_1$** — worse than B. Moran's *I* and Geary's *C*
are, correctly, unchanged. This is the whole argument of §2.1 in three rows.

### 3.4 …and a warning about over-correcting

Global Moran's *I* prefers **B** (0.452) over **A** (0.177). Is B really
better? Not necessarily — the odd/even convention deliberately interleaves
*two independent number systems*, and any global statistic that pools them
sees an artificially rough surface. Stratifying by parity:

| Stratum | A | B | null $E[I]$ |
|---|---:|---:|---:|
| N–S segments (odd) | **+0.4286** | +0.3061 | −0.20 |
| E–W segments (even) | **+0.4286** | +0.4041 | −0.20 |

**A wins both strata.** So $M_1$ says A, global Moran says B, stratified Moran
says A. Three metrics, three answers.

> **This is the core methodological lesson.** Which numbering is "better" is
> not determined by the data alone; it is determined by the analysis choice.
> The only escape is to (i) pre-register the analysis, (ii) ground each metric
> in an external standard, and (iii) **validate the metrics against human
> judgement** — §7.

---

## 4. Tier 1 — Intrinsic metrics, externally grounded

Cheap, deterministic, computable for every algorithm × city. These replace the
paper's three metrics.

### 4.1 Spatial autocorrelation with a permutation null

**Moran's *I***, row-standardised weights $w_{ij} = 1/|B_r(i)|$ for
$j \in B_r(i)$:

$$I = \frac{n}{W}\cdot\frac{\sum_i\sum_j w_{ij}(x_i-\bar{x})(x_j-\bar{x})}{\sum_i (x_i-\bar{x})^2}, \qquad E[I]_{H_0} = \frac{-1}{n-1}$$

**Geary's *C*** as in §2.2; $C < 1$ indicates positive autocorrelation, and
*C* is more sensitive to local dissimilarity than *I*.

**The permutation null is the critical addition.** Randomly reassign the
*exact same multiset of numbers* to segments $R = 999$ times, recompute *I*,
and report

$$z = \frac{I_{\text{obs}} - \mu_{\text{perm}}}{\sigma_{\text{perm}}}, \qquad p = \frac{1 + \#\{I_{\text{perm}} \ge I_{\text{obs}}\}}{R+1}$$

This holds the number range, the tie structure and the bucket sizes *exactly*
fixed, so the confound of §2.1 is impossible by construction. Observed *z* on
real data ranges from +3.8 (`middfs_BucsGP_d5`) to +37.7 (`mucs`) on Brooklyn
Network-1 — all significant, but differing by an order of magnitude in effect
size, which is the informative part.

**Report both stratified and pooled**, per §3.4, and pre-register which is
primary.

### 4.2 Distance-matrix correlation (Mantel test)

Buffer radius $r$ is an arbitrary choice; the Mantel test removes it. Build
two $m \times m$ matrices, $D^{\text{geo}}_{uv}$ (network or Euclidean
distance between segments) and $D^{\text{num}}_{uv} = |N(u)-N(v)|$, and
compute the Pearson correlation between their off-diagonal entries, with
significance from permuting the rows/columns of one matrix.

$$r_M = \text{corr}\left(\text{vec}(D^{\text{geo}}), \text{vec}(D^{\text{num}})\right)$$

Mantel (1967) is standard in ecology and spatial epidemiology; it is
scale-invariant, buffer-free, and has an exact permutation test.

### 4.3 Graph-labelling measures with competitive ratios

Road numbering *is* a graph labelling problem on the line graph $L(G)$ (nodes
= road segments, edges = shared intersections). This connects it to fifty
years of sparse-matrix reordering literature.

**Bandwidth** and **profile**:

$$B(N) = \max_{(u,v)\in E(L(G))} |N(u)-N(v)|, \qquad P(N) = \sum_{u} \left(N(u) - \min_{v \in \text{adj}(u)\cup\{u\}} N(v)\right)$$

Report as a **competitive ratio against established heuristics**:

$$\rho_{\text{CM}} = \frac{B(N_{\text{ours}})}{B(N_{\text{Cuthill–McKee}})}$$

Cuthill–McKee (1969), Reverse CM, GPS (Gibbs–Poole–Stockmeyer 1976) and
spectral ordering (sort by the Fiedler vector of the graph Laplacian) are all
one function call in SciPy/NetworkX. If MUCS beats RCM on bandwidth, that is a
real, externally meaningful claim.

### 4.4 Space-filling-curve reference

Map each segment midpoint to its **Hilbert index** at order $k$ and rank the
segments; call this $H(u)$. Hilbert curves have *provable* clustering
properties (Moon et al. 2001). Define **locality stretch**

$$S = \frac{\mathbb{E}\big[\,|N(u)-N(v)| \,\big|\, d_{\text{geo}}(u,v)\le r\,\big]}{\mathbb{E}\big[\,|H(u)-H(v)| \,\big|\, d_{\text{geo}}(u,v)\le r\,\big]}$$

after rank-normalising both to $[0,1]$. $S \approx 1$ means "as
locality-preserving as a Hilbert curve"; $S < 1$ would be a genuinely strong
result. This gives the **ceiling** that §2.5 says is missing.

### 4.5 Agreement with real street identity (external ground truth)

This is the strongest single fix available, because the ground truth already
exists in the data. The bucketing step claims to group segments belonging to
the same physical road. OpenStreetMap already records which segments belong to
the same named street. So treat both as **clusterings** of the segment set and
compare them with standard clustering-agreement measures:

- **Adjusted Rand Index** (Hubert & Arabie 1985), chance-corrected, $\le 1$
- **Normalised Mutual Information**
- **V-measure** (homogeneity/completeness harmonic mean)

$$\text{ARI} = \frac{\sum_{ij}\binom{n_{ij}}{2} - \left[\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}\right]/\binom{n}{2}}{\tfrac{1}{2}\left[\sum_i\binom{a_i}{2}+\sum_j\binom{b_j}{2}\right] - \left[\sum_i\binom{a_i}{2}\sum_j\binom{b_j}{2}\right]/\binom{n}{2}}$$

An ARI of 0.7 between algorithmic buckets and real OSM streets is a claim no
reviewer can call self-invented.

> ⚠️ **Data blocker.** The bundled Brooklyn shapefile has the single value
> `East 40th Street` copied across all 193 records, Melbourne has no name
> column at all, and Hyderabad names only 141 of 1351 segments. **You must
> re-extract the networks from OSM with `name`/`ref` preserved** (OSMnx
> `graph_from_place`, keep `name`, `ref`, `highway`, `osmid`) before this
> analysis is possible. Do this first — it is the highest-value data task on
> the list.

### 4.6 Address ambiguity and bucket contiguity

Bucketing trades uniqueness for coherence, and the paper never measures the
cost. For each number $k$, let $S_k = \{u : N(u)=k\}$:

- **Multiplicity** $\mu = \frac{1}{|K|}\sum_k |S_k|$ — how many segments share an address
- **Contiguity** $\gamma = \frac{\#\{k : L(G)[S_k] \text{ is connected}\}}{|K|}$ — the fraction of numbers forming *one* physical road
- **Dispersion** $\delta_k = \text{diam}(S_k)$ in metres — how far apart segments sharing a number can be

A scheme with $\mu = 4$ and $\gamma = 1.0$ is excellent (real streets). A
scheme with $\mu = 4$ and $\gamma = 0.3$ is broken: "number 12" names three
disconnected pieces of the city. `mucs_BGP` has 40 shared-number groups on
Brooklyn Network-1 — **nobody has checked whether they are connected.** Check
this; it may be a finding either way.

### 4.7 Stability and robustness

The paper asserts independence from the start node but only demonstrates
*coverage*. Measure agreement directly.

- **Start-point stability.** For 30 random start edges, compute pairwise
  Kendall's $\tau$ between the resulting orderings (or ARI between bucket
  partitions). Report mean ± SD. High variance = the "address" of a road
  depends on an arbitrary implementation choice, which is disqualifying for
  deployment.
- **Perturbation robustness.** Delete or add $k\%$ of edges (simulating new
  construction), re-run, and measure **churn**: the fraction of unperturbed
  segments whose number changed. Sweep $k \in \{1,2,5,10\}$.

$$\text{churn}(k) = \frac{1}{|E'|}\left|\{u \in E' : N_{\text{before}}(u) \neq N_{\text{after}}(u)\}\right|$$

A real addressing system cannot renumber the city when one cul-de-sac is
built. This is a genuinely novel evaluation axis for this problem and is
likely to differentiate the algorithms strongly.

### 4.8 Description length (optional, elegant)

How compressible is the numbering given the geometry? Fit a simple predictor
$\hat{N}(u)$ from coordinates (e.g. *k*-NN or local linear regression) and
measure residual entropy. A systematic scheme is compressible; a haphazard one
is not. This is the information-theoretic formalisation of "intuitive", and it
directly predicts the human inference task in §6.2.

$$\text{PI} = \text{median}_u \frac{|\hat{N}(u) - N(u)|}{N_{\max}-N_{\min}}$$

---

## 5. Tier 2 — Extrinsic, task-based evaluation

Does the numbering *do useful work*? These need no participants and are
strong, defensible contributions on their own.

### 5.1 Greedy routing success and stretch

An addressing scheme is useful if you can navigate by it. Formally: is $N$ a
**greedy embedding** into $\mathbb{Z}$? From segment $u$, aiming at target
$t$, step to the neighbour minimising $|N(v) - N(t)|$; you are stuck if no
neighbour improves on $|N(u)-N(t)|$.

- **Greedy success rate** $\;\sigma = \Pr[\text{reach } t]$ over all
  $(u,t)$ pairs, or a large random sample
- **Stretch** $\;\text{str} = \mathbb{E}\!\left[\dfrac{\text{hops}_{\text{greedy}}(u,t)}{\text{hops}_{\text{shortest}}(u,t)}\right]$ over successful pairs

*Worked example.* Under numbering **A**, routing from `e1` (2) to `e6` (6):
neighbours of `e1` are `e2`(2), `e7`(1), `e9`(3) → pick `e9` (|3−6|=3); from
`e9` pick `e4`(4); from `e4` pick `e12`(5); from `e12` reach `e6`. Four hops
against a shortest path of three (`e1`→`e9`→`e10`→`e6`), so stretch = 1.33.

*Worked failure.* Under **A**, routing from `e2`(2) to `e8`(1): the greedy step
lands on `e7`, which also carries number 1. Because bucketing makes numbers
non-unique, **the target is ambiguous and greedy routing cannot distinguish
`e7` from `e8`**. This is exactly the cost §4.6 measures, surfacing as a
concrete navigational failure. Report $\sigma$ separately for bucketed and
unbucketed variants.

This connects to the geometric-routing literature (Papadimitriou & Ratajczak
2005; Kleinberg 2007) — again, external grounding.

### 5.2 Delivery-tour quality, against a classical baseline

If addresses are spatially coherent, **sorting deliveries by address number
should approximate a good tour**. Sample $k$ random delivery addresses, order
them by $N$, and measure the resulting tour length against a 2-opt/Concorde
optimum:

$$\text{TR}(k) = \frac{L(\text{tour ordered by } N)}{L(\text{near-optimal TSP tour})}$$

The classical baseline is **Bartholdi & Platzman (1982)**, who showed a
space-filling-curve ordering yields tours roughly 25 % above optimal. If your
numbering achieves TR ≈ 1.25 you match a celebrated heuristic; if TR ≈ 1.5 you
do not. Either is a real, citable result. Sweep $k \in \{10, 25, 50, 100\}$.

### 5.3 Address lookup cost

Model a person searching for address $N_t$ from a random start, able to read
the numbers on segments they visit and moving greedily. Report expected
segments visited, and compare against the theoretical optimum $O(\log m)$ for
a perfectly ordered scheme and $O(m)$ for random.

### 5.4 Emergency-dispatch simulation

Given an incident at a random address and responders at depots, measure time
lost to addressing ambiguity (segments that must be checked because several
share a number). Directly monetisable and highly compelling to reviewers in
applied GIS venues.

---

## 6. Tier 3 — Human evaluation

This is what the interface in this repository was built for. The objective is
not "do people like it" but **do people's judgements agree with the
algorithm's, and can people use the numbering to do things**.

### 6.1 Constructs

| Construct | Definition | Study |
|---|---|---|
| **Predictability** | Can a person infer a hidden number from context? | A |
| **Findability** | Can a person locate a given number quickly? | B |
| **Spatial inference** | Does the number convey relative position? | C |
| **Preference** | Which scheme is judged more sensible? | D |
| **Memorability** | Are numbers retained after exposure? | E |
| **Cognitive load** | Effort required to use the scheme | NASA-TLX |

### 6.2 Study A — number inference (already prototyped)

**Task.** A map is shown with $k$ road numbers blanked. The participant clicks
a blanked road and types the number they expect.

**Design.** Within-subjects, algorithm as the repeated factor, Latin-square
counterbalanced across participants to control order effects. Different city
per block to prevent learning the specific map. Recommend 4–5 algorithms, not
17: `mucs`, `mucs_BGP`, `middfs_d5`, `bfs` (baseline), and a **random
numbering** as the floor.

**Dependent variables.**

$$\text{err}_{\text{abs}} = |g - N(u)|, \qquad \text{err}_{\text{norm}} = \frac{|g - N(u)|}{N_{\max}-N_{\min}}, \qquad \text{parity} = \mathbb{1}[g \equiv N(u) \bmod 2]$$

plus response time and number of pan/zoom actions before answering (already
logged by the interface).

> ⚠️ **Use `err_norm`, not `err_abs`.** The confound of §2.1 applies with full
> force to the human study: a scheme with range 1–17 will produce smaller
> absolute errors than one with range 1–201 regardless of quality. Normalise,
> or use rank-based error. **This single decision determines whether the human
> study is valid.**

**Parity is the cleanest DV.** It is binary, scale-free, completely immune to
the range confound, and directly tests the paper's N–S/E–W claim. Analyse with
logistic mixed-effects regression. If participants cannot recover parity above
chance, the odd/even convention — a central design decision of the RNA — has
no human support, which is a publishable finding in itself.

**Confound to control:** roads near the 45° diagonal have arbitrary parity (see
the main README). **Exclude them from parity scoring** or model them
separately.

### 6.3 Study B — findability

**Task.** "Find road number 47." Measure time-to-first-click, time-to-correct,
pan/zoom count, and path efficiency (interface distance travelled ÷ minimum).
All four are already captured in `logs/events.jsonl`.

**Why it matters.** This is the actual use case of an addressing system and it
is measured objectively, with no self-report.

### 6.4 Study C — relative spatial inference

**Task.** "Is road 82 north or south of road 47?" / "Which of these three
roads is nearest to road 12?" — with the map **hidden**, so the participant
must reason from the numbers alone.

**DV.** Accuracy, response time. **This is the sharpest test of whether the
numbering encodes geography**, and it is a direct human analogue of Moran's
*I*. Expect a strong correlation with §4.1 — which is exactly the validation
argument of §7.

### 6.5 Study D — pairwise preference and Bradley–Terry

**Task.** Two maps side by side, same city, numbered by different algorithms.
"Which numbering makes more sense to you?" Forced choice.

**Model.** Bradley & Terry (1952):

$$\Pr(i \succ j) = \frac{e^{\beta_i}}{e^{\beta_i}+e^{\beta_j}}$$

Fit $\beta$ by maximum likelihood to obtain a **latent quality score per
algorithm with confidence intervals** — a principled ranking from noisy
pairwise judgements. With $A$ algorithms you need $\binom{A}{2}$ pairs; at
$A=5$ that is 10 comparisons per participant, very manageable. Extend to
Bradley–Terry–Luce with ties, or Thurstone Case V, if you allow "no
preference".

This also produces exactly the data needed for the reward model in §8.

### 6.6 Study E — memorability

Show a numbered map for 60 s, remove it, then ask for the numbers of five
highlighted roads. DV: recall accuracy, normalised. Tests cognitive economy —
schemes with fewer distinct numbers should win, which is a legitimate
*advantage* of bucketing and a chance to show that trade-off honestly (against
the ambiguity cost of §4.6 and §5.1).

### 6.7 Instruments

Use validated instruments; do not write your own questionnaire.

- **NASA-TLX** (Hart & Staveland 1988) — six sub-scales of workload
- **SUS** (Brooke 1996) — 10 items, benchmarked, gives a percentile
- **Santa Barbara Sense of Direction scale** — covariate for individual spatial
  ability; controls a major source of between-subject variance

### 6.8 Participants, power, ethics

**Power analysis.** For a within-subject paired comparison at $\alpha=0.05$,
power $1-\beta = 0.8$, and a medium effect $d=0.5$:

$$n = \frac{(z_{1-\alpha/2}+z_{1-\beta})^2}{d^2} = \frac{(1.96+0.84)^2}{0.25} \approx 32$$

With Holm correction over 10 pairwise comparisons the effective $\alpha$ falls
to 0.005, requiring $n \approx 60$. **Budget 60–80 participants.** For
mixed-effects designs, run a simulation-based power analysis (`simr` in R)
rather than a closed form.

**Recruitment.** Prolific gives better data quality than MTurk for this kind
of task. Include attention checks and a screening question on familiarity with
each city — **familiarity is a serious confound**, since a Brooklyn resident
knows the real street grid. Consider recruiting participants unfamiliar with
all three cities, and separately a familiar cohort as a planned contrast.

**Ethics.** IIIT-H institutional review, informed consent, right to withdraw,
no PII in `events.jsonl` beyond a random participant ID, fair pay at or above
the platform minimum. Get approval **before** piloting; journals increasingly
require the approval number.

**Pre-register** on OSF or AsPredicted: hypotheses, DVs, exclusion rules,
analysis plan. Pre-registration is the single most effective answer to "you
made up your evaluation", because it proves the analysis was not chosen after
seeing the results.

---

## 7. The spine: metric validation

**This section is what makes the paper publishable.** Everything above is
ingredients; this is the argument.

The reviewer's objection is not "you used a metric we haven't seen". It is
"you have not shown your metric measures anything real". The answer is
**criterion validity**: show that the cheap automatic metric predicts the
expensive human outcome.

**Procedure.**

1. Compute all Tier-1 metrics for $A$ algorithms × $C$ cities → a matrix of
   metric values.
2. Run Studies A–E → human outcome per (algorithm, city) cell.
3. For each metric $m$, compute the correlation across cells between the
   metric and the human outcome:

$$\rho_m = \text{Spearman}\big(m(a,c),\; \text{human}(a,c)\big)$$

4. Report a validity table:

| Metric | ρ with human inference error | ρ with findability time | ρ with preference (BT score) |
|---|---:|---:|---:|
| Moran's *I* (stratified) | | | |
| Geary's *C* | | | |
| Mantel *r* | | | |
| Bandwidth ratio vs RCM | | | |
| Hilbert stretch *S* | | | |
| ARI vs real streets | | | |
| Bucket contiguity γ | | | |
| Greedy success σ | | | |
| **Paper's original *M*₁** | | | |

5. **Recommend the metric with the highest validity as the standard proxy**,
   and report that the original $M_1$ has validity ≈ 0 (which, given §2.1, is
   the likely outcome — and is a *result*, not a failure).

With $A \times C = 5 \times 3 = 15$ cells you have enough for a correlation
with a wide CI; report it as such, and consider a hierarchical model that
pools across cells rather than treating them as independent.

**This converts "metrics we made up" into "metrics we validated against human
judgement", which is the accepted standard in every field that faces this
problem** — machine translation (BLEU vs. human adequacy), summarisation
(ROUGE), image quality (SSIM/LPIPS vs. MOS). Cite that precedent explicitly;
it is a well-trodden path and reviewers recognise it.

---

## 8. Learning-based directions (RL / RLHF)

Optional for the journal resubmission, excellent for a follow-up. Order by
risk.

### 8.1 Low risk — learned metric (do this one)

Train a model to predict human judgement from the Tier-1 metric vector:
$\hat{h} = f_\phi(m_1,\dots,m_k)$. With 15 cells you can only fit something
tiny (ridge regression), but it gives a **composite validated metric** and
tells you which metrics carry independent signal.

### 8.2 Medium risk — preference-based algorithm selection

From Study D you have pairwise preferences. Fit a **reward model**
$r_\theta(G, N)$ over (network, numbering) features with the standard
preference loss:

$$\mathcal{L}(\theta) = -\mathbb{E}_{(N^+,N^-)}\big[\log \sigma\big(r_\theta(G,N^+) - r_\theta(G,N^-)\big)\big]$$

This is the Bradley–Terry likelihood and the same objective as RLHF reward
modelling (Christiano et al. 2017). Then **use $r_\theta$ to select which of
the 17 existing variants to deploy for a given city** — no RL needed, no new
algorithm, and it directly demonstrates human alignment.

### 8.3 Higher risk — RL for numbering

Formulate numbering as an MDP:

- **State** $s_t$: the graph with a partial assignment — GNN encoding of
  $L(G)$ with per-node features (assigned number or ∅, bearing, length, degree)
- **Action** $a_t$: choose the next unnumbered segment and its number (or,
  more tractably, choose the next segment to expand, keeping the counter
  implicit — this makes the action space $O(m)$ rather than $O(m^2)$)
- **Reward**: $R = \lambda_1 r_\theta(G,N) + \lambda_2 I_{\text{Moran}} +
  \lambda_3 \gamma_{\text{contiguity}} - \lambda_4 \text{churn}$, with terminal
  reward dominant and shaped intrinsic terms for credit assignment
- **Algorithm**: PPO with a GNN policy; or, cheaper and often as good,
  **behaviour cloning from the best hand-designed algorithm followed by
  preference fine-tuning**

**Honest risk assessment.** This is a substantial engineering effort, the
reward is sparse, and a learned policy that beats MUCS by a few percent on a
learned reward is a weak result that invites the *same* circularity criticism.
**Do not lead the resubmission with this.** The defensible framing is: "we
learn a policy from human preferences and show it beats hand-designed
algorithms *in a held-out human study*" — i.e. the validation must be human,
not the learned reward.

### 8.4 LLMs as proxy participants

Tempting for scaling. Use only for **pilot/screening**, and always report the
correlation with real human responses on an overlapping subset. Multimodal
models can be shown map images and asked the Study A question. Treat
agreement with humans as an empirical question to be measured, not assumed;
current evidence on LLMs-as-participants is mixed and reviewers are sceptical.

---

## 9. Statistical protocol

**Model.** For Study A, per-trial error with participants and items as
crossed random effects:

```
err_norm ~ algorithm + city + (1 + algorithm | participant) + (1 | road_segment)
```

Fit with `lme4::lmer` in R, or `statsmodels`/`bambi` in Python. For binary
parity, `glmer(family = binomial)`. Report fixed-effect estimates with 95 %
CIs, not just *p*-values.

**Corrections.** Holm–Bonferroni for a small confirmatory family;
Benjamini–Hochberg FDR for the larger exploratory metric-validation table.
State which comparisons are confirmatory in the pre-registration.

**Effect sizes.** Always: Cohen's *d* for pairwise, partial $\eta^2$ or $R^2_{\text{marginal/conditional}}$ for models. A 1.4 % difference (§2.4) is
almost certainly $d < 0.1$ — report it as such and say plainly that the
algorithms are indistinguishable on that metric.

**Aggregation.** Geometric mean for normalised ratios (§2.3). Bootstrap CIs
(10 000 resamples) for anything without a closed form.

**Reproducibility.** Fixed seeds, archived numbering CSVs, analysis scripts
in the repo, data and code on Zenodo with a DOI.

---

## 10. Baselines you must include

Non-negotiable. Without a floor and a ceiling the numbers are meaningless.

| Baseline | Role | Why |
|---|---|---|
| **Random permutation** | floor | Any metric must separate this from everything else |
| **Coordinate sort** (x then y) | naive | Trivial to implement, often surprisingly strong |
| **Hilbert curve order** | strong non-graph | Provable locality bounds (Moon et al. 2001) |
| **Cuthill–McKee / RCM** | classical graph | The standard bandwidth heuristic since 1969 |
| **Spectral (Fiedler) order** | classical graph | Principled, optimal for a relaxed objective |
| **Real OSM street names** | ceiling / ground truth | What humans actually use today |
| **DFS / BFS** | existing | Already in the paper |

The real-street baseline is the most valuable and the one most likely to be
demanded by reviewers: *"is your automatic numbering better or worse than the
addressing the city already has?"*

---

## 11. Threats to validity

State these explicitly in the paper; reviewers reward candour.

**Construct validity.** "Intuitive" is not directly observable. We
operationalise it as inference accuracy, findability and preference, and we
should say that these three may diverge — indeed §3.4 shows different metrics
already rank the same schemes differently.

**Internal validity.** Familiarity with the city; learning effects across
blocks (control by Latin square); the 45°-diagonal parity confound; the range
confound of §2.1 recurring in human DVs.

**External validity.** Three cities, all with fairly regular topology; six
networks; western-and-Indian addressing conventions only. **Japanese
block-based addressing is a fundamentally different paradigm** — acknowledging
this, and ideally recruiting participants from a block-addressing culture,
would considerably strengthen the paper's generality claims.

**Ecological validity.** Reading numbers off a screen is not navigating a city.
Be explicit that this is a proxy, and consider a small field study or a
street-view-based variant as future work.

**Statistical conclusion validity.** Under-powered comparisons of ~1 %
differences (§2.4); multiple comparisons across 17 algorithms × 3 cities × 3
metrics — 153 implicit tests in the original paper, uncorrected.

---

## 12. Paper plan, venues, timeline

### 12.1 Suggested structure

> **Title.** *How Should Automated Road Numbering Be Evaluated? Standardised
> Metrics, Task-Based Benchmarks, and a Human Study*

1. **Introduction** — addressing matters; automated numbering exists; but
   evaluation is ad hoc, and we show it can invert conclusions
2. **Related work** — addressing; graph labelling; spatial autocorrelation;
   wayfinding and spatial cognition; evaluation methodology in adjacent fields
3. **The evaluation problem** — §2 here, with Table 1 = the range confound.
   *This is the hook.*
4. **A three-tier framework** — §4, §5, §6
5. **Human studies** — design, pre-registration, results
6. **Metric validation** — §7. *This is the contribution.*
7. **Re-evaluation of existing algorithms** — the corrected ranking; MUCS still
   wins, for defensible reasons now
8. **Discussion, limitations, recommendations** — a checklist for future work
   in this area

The paper's contribution is **the evaluation framework**, not a new algorithm.
That is a legitimate and often high-impact contribution, and it directly
answers the rejection.

### 12.2 Venues

| Venue | Fit | Notes |
|---|---|---|
| **IJGIS** | ★★★★★ | Top GIScience journal; values methodological rigour; human-subjects work welcome |
| **Transactions in GIS** | ★★★★ | Slightly more applied, faster turnaround |
| **Computers, Environment and Urban Systems** | ★★★★ | Strong on urban analytics + evaluation |
| **Cartography and GIS (CaGIS)** | ★★★★ | Ideal if the HCI/cartographic angle leads |
| **ACM SIGSPATIAL** | ★★★ | Conference; good for the algorithmic/benchmark half |
| **CHI / CSCW** | ★★★ | Only if the human study is the whole paper and is very strong |

**Recommendation: IJGIS**, with the framework as the contribution.

### 12.3 Twelve-month plan

| Phase | Months | Work |
|---|---|---|
| 0 | 1 | **Re-extract OSM data with street names** (§4.5 blocker). Add 3–4 more cities, deliberately including a non-grid topology (e.g. central London, Tokyo) |
| 1 | 1–3 | Implement Tier 1 + all baselines (§10). Reproduce and document the range confound rigorously |
| 2 | 2–4 | Implement Tier 2 simulations |
| 3 | 3–4 | Finalise study protocols; IRB; pre-register; pilot with 8–10 participants |
| 4 | 5–7 | Run Studies A–E, 60–80 participants |
| 5 | 7–9 | Metric validation (§7); analysis |
| 6 | 8–10 | Optional: preference-based reward model (§8.2) |
| 7 | 9–12 | Write; internal review; submit |

**Critical path is Phase 0.** Without street names the strongest external
validation (§4.5) is impossible, and it gates nothing else — do it first.

### 12.4 The five things that most change the outcome

1. **Re-extract OSM data with names** — unblocks external ground truth
2. **Report the range confound honestly** — turns the rejection into the hook
3. **Normalise the human DV; use parity as the primary** — makes the study valid
4. **Pre-register** — the strongest possible reply to "you made it up"
5. **Report the metric-validity table** — the actual contribution

---

## 13. Reading list

*Verify all citations before use; these are given by author/year/title.*

**Spatial statistics**
- Moran, P. A. P. (1950). Notes on continuous stochastic phenomena. *Biometrika* 37.
- Geary, R. C. (1954). The contiguity ratio and statistical mapping. *The Incorporated Statistician* 5.
- Mantel, N. (1967). The detection of disease clustering and a generalized regression approach. *Cancer Research* 27.
- Anselin, L. (1995). Local indicators of spatial association — LISA. *Geographical Analysis* 27.

**Graph labelling / ordering**
- Cuthill, E. & McKee, J. (1969). Reducing the bandwidth of sparse symmetric matrices. *ACM National Conference*.
- Gibbs, N., Poole, W. & Stockmeyer, P. (1976). An algorithm for reducing the bandwidth and profile of a sparse matrix. *SIAM J. Numerical Analysis*.
- Díaz, J., Petit, J. & Serna, M. (2002). A survey of graph layout problems. *ACM Computing Surveys* 34.

**Space-filling curves**
- Bartholdi, J. J. & Platzman, L. K. (1982). An *O*(*n* log *n*) planar travelling salesman heuristic based on spacefilling curves. *Operations Research Letters*.
- Moon, B., Jagadish, H. V., Faloutsos, C. & Saltz, J. (2001). Analysis of the clustering properties of the Hilbert space-filling curve. *IEEE TKDE* 13.

**Geometric routing**
- Papadimitriou, C. & Ratajczak, D. (2005). On a conjecture related to geometric routing. *Theoretical Computer Science*.
- Kleinberg, R. (2007). Geographic routing using hyperbolic space. *IEEE INFOCOM*.

**Evaluation methodology**
- Fleming, P. J. & Wallace, J. J. (1986). How not to lie with statistics: the correct way to summarize benchmark results. *CACM* 29.
- Hubert, L. & Arabie, P. (1985). Comparing partitions. *Journal of Classification* 2.

**Spatial cognition & wayfinding**
- Lynch, K. (1960). *The Image of the City*. MIT Press.
- Golledge, R. G. (ed.) (1999). *Wayfinding Behavior*. Johns Hopkins.
- Montello, D. R. (2005). Navigation. In *Cambridge Handbook of Visuospatial Thinking*.
- Hillier, B. & Hanson, J. (1984). *The Social Logic of Space*. Cambridge. (space syntax)

**Human factors instruments**
- Hart, S. G. & Staveland, L. E. (1988). Development of NASA-TLX. *Human Mental Workload*.
- Brooke, J. (1996). SUS: A quick and dirty usability scale.
- Hegarty, M. et al. (2002). Santa Barbara Sense of Direction scale. *Intelligence* 30.

**Preference modelling / RLHF**
- Bradley, R. A. & Terry, M. E. (1952). Rank analysis of incomplete block designs. *Biometrika* 39.
- Christiano, P. et al. (2017). Deep reinforcement learning from human preferences. *NeurIPS*.
- Ouyang, L. et al. (2022). Training language models to follow instructions with human feedback. *NeurIPS*.

**Statistics**
- Bates, D. et al. (2015). Fitting linear mixed-effects models using lme4. *J. Statistical Software* 67.
- Cohen, J. (1988). *Statistical Power Analysis for the Behavioral Sciences*.
- Lakens, D. (2013). Calculating and reporting effect sizes. *Frontiers in Psychology* 4.

**Urban networks / data**
- Barthélemy, M. (2011). Spatial networks. *Physics Reports* 499.
- Porta, S., Crucitti, P. & Latora, V. (2006). The network analysis of urban streets: a primal approach. *Environment and Planning B*.
- Boeing, G. (2017). OSMnx. *Computers, Environment and Urban Systems* 65.

---

## 14. What is implemented

Everything in Tiers 1 and 2 that does not require re-running the numbering
algorithm or recruiting participants. Open the **Evaluate** tab, choose the
numberings to compare, and run.

| Section | Metric | Where | In UI |
|---|---|---|---|
| §4.1 | Moran's *I*, Geary's *C*, permutation null (*z*, *p*) | `rna/metrics.py` | ✅ |
| §4.1 | Parity-stratified Moran's *I* | `rna/metrics.py` | ✅ |
| §4.2 | Mantel *r* with permutation test | `rna/metrics.py` | ✅ |
| §4.3 | Bandwidth, profile, ratio vs Reverse Cuthill-McKee | `rna/metrics.py`, `rna/graph.py` | ✅ |
| §4.4 | Hilbert locality stretch | `rna/geometry.py` | ✅ |
| §4.5 | ARI / NMI against real street names | `rna/metrics.py` | ✅ ¹ |
| §4.6 | Multiplicity, bucket contiguity, dispersion | `rna/metrics.py` | ✅ |
| §4.7 | Start-point stability, perturbation churn | — | ❌ ² |
| §4.8 | Predictability / inference error | `rna/metrics.py` | ✅ |
| §5.1 | Greedy routing success, stretch, ambiguous arrivals | `rna/metrics.py` | ✅ |
| §5.2 | Delivery tour ratio vs 2-opt | `rna/metrics.py` | ✅ |
| §5.3 | Lookup cost (segments visited) | `rna/metrics.py` | ✅ |
| §10 | Random, coordinate, Hilbert, Hilbert+parity, RCM, spectral baselines | `rna/baselines.py` | ✅ |
| §2.1 | Metric 1 range-confound diagnostic | `rna/evaluate.py` | ✅ |
| §2 | The paper's own Metrics 1 and 3, for side-by-side comparison | `rna/metrics.py` | ✅ |
| §6 | Human studies | study designs only | ❌ ³ |
| §7 | Metric validation against human outcomes | needs §6 | ❌ ³ |
| §8 | RL / RLHF | needs §6 preferences | ❌ ³ |

¹ Computed, but only Hyderabad has usable street names — see the §4.5 blocker.
² Both need the numbering algorithm itself, which is outside this repository;
the interface only consumes its CSV output.
³ Requires participants. The task preview and interaction log are in place.

**Correctness.** `analysis/test_metrics.py` runs 86 checks: exact reproduction
of the §3.3 and §3.4 worked numbers, textbook null expectations, scale- and
translation-invariance, agreement between the fast fused permutation path and
the direct implementation, closed-form results on paths and identical
partitions, and graceful handling of degenerate input.

Three independent signals say the implementation is sound:

- a **random permutation** scores Moran's *I* ≈ 0 and Geary's *C* ≈ 1.00 on
  every network — exactly their null values;
- the **Hilbert baseline's delivery-tour ratio is 1.15–1.31** across all six
  networks, against the ≈ 1.25 that Bartholdi & Platzman (1982) report for
  space-filling-curve tours;
- **Reverse Cuthill-McKee** has the lowest bandwidth everywhere, which is what
  it is designed to minimise.

> **A trap worth recording.** The first implementation of bandwidth repeated the
> Metric 1 mistake in disguise. Raw bandwidth on a bucketed scheme with 18
> distinct numbers cannot exceed 17, so `mucs_BGP` appeared to *beat* Reverse
> Cuthill-McKee (16 vs 23). Dividing by the label span fixes it: the honest
> figures are 0.94 against RCM's 0.12, i.e. RCM is roughly eight times better.
> Any measure built on numeric gaps needs this normalisation.

## 15. First results

Brooklyn Network-1, 250 m buffer, 199 permutations, geometry-based neighbours.
These are single runs at one setting on one network — indicative, not final —
but they already reframe the problem.

| Numbering | Moran's *I* ↑ | Geary's *C* ↓ | Bandwidth ↓ | Greedy success ↑ | Tour ratio ↓ |
|---|---:|---:|---:|---:|---:|
| MUCS | 0.783 | 0.194 | 0.286 | 10.1 % | 2.40 |
| MUCS + Bucketing | 0.590 | 0.411 | 0.730 | 15.8 % | 2.39 |
| MUCS + Min-cut + Bucketing | 0.119 | 0.858 | 0.941 | 31.4 % | 2.71 |
| MIDDFS (k=5) | 0.759 | 0.232 | 0.266 | 9.5 % | 2.24 |
| MDFS | 0.107 | 0.876 | 1.000 | 6.3 % | 2.26 |
| BFS | 0.225 | 0.769 | 0.823 | 10.6 % | 2.48 |
| DFS | 0.086 | 0.915 | 0.948 | 6.3 % | 2.11 |
| *Random permutation* (floor) | −0.032 | 1.031 | 0.984 | 3.8 % | 2.98 |
| *Coordinate sort* (naive) | **0.828** | **0.127** | 0.214 | 20.1 % | 2.28 |
| *Hilbert curve* (ceiling) | 0.705 | 0.284 | 0.807 | 16.3 % | **1.18** |
| *Reverse Cuthill-McKee* | 0.834 | 0.139 | **0.120** | 32.7 % | 2.25 |
| *Spectral (Fiedler)* | **0.877** | **0.108** | 0.219 | **32.9 %** | 1.61 |

Four things stand out, each of which is a finding the original evaluation could
not have produced because it had no external baselines:

1. **A trivial coordinate sort beats every RNA variant on spatial
   autocorrelation** (0.828 vs MUCS's 0.783). Sorting west-to-east then
   south-to-north is four lines of code.
2. **Classical graph orderings beat them all.** Spectral ordering leads on
   Moran's *I*, Geary's *C* and greedy routing; RCM leads on bandwidth by a
   factor of two over the best RNA variant.
3. **None of the numberings support navigation.** Greedy routing succeeds
   3.8–33 % of the time; on the largest networks the best RNA variant manages
   1.5 %. If an addressing scheme cannot be followed to a destination, that is
   worth knowing.
4. **Bucketing genuinely recovers real streets.** On Hyderabad Network-2,
   bucketed variants reach **ARI 0.44** against real OSM street names, while
   unbucketed ones score 0.0 by construction. This is the strongest external
   validation currently available and argues that Step 2 of the RNA is doing
   real work — over the 141 of 1351 segments that carry a name.

Point 4 is the constructive one: it identifies which part of the pipeline has
demonstrable external validity. Points 1–3 set the bar the next paper has to
clear, and are exactly what a reviewer would have asked for.

## Appendix A — Reproducing the §2.1 and §3.3 numbers

The running-example figures (Metric 1, Moran's *I*, Geary's *C*, parity
stratification) and the real-data confound table were computed directly from
`data/` and `results/` using the loaders in `rna/`. Both scripts are short
and should be committed alongside the analysis for the resubmission:

- the 12-edge lattice of §3, verifying $M_1(A)=1.56$, $M_1(A')=3.12$,
  $M_1(B)=2.83$, and $I(A)=I(A')=0.177$;
- the 17-variant sweep of §2.1, producing
  Spearman(*M*₁, range) = +0.973 (Brooklyn) and +0.948 (Hyderabad).

Buffer $r = 250$ m throughout, matching the paper. Segment position is taken
as the geometric midpoint of the polyline; the paper is not explicit about
whether it uses midpoint or nearest-point distance, which is itself worth
pinning down in the resubmission — **the ambiguity means the original Table IV
is not exactly reproducible from the text**, and reviewers may check.
