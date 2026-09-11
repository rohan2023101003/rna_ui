# How We Evaluate Road Numbering — A Plain Guide

This explains, from zero, what our evaluation measures, how to run it, and how
to read the numbers it produces. No prior knowledge assumed. Every unfamiliar
word is explained the first time it appears.

**Short answer to "is it implemented?"** — Yes. 24 measurements and 6
comparison baselines are built into the **Evaluate** tab of the website and
work on all six networks. 86 automated tests check they are correct. Details in
[§9](#9-what-is-built-and-what-is-not) and [§10](#10-how-to-check-it-yourself).

---

## Contents

1. [What we are doing, in 30 seconds](#1-what-we-are-doing-in-30-seconds)
2. [Words you need](#2-words-you-need)
3. [A complete example, worked by hand](#3-a-complete-example-worked-by-hand)
4. [The measurements we use](#4-the-measurements-we-use)
5. [The comparison baselines](#5-the-comparison-baselines)
6. [Using the Evaluate tab](#6-using-the-evaluate-tab)
7. [Reading the results table](#7-reading-the-results-table)
8. [A real result, explained line by line](#8-a-real-result-explained-line-by-line)
9. [What is built and what is not](#9-what-is-built-and-what-is-not)
10. [How to check it yourself](#10-how-to-check-it-yourself)

---

## 1. What we are doing, in 30 seconds

Our algorithm gives every road a number. We want to know: **is it a good set of
numbers?**

"Good" is not one thing, so we measure five separate qualities:

| # | The question | Why it matters |
|---|---|---|
| 1 | Do roads that are **near each other** have **similar numbers**? | If road 50 is next to road 51, the map feels sensible. If it's next to road 7, it feels random. |
| 2 | When you **cross an intersection**, how big is the **jump** in number? | Small jumps mean the numbering flows smoothly through the city. |
| 3 | Could a person **guess a missing number** from its neighbours? | This is the definition of "intuitive". |
| 4 | Does one number identify **one real street**? | An address is useless if number 12 names three unconnected pieces of the city. |
| 5 | Can you actually **navigate** using the numbers? | The practical test: can you find road 47 by following numbers? |

Each question gets one or more measurements. That is all evaluation is.

---

## 2. Words you need

Read this once; everything later uses these terms.

**Road segment** — one piece of road between two junctions. A long street is
usually several segments. Our data has 83 to 1,351 segments per network.

**Numbering** — the assignment of a number to every segment. One algorithm run
produces one numbering. We compare many numberings against each other.

**Neighbours** — the segments close to a given segment. We use a **buffer**: a
circle of a chosen radius (default **250 metres**) drawn around a road. Every
segment within it is a neighbour. In Brooklyn each road has about 33 neighbours
on average.

**Correlation** — a single number from −1 to +1 saying how strongly two things
move together:

| Value | Meaning |
|---|---|
| **+1** | perfectly linked, in the same direction |
| **0** | no relationship at all |
| **−1** | perfectly linked, in opposite directions |

**Baseline** — a numbering we did *not* invent, used as a yardstick. A **floor**
baseline is deliberately terrible (random numbers); a **ceiling** baseline is
known to be very good. Without them, a score of "0.78" means nothing. With them,
you can say "0.78, where random scores 0.00 and the best known method scores
0.83."

**Permutation test** — a way of asking "could this have happened by luck?" We
take the *exact same numbers* the algorithm produced and shuffle them randomly
onto different roads, 199 times. Then we compare the real score against those
199 fakes. If the real score beats all of them, the pattern is real. This is
important because the shuffled versions use the *same* numbers, so nothing about
the size or spread of the numbers can bias the comparison.

**p-value** — the result of that test. It is the probability that luck alone
could produce what we saw. **Smaller is better.** Below 0.05 is conventionally
called "significant". With 199 shuffles the smallest possible value is 0.005.

**z-score** — how far the real score sits above the average shuffle, measured in
standard deviations (a standard unit of spread). **Bigger is better.** Above 2
is significant; our real algorithms score 5 to 200, so the patterns are
overwhelmingly real. The z-score is more useful than the p-value here, because
p-values all bottom out at 0.005 while z-scores still separate the algorithms.

**Normalised** — divided by something so that different things become
comparable. Example: comparing raw scores between a scheme that uses numbers
1–17 and one that uses 1–201 is unfair, because the second will naturally have
bigger gaps. Dividing by the size of the number range fixes it. Several of our
measurements are normalised for exactly this reason, and they say so.

---

## 3. A complete example, worked by hand

Four roads side by side, 100 metres apart. Call them A, B, C, D.

```
   A       B       C       D
   |       |       |       |
   |       |       |       |
   0m    100m    200m    300m
```

With a 150-metre buffer, each road's neighbours are the ones directly beside it:

- A's neighbours: B
- B's neighbours: A, C
- C's neighbours: B, D
- D's neighbours: C

Now consider two ways of numbering them.

- **Tidy:** A=1, B=2, C=3, D=4
- **Jumbled:** A=1, B=4, C=2, D=3

Obviously the tidy one is better. Let's see whether our measurements agree.

### Measurement 1: average jump to a neighbour

For each road, average the difference between its number and each neighbour's.

**Tidy:**

| Road | Its number | Neighbours' numbers | Differences | Average |
|---|---|---|---|---|
| A | 1 | 2 | 1 | 1.0 |
| B | 2 | 1, 3 | 1, 1 | 1.0 |
| C | 3 | 2, 4 | 1, 1 | 1.0 |
| D | 4 | 3 | 1 | 1.0 |

Overall average = **1.0**

**Jumbled:**

| Road | Its number | Neighbours' numbers | Differences | Average |
|---|---|---|---|---|
| A | 1 | 4 | 3 | 3.0 |
| B | 4 | 1, 2 | 3, 2 | 2.5 |
| C | 2 | 4, 3 | 2, 1 | 1.5 |
| D | 3 | 2 | 1 | 1.0 |

Overall average = (3.0 + 2.5 + 1.5 + 1.0) ÷ 4 = **2.0**

Tidy scores 1.0, jumbled scores 2.0. Lower is better, so tidy wins. Correct.

### But this measurement has a serious flaw

Take the tidy numbering and simply **double every number**: A=2, B=4, C=6, D=8.
Nothing about the map has changed. The roads are in the same places and in the
same order. Only the labels are bigger.

| Road | Its number | Neighbours' numbers | Differences | Average |
|---|---|---|---|---|
| A | 2 | 4 | 2 | 2.0 |
| B | 4 | 2, 6 | 2, 2 | 2.0 |
| C | 6 | 4, 8 | 2, 2 | 2.0 |
| D | 8 | 6 | 2 | 2.0 |

Overall average = **2.0** — exactly the same score as the *jumbled* numbering.

**This is why we do not rely on average jump alone.** It measures how big the
numbers are, not how well they are arranged. Any measurement built on raw
differences has this problem, and it is the reason several of our measurements
are normalised.

### Measurement 2: Moran's I — the fix

Moran's I asks the same question but divides by how spread out the numbers are,
so the size of the numbers cancels out. It runs from about −1 to +1:

| Value | Meaning |
|---|---|
| **near +1** | neighbours have very similar numbers — **good** |
| **near 0** | no pattern — same as random |
| **negative** | neighbours have deliberately *different* numbers — **bad** |

Applied to our three numberings:

| Numbering | Average jump | Moran's I |
|---|---:|---:|
| Tidy (1,2,3,4) | 1.00 | **+0.333** |
| Tidy doubled (2,4,6,8) | 2.00 | **+0.333** |
| Jumbled (1,4,2,3) | 2.00 | **−0.867** |

Moran's I gives the tidy numbering and its doubled version **the same score**,
which is right — they are the same arrangement. And it correctly rates the
jumbled one as worse than random (negative).

This is the whole idea. Every measurement in the next section is a variation on
"ask a clear question, and make sure the answer cannot be faked by choosing
bigger or smaller numbers."

> You can reproduce these exact numbers by running
> `python3 analysis/verify_metrics.py`.

---

## 4. The measurements we use

24 columns, grouped by the question they answer. For each: what it asks, how to
read it, and what counts as a good value.

### Group 1 — Do nearby roads have similar numbers?

| Column | What it asks | How to read it |
|---|---|---|
| **Moran's I** | Do neighbouring roads have similar numbers? | −1 to +1. **Higher is better.** 0 = random. Above 0.7 is strong. |
| **Moran's I (z)** | How much better than shuffling the same numbers at random? | **Higher is better.** Above 2 is significant. Our algorithms score 5–200. |
| **Moran's I (p)** | Could this have happened by luck? | **Lower is better.** Below 0.05 is significant. Bottoms out at 0.005. |
| **Geary's C** | Same question, but more sensitive to sharp local differences. | **Lower is better.** Below 1 = good pattern, 1 = random, above 1 = worse than random. |
| **Moran's I (N–S only)** | Same, counting only north–south roads. | **Higher is better.** |
| **Moran's I (E–W only)** | Same, counting only east–west roads. | **Higher is better.** |
| **Mantel r** | Do roads that are far apart also have far-apart numbers? | −1 to +1. **Higher is better.** Uses no buffer at all, so it is a useful cross-check. |

*Why two split-by-direction columns?* Our algorithm gives north–south roads odd
numbers and east–west roads even numbers. That means there are really two
separate number sequences woven together, and looking at them together can make
a good numbering look rough. These columns check each sequence on its own.

### Group 2 — How big is the jump when you cross an intersection?

| Column | What it asks | How to read it |
|---|---|---|
| **Bandwidth (norm.)** | In the worst case, how big a jump when two roads meet? | 0 to 1, as a fraction of the whole number range. **Lower is better.** |
| **Bandwidth ÷ RCM** | How does that compare with the standard method used for this since 1969? | **Lower is better.** 1.0 = matching it. Below 1.0 = beating it. |
| **Profile (norm.)** | The same idea, averaged over all roads instead of just the worst case. | **Lower is better.** |
| **Distinct numbers** | How many different numbers the scheme uses at all. | Not good or bad. Shown so you can see why normalising matters. |

*Why "norm."?* Because of the doubling problem from §3. A scheme using only 18
different numbers cannot possibly have a jump bigger than 17, so it would look
artificially good. Dividing by the number range removes that advantage.

### Group 3 — Could someone guess a missing number?

| Column | What it asks | How to read it |
|---|---|---|
| **Hilbert stretch** | How does the numbering compare with the best known mathematical method for laying out a 2-D map in 1-D order? | **Lower is better.** 1.0 = as good as that method. Above 1.0 = worse. |
| **Inference error** | If we hide a road's number and predict it from its 6 nearest neighbours, how wrong are we? | 0 to 1. **Lower is better.** 0.05 means typically 5% of the number range off. |

**Inference error is the most important column for the human study.** It is the
computer doing exactly what we will ask people to do: look at the neighbours,
guess the hidden number. If the computer finds it easy, people probably will
too — and we can test whether that is true.

### Group 4 — Does one number identify one real street?

| Column | What it asks | How to read it |
|---|---|---|
| **Bucket contiguity** | When several segments share a number, do they form one connected street? | 0% to 100%. **Higher is better.** 100% = every shared number is a real, joined-up street. |
| **Segments per number** | On average, how many pieces of road share one number? | Not good or bad by itself. 1.0 = every segment is unique. Higher = more grouping. |
| **Worst dispersion** | The furthest apart two roads sharing the same number are. | **Lower is better.** Large values mean one "address" spans distant parts of the city. |
| **ARI vs real streets** | Does the algorithm's grouping match the real street names in the map data? | −1 to +1. **Higher is better.** 0 = no better than chance. This is the only column checked against real-world truth. |

*"Bucketing"* is the algorithm step that groups several segments into one road so
they share a number. These four columns measure whether that grouping is
sensible.

### Group 5 — Can you actually use the numbers?

| Column | What it asks | How to read it |
|---|---|---|
| **Greedy routing success** | Starting anywhere, if you always walk to whichever neighbouring road has a number closest to your destination's, do you arrive? | 0% to 100%. **Higher is better.** |
| **Routing stretch** | When it works, how much longer is that route than the shortest one? | **Lower is better.** 1.0 = perfect, no detour. |
| **Ambiguous arrivals** | How often do you arrive at a road carrying the right number but which is not the one you wanted? | **Lower is better.** This is the cost of reusing numbers. |
| **Delivery tour ratio** | If a delivery driver visits addresses in numeric order, how much longer is the round than the best possible route? | **Lower is better.** 1.0 = perfect. A well-known method achieves about 1.25. |

### Group 6 — The original paper's numbers, for comparison

| Column | What it asks | How to read it |
|---|---|---|
| **Paper Metric 1** | The average jump from §3. | **Lower is better** — but see the warning below. |
| **Number range** | Highest number minus lowest. | Shown next to Metric 1 on purpose. |
| **Paper Metric 3** | Combines distance-in-hops with the number gap. | **Lower is better.** Same warning. |

> ⚠️ These two are shown **only so you can compare them with the corrected
> measurements**. They suffer from the doubling problem in §3. Put Metric 1 and
> Number range side by side in the table and you will see they rise and fall
> together — Metric 1 is largely measuring how many numbers were used, not how
> well they were arranged. Do not use them on their own.

---

## 5. The comparison baselines

A score means nothing without something to compare it against. We include six
reference numberings that our algorithm did not produce.

| Baseline | What it is | Role |
|---|---|---|
| **Random permutation** | Numbers scattered at random. | **Floor.** Anything that cannot beat this is worthless. |
| **Coordinate sort** | Sort roads west to east, then south to north. Four lines of code. | **Naive.** A cheap idea our algorithm should beat. |
| **Hilbert curve order** | A mathematical curve that visits every part of a square while keeping nearby places nearby. | **Ceiling.** Widely regarded as the best general method for this. |
| **Hilbert + odd/even rule** | The same, but also applying our odd-for-north-south rule. | **Ceiling**, directly comparable to our algorithm. |
| **Reverse Cuthill-McKee** | The standard method for this kind of problem since 1969. | **Classical.** |
| **Spectral (Fiedler) order** | Ordering based on the mathematical structure of the road network. | **Classical.** |

The random baseline is also a **correctness check**: it should score Moran's I
of about 0 and Geary's C of about 1. It does, on every network. If it ever
didn't, something would be broken.

You can click **view** next to any baseline to draw it on the map, which is
useful for making figures.

---

## 6. Using the Evaluate tab

1. Start the site: `python3 server.py`, then open `http://127.0.0.1:8000`
2. Pick a city and network from **Dataset** at the top left
3. Click the **3 Evaluate** tab
4. Optionally adjust the settings:
   - **Buffer radius** — how close counts as "neighbour". Default 250 m.
   - **Permutations** — how many random shuffles for the luck-test. Default 199.
     More is slightly more precise but slower. 0 turns the test off.
   - **Neighbour distance** — measure between whole road shapes (default,
     matches the paper) or just between their midpoints (faster).
5. Tick which numberings to compare. **Key subset** gives a sensible default of
   14 rows; **Select all** does all 23.
6. Click **Run evaluation**. A progress bar fills as each row is scored.
7. Click **Export CSV** to get the numbers for a paper or spreadsheet.

**How long it takes:** about 0.5 seconds per row on the small networks and 3
seconds per row on the largest (Hyderabad Network-2, 1,351 roads). A full
14-row run takes 7 seconds on Brooklyn, 45 seconds on Hyderabad Network-2.
Results are cached, so re-running the same settings is instant.

---

## 7. Reading the results table

- **Each row** is one numbering — either an algorithm output or a baseline.
- **Each column** is one measurement.
- **Green bold cells** are the best value in that column.
- **Grey dashes** mean the measurement does not apply here.
- **Arrows** in the column header: ↑ higher is better, ↓ lower is better.
- **Hover a column heading** to see its full definition and where it comes from.
- **Click a column heading** to sort by it. Click again to reverse.
- **Grey rows** are baselines, tagged `floor`, `naive`, `ceiling` or `classical`.
- The **chips at the top right** hide or show whole groups of columns.

At the top sits the **Metric 1 confound check**. It shows two correlations:
Metric 1 against the number range, and Metric 1 against Moran's I. If the first
is large, Metric 1 is mostly measuring how many numbers were used rather than
how good the numbering is. On our data it reads about +0.92 to +0.98.

---

## 8. A real result, explained line by line

Brooklyn Network-1, default settings. Actual output:

| Numbering | Moran's I ↑ | Geary's C ↓ | Bandwidth ↓ | Greedy success ↑ | Tour ratio ↓ | Metric 1 ↓ | Number range |
|---|---:|---:|---:|---:|---:|---:|---:|
| MUCS | 0.783 | 0.194 | 0.286 | 10.1 % | 2.40 | 28.4 | 201 |
| MUCS + Bucketing | 0.590 | 0.411 | 0.730 | 15.8 % | 2.39 | 7.6 | 42 |
| MUCS + Min-cut + Bucketing | 0.119 | 0.858 | 0.941 | 31.4 % | 2.71 | **4.0** | 17 |
| MIDDFS (k=5) | 0.759 | 0.232 | 0.266 | 9.5 % | 2.24 | 29.6 | 201 |
| MDFS | 0.107 | 0.876 | 1.000 | 6.3 % | 2.26 | 52.1 | 201 |
| BFS | 0.225 | 0.769 | 0.823 | 10.6 % | 2.48 | 64.4 | 226 |
| *Random* (floor) | −0.032 | 1.031 | 0.984 | 3.8 % | 2.98 | 66.1 | 192 |
| *Coordinate sort* (naive) | 0.828 | 0.127 | 0.214 | 20.1 % | 2.28 | 23.6 | 192 |
| *Hilbert* (ceiling) | 0.705 | 0.284 | 0.807 | 16.3 % | **1.18** | 23.6 | 192 |
| *Reverse Cuthill-McKee* | 0.834 | 0.139 | **0.120** | 32.7 % | 2.25 | 23.6 | 192 |
| *Spectral* (classical) | **0.877** | **0.108** | 0.219 | **32.9 %** | 1.61 | 19.2 | 192 |

**What this says, in plain English:**

1. **The random floor behaves exactly as it should.** Moran's I of −0.032 (≈ 0)
   and Geary's C of 1.031 (≈ 1). These are the textbook "no pattern" values, so
   the measurements are working.

2. **MUCS produces a genuinely good spatial pattern.** Moran's I of 0.783 is
   strong — far above random.

3. **But a four-line coordinate sort beats it** (0.828 vs 0.783), and so do the
   two classical methods (0.834 and 0.877). This is worth knowing and we could
   not have known it without baselines.

4. **Almost nothing supports navigation.** Greedy routing succeeds only 10% of
   the time for MUCS. Even the best row manages 33%. If you cannot follow the
   numbers to a destination, that is a real limitation.

5. **The Hilbert curve dominates the delivery test** (1.18 versus about 2.2–2.4
   for everything else), and 1.18 is very close to the ≈1.25 that this method is
   documented to achieve — an independent sign our implementation is right.

6. **Look at the last two columns together.** "MUCS + Min-cut + Bucketing" has
   the best Metric 1 in the table (4.0) — and the smallest number range (17). Its
   Moran's I is 0.119, nearly the worst. Metric 1 is rewarding it for using few
   numbers, not for being well arranged. This is the doubling problem from §3,
   appearing in real data.

7. **Bucketing does do something valuable**, just not what Metric 1 suggests.
   On Hyderabad Network-2 the bucketed variants score **ARI 0.44** against the
   real street names in the map data, while unbucketed ones score 0.00. That
   means the grouping step really does recover actual streets.

---

## 9. What is built and what is not

### Built and working

| Question | Measurements | Status |
|---|---|---|
| Nearby roads, similar numbers? | Moran's I, z, p, Geary's C, N–S / E–W split, Mantel r | ✅ |
| Jump size at intersections | Bandwidth, profile, ratio vs RCM, distinct numbers | ✅ |
| Guessable numbers | Hilbert stretch, inference error | ✅ |
| One number, one street | Contiguity, segments per number, dispersion, ARI | ✅ |
| Usable for navigation | Greedy routing success, stretch, ambiguous arrivals, tour ratio | ✅ |
| Comparison yardsticks | 6 baselines | ✅ |
| Original paper's numbers | Metric 1, Metric 3, number range | ✅ |

All working on all six networks.

### Not built, and why

| Missing | Why |
|---|---|
| **Stability checks** — does the numbering change much if you start elsewhere, or if a new road is built? | Needs to re-run the numbering algorithm. The website only reads its CSV output; it does not contain the algorithm. |
| **Human studies** — asking real people | Needs participants. The task preview and the interaction log are already in the site, ready for it. |
| **Comparing measurements against human judgement** | Needs the human studies first. |

### One limitation to be aware of

**ARI vs real streets only works properly on Hyderabad.** It needs real street
names in the map data to compare against, and:

- Brooklyn has the same name (`East 40th Street`) copied onto all 193 segments
- Melbourne has no name column at all
- Hyderabad names only 141 of 1,351 segments

So the ARI figure is real but rests on a small sample. To use it properly the
networks need re-downloading from OpenStreetMap with names kept. The table tells
you this in its footnote whenever it applies.

---

## 10. How to check it yourself

```bash
python3 analysis/test_metrics.py      # 86 correctness tests
python3 analysis/verify_metrics.py    # reproduces the §3 example
```

The test suite checks each measurement against something known independently:

- hand-computed answers on the small example in §3
- textbook values (random numbering must give Moran's I ≈ 0, Geary's C ≈ 1)
- **invariance**: doubling every number, or adding 1000 to every number, must
  not change the corrected measurements — the §3 problem, tested directly
- known answers on simple shapes (a straight chain of roads numbered in order
  must have the smallest possible jump)
- identical groupings must give ARI exactly 1.0
- broken input (all roads numbered the same) must report "not available"
  instead of crashing

All 86 pass. Beyond the tests, three things independently confirm the
implementation:

1. Random scores Moran's I ≈ 0 and Geary's C ≈ 1.00 on every network — exactly
   the values theory predicts.
2. The Hilbert baseline's delivery tour ratio comes out at 1.15–1.31 across all
   six networks, against the ≈1.25 published for that method.
3. Reverse Cuthill-McKee has the lowest bandwidth on every network, which is
   precisely what it was designed to minimise.

---

## Where things live

| File | What it is |
|---|---|
| `rna/metrics.py` | Every measurement |
| `rna/baselines.py` | The six comparison numberings |
| `rna/geometry.py`, `rna/graph.py` | Distance and network-structure helpers |
| `rna/evaluate.py` | Runs everything, holds the column descriptions |
| `web/js/evaluate.js` | The Evaluate tab |
| `analysis/test_metrics.py` | The 86 tests |
| `EVALUATION.md` | The longer research plan, including the human studies we have not run yet |
