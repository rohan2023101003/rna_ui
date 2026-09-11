# Human Evaluation Methods for the Road Numbering Paper

This document decides **which human-evaluation methods go into the paper and which do not**, working through every method on the list. For each method we keep, it explains in plain language what it is, why it suits road numbering, exactly how we measure it, the formula with every symbol explained, a worked example with numbers, and what could go wrong.

No prior knowledge is assumed. Every technical word is defined the first time it is used.

> **All of this is now built and running.** The study lives in `evaluate/` and
> runs in a participant's browser with nothing to install. See
> [evaluate/README.md](evaluate/README.md) to host it and collect the results.

---

## Contents

- [Part 0 — The one rule that decides everything](#part-0--the-one-rule-that-decides-everything)
- [Part 1 — Words you need](#part-1--words-you-need)
- [Part 2 — The verdict at a glance](#part-2--the-verdict-at-a-glance)
- [Part 3 — The three tasks that produce every number](#part-3--the-three-tasks-that-produce-every-number)
- [Part 4 — The methods we keep (in full detail)](#part-4--the-methods-we-keep-in-full-detail)
  - [4.1 Task Completion Rate](#41-task-completion-rate)
  - [4.2 Error Rate](#42-error-rate)
  - [4.3 Task Time and Time to Destination](#43-task-time-and-time-to-destination)
  - [4.4 Learnability](#44-learnability)
  - [4.5 Route Deviation](#45-route-deviation)
  - [4.6 Wayfinding Errors](#46-wayfinding-errors)
  - [4.7 Panning and Zooming Frequency](#47-panning-and-zooming-frequency)
  - [4.8 Interaction Effort](#48-interaction-effort)
  - [4.9 NASA-TLX](#49-nasa-tlx-cognitive-load)
  - [4.10 Contextual Appropriateness](#410-contextual-appropriateness)
- [Part 5 — The one gap, and the smallest thing that fills it](#part-5--the-one-gap-and-the-smallest-thing-that-fills-it)
- [Part 6 — The methods we reject, and why](#part-6--the-methods-we-reject-and-why)
- [Part 7 — What the interface already records for free](#part-7--what-the-interface-already-records-for-free)
- [Part 8 — The whole study on one page](#part-8--the-whole-study-on-one-page)

---

## Part 0 — The one rule that decides everything

Before judging any method, one fact settles most of the decisions.

> **In our experiment, the thing that changes between conditions is the NUMBERING, not the WEBSITE.**

Every participant uses the same map interface, with the same buttons, the same zoom, the same layout. The only difference is *which algorithm produced the road numbers they are looking at*.

This gives us a simple test to apply to every method on the list:

**Ask: "If I gave the same person the same website twice, but with different road numbers, would this method produce a different score?"**

- **Yes** → the method can tell our algorithms apart. **Keep it.**
- **No** → the method measures our website, which never changes. It would give nearly the same score every time, no matter which algorithm we used. **Reject it.**

This is why methods like the System Usability Scale get rejected. They are excellent methods — they are simply built to answer a different question ("is this software well made?") than ours ("is this numbering sensible?").

A second, practical test settles the rest:

> **Does the method force us into a lab with special hardware?**

If yes, we can only test 20–30 people instead of 60–80. Fewer people means we cannot reliably detect the differences we care about, which are small. Richness of data is not worth losing the ability to prove anything.

---

## Part 1 — Words you need

Read this once. Everything afterwards uses these terms.

**Participant** — a person taking part in the experiment.

**Task** — one thing we ask a participant to do, e.g. "find road 47".

**Trial** — one repetition of a task. A participant does many trials.

**Condition** — one version of the thing being tested. Here, one condition = one numbering algorithm. If we compare 5 algorithms, we have 5 conditions.

**Within-subjects design** — every participant sees *every* condition. The opposite is *between-subjects*, where each participant sees only one. Within-subjects is far more sensitive because each person acts as their own comparison, so it needs fewer participants. We use within-subjects.

**Counterbalancing** — changing the order in which conditions are shown to different participants, so that "being shown first" does not unfairly help one algorithm. If everyone saw MUCS first, MUCS would look worse (people are still warming up) or better (people are still fresh). Rotating the order cancels this out.

**Dependent variable (DV)** — the thing we measure (e.g. time taken, errors made).

**Independent variable (IV)** — the thing we deliberately change (here: the numbering algorithm).

**Confound** — something that changes at the same time as our IV and could be the real cause of a difference. Example: if participants already know Brooklyn, they may find roads quickly because they know the city, not because our numbering is good. Familiarity is a confound.

**Normalise** — divide by something so that different things become comparable. Example: an error of "10" is small if numbers run 1–1000 and huge if they run 1–17. Dividing by the number range makes them comparable.

**Median** — the middle value when you sort the data. Used instead of the average for time, because a few very slow people would drag an average upwards and misrepresent the typical person.

**Statistical significance** — evidence that a difference is real rather than luck. Usually reported as a *p-value*: the probability of seeing a difference this big if there were truly no difference. Below 0.05 is the usual threshold.

**Effect size** — how *big* a difference is, as opposed to how confident we are it exists. A difference can be statistically significant but too small to matter. Always report both.

**Mixed-effects model** — the statistical method we use. "Mixed" because it handles two kinds of variation at once: the effect we care about (which algorithm), and the nuisance variation (some people are just faster than others; some roads are just harder than others). It gives a fair comparison without pretending every participant is identical.

**Likert item** — a statement rated on a scale, e.g. "This numbering made sense to me" from 1 (strongly disagree) to 7 (strongly agree).

**Validated instrument** — a questionnaire that researchers have already tested extensively to show it measures what it claims and gives consistent results. Using one is far safer than writing your own questions, because reviewers already trust it.

**Censored data** — a measurement where we know a value is "at least X" but not the exact value. If a participant gives up after 120 seconds, their true search time is not 120 seconds; it is "more than 120". Ignoring this biases results, so it needs special handling.

---

## Part 2 — The verdict at a glance

### Methods we KEEP (10)

| # | Method | Where it came from | Why it survives |
|---|---|---|---|
| 1 | Task Completion Rate | Both columns (appeared twice) | Can the numbering be used at all? |
| 2 | Error Rate | Performance & Effectiveness | Our single most important measure |
| 3 | Task Time / Time to Destination | Performance + Spatial Task Performance | How long does the numbering make things take? |
| 4 | Learnability | Performance & Effectiveness | An address system is learned once, used for years |
| 5 | Route Deviation | Spatial Task Performance | Do the numbers lead you the right way? |
| 6 | Wayfinding Errors | Spatial Cognitive Usability | How often do the numbers mislead you? |
| 7 | Panning & Zooming Frequency | Interaction & Navigation Efficiency | How much hunting does it take? Free to collect |
| 8 | Interaction Effort | Interaction & Navigation Efficiency | Total work required. Free to collect |
| 9 | NASA-TLX (= Task Load Index) | Physiological & Cognitive Load | How mentally hard does it feel? The one subjective measure that works |
| 10 | Contextual Appropriateness | Collaborative & Contextual | Does it suit *this* city and *these* people? |

### Methods we REJECT (8)

| Method | Short reason |
|---|---|
| System Usability Scale (SUS) | Measures the website, which is identical in every condition |
| User Experience Questionnaire (UEQ) | Same problem, plus 26 items × 5 conditions exhausts participants |
| Net Promoter Score (NPS) | A commercial "would you recommend us?" metric. Meaningless for road numbers |
| Eye Tracking & Pupillometry | Needs lab hardware; caps our sample at ~25 when we need ~70 |
| Gaze Fixation Duration | Same hardware problem |
| Cognitive Walkthrough Score | Experts inspecting an interface, not participants judging a numbering |
| Gulf of Execution / Evaluation Time | Excellent *idea*, but no standard way to score it. We keep the idea, drop the metric |
| Geo-Collaborative Task | The best conceptual fit, but needs a writer *and* a reader per item. Dropped to keep the session at 30 minutes; the strongest candidate for a follow-up study |

### Two items on the list are duplicates

- **Task Completion Rate** appears in both columns. It is one method; we merge them.
- **NASA-TLX** and **Task Load Index (TLX)** are the same instrument. NASA-TLX *stands for* NASA Task Load Index. We merge them.

So the list of 21 items is really **19 distinct methods**: 10 kept, 8 rejected (Geo-Collaborative is dropped for now to keep the session to 30 minutes - it needs two participants per item), and one (Gulf of Evaluation) kept as background thinking rather than as a number.

---

## Part 3 — The three tasks that produce every number

The ten kept methods are not ten separate experiments. They come out of **three tasks plus two questionnaires**. This matters: it means the whole study is about 30 minutes per participant, not five hours.

| Task | What the participant does | Metrics it produces |
|---|---|---|
| **T1 — Fill in the blank** | Some road numbers are hidden. Click a hidden road and type the number you expect. | Error Rate, Completion Rate, Task Time, **Learnability**, Interaction Effort, Pan/Zoom |
| **T2 — Find the road** | "Find road 47." Search the map and click it. | **Time to Destination**, Completion Rate, Pan/Zoom, Interaction Effort |
| **T3 — Get there** | "You are on road 12. Reach road 47 by clicking the roads you would travel along." | **Route Deviation**, **Wayfinding Errors**, Completion Rate, Task Time |
| **Q1 — After each block** | Six sliders about how demanding that block felt. | **NASA-TLX** |
| **Q2 — At the very end** | Side-by-side map comparisons and two context questions. | Preference, **Contextual Appropriateness** |

All three tasks are built and running - see `evaluate/`.

---

## Part 4 — The methods we keep (in full detail)

### 4.1 Task Completion Rate

#### What it is, in plain words
The share of tasks that people actually finish successfully. If 40 people try to find road 47 and 34 succeed, the completion rate is 34 out of 40, which is 85%.

#### Why it fits road numbering
It is the most basic question we can ask: **can people use this numbering at all?** Before asking whether one scheme is 10% faster than another, we need to know whether people can complete the task. If a numbering produces a completion rate near chance, nothing else about it matters.

#### Exactly how we measure it
Each task needs a success rule **decided before the study runs** (deciding afterwards lets you pick whichever rule flatters your result, which is dishonest):

| Task | Counts as success when… |
|---|---|
| T1 Fill in the blank | The guess is within a pre-set tolerance of the real number (see §4.2) |
| T2 Find the road | The correct road is clicked within the time limit (120 seconds) |
| T3 Get there | The destination is reached without giving up |

#### The formula

```
                    number of successful trials
Completion Rate =  ----------------------------  × 100 %
                     number of attempted trials
```

Every symbol:
- *successful trials* — trials meeting the success rule above.
- *attempted trials* — trials the participant actually started. Trials skipped due to a technical fault are removed entirely, not counted as failures.

#### Worked example (illustrative numbers)

Suppose 40 participants each do 10 "find the road" trials with the MUCS numbering: 400 trials in total. 348 end with the correct road clicked in time.

```
Completion Rate = 348 / 400 × 100 % = 87.0 %
```

And with a random numbering, 190 of 400 succeed:

```
Completion Rate = 190 / 400 × 100 % = 47.5 %
```

The gap of 39.5 percentage points is the useful result.

#### What a good value looks like
There is no universal threshold, which is exactly why the **random numbering baseline** matters. Interpret the result as "MUCS achieves 87%, where scattering the numbers at random achieves 47%." That framing needs no arbitrary standard.

#### How we analyse it
Each trial is a yes/no outcome, so we use **logistic mixed-effects regression** — a method for yes/no data that also accounts for some participants being generally better and some roads being generally harder. We report the completion rate for each algorithm with a **confidence interval** (a range showing how precisely we know the number, e.g. "87% ± 3%").

#### What could go wrong
- **Ceiling effect** — if every algorithm scores 98%, the task is too easy and cannot distinguish them. Fix: pilot the task first and make it harder (larger map, tighter time limit) if scores bunch at the top.
- **Time limits change the answer.** A 30-second limit and a 300-second limit give different completion rates. Fix: fix the limit in advance and report it.

---

### 4.2 Error Rate

**This is the single most important method in the study.** It is the direct test of the paper's central claim: that our numbers make sense to people.

#### What it is, in plain words
How often, and how badly, people get things wrong.

#### Why it fits road numbering
Because we can measure *several distinct kinds of wrongness*, and each tells us something different about the numbering. This is a strength: it turns one metric into a diagnostic panel.

#### The four error types we measure

**(a) Normalised number error** — how far the guess was from the truth, in the "fill in the blank" task.

```
                       | guess − actual |
Normalised error =  ---------------------------
                    highest number − lowest number
```

- *guess* — the number the participant typed.
- *actual* — the number our algorithm assigned.
- *highest / lowest number* — the largest and smallest numbers that algorithm used anywhere on the map.

> ⚠️ **You must divide by the number range. This is not optional.**
>
> Suppose one algorithm uses numbers 1 to 17 and another uses 1 to 201. A participant guessing at random will be off by about 6 on the first and about 67 on the second. The first algorithm would look six times better *purely because it uses smaller numbers*, even if its arrangement is worse.
>
> Dividing by the range removes this entirely. A raw error comparison would produce a result that looks impressive and means nothing.

**(b) Parity agreement** — did the participant get odd/even right?

Our algorithm gives north–south roads **odd** numbers and east–west roads **even** numbers. So we can ask: did the participant's guess have the right odd/even property?

```
Parity agreement = 1  if guess and actual are both odd, or both even
                 = 0  otherwise
```

Then across many trials:

```
                          number of trials scoring 1
Parity agreement rate =  ----------------------------  × 100 %
                              number of trials
```

> **Why this is our best single measure.** It is a simple yes/no, so the number range cannot distort it at all. It is immune to the problem described above. And it directly tests a specific design decision in our algorithm — the odd/even rule. If participants cannot recover parity better than 50% (pure guessing), then that rule carries no meaning for humans, which is a genuine finding worth publishing either way.

**(c) Wrong-road rate** — in "find the road", the share of trials where the participant clicked a road that was not the target.

**(d) Direction error rate** — in "which way?", the share of wrong north/south answers.

#### Worked example (illustrative numbers)

A participant is shown a map numbered by MUCS, which uses numbers 1 to 201. A road's number is hidden; the real answer is **58**. They type **51**.

```
Normalised error = |51 − 58| / (201 − 1)
                 = 7 / 200
                 = 0.035
```

So they were off by 3.5% of the whole address range — quite good.

Parity: 51 is odd, 58 is even. They do not match, so parity agreement = **0** for this trial.

Now the same participant on a map numbered by MUCS+Bucketing, which uses numbers 1 to 42. The real answer is **12**; they type **9**.

```
Normalised error = |9 − 12| / (42 − 1) = 3 / 41 = 0.073
```

Note the raw error is *smaller* here (3 versus 7) but the normalised error is *twice as large* (0.073 versus 0.035). The normalised figure is the honest comparison.

#### What a good value looks like
Compare against the random-numbering baseline as always. A rough guide:
- Normalised error near **0.5** means guessing blindly.
- Normalised error below **0.10** means the participant genuinely inferred the number from context.
- Parity agreement near **50%** means the odd/even rule is invisible to people.
- Parity agreement above **75%** means people picked up the rule.

#### How we analyse it
- Normalised error is a continuous number → **linear mixed-effects model**.
- Parity agreement is yes/no → **logistic mixed-effects model**.
- We report the average for each algorithm with confidence intervals, and the effect size (how big the gap is in standard units).

#### What could go wrong
- **Diagonal roads.** A road running exactly north-east is neither north–south nor east–west, so its odd/even assignment is essentially a coin flip. Scoring these as "errors" is unfair to the algorithm. **Fix: exclude roads within 3° of the 45° diagonal from parity scoring.** Our data pipeline already flags these.
- **Roads with no number.** A few roads were never assigned a number by some algorithm variants. They must be excluded, not scored as maximum error.
- **Speed–accuracy trade-off.** Someone rushing makes more errors. Never report error rate without also reporting time (§4.3).

---

### 4.3 Task Time and Time to Destination

These are the same clock used in two ways, so we treat them as one method with two applications.

#### What it is, in plain words
How many seconds a task takes. **Time to Destination** is the special case where the task is finding a place: how long from being told "find road 47" to clicking it.

#### Why it fits road numbering
Speed is the everyday, practical benefit of a good address system. A delivery driver, a visitor, or an ambulance crew all care about how quickly a number leads them to a place. It is also completely objective — no opinion involved — and our interface already records it precisely.

#### Exactly how we measure it
The clock starts when the prompt appears and stops on the first correct action. Our interaction log timestamps every event, so this needs no extra work.

```
Task time  =  time of correct action  −  time prompt appeared
```

We report the **median** rather than the mean (average).

> **Why median, not average?** Response times are *right-skewed*: most people take a normal amount of time, but a few take enormously longer (they got distracted, or made a coffee). Those few extreme values pull an average upwards and misrepresent the typical experience. The median — the middle value once sorted — is unaffected by a handful of extreme values.

#### Worked example (illustrative numbers)

Nine participants find road 47 in these times (seconds):

```
12, 15, 18, 19, 22, 24, 27, 31, 240
```

- The **average** is (12+15+18+19+22+24+27+31+240) ÷ 9 = **45.3 seconds**
- The **median** is the 5th value once sorted = **22 seconds**

The average of 45.3 describes nobody. Eight of the nine people were faster than half that. The median of 22 is the honest summary.

#### Handling people who never succeed — an important subtlety

If a participant gives up after the 120-second limit, what is their time?

It is **not** 120 seconds. It is "*at least* 120 seconds, we don't know how much more". This is called **censored data**. Two wrong ways to handle it:
- Recording it as 120 makes a bad algorithm look better than it is.
- Deleting those trials also makes it look better, because you have thrown away all the hardest cases.

The correct approach is **survival analysis** — a family of statistical methods designed exactly for "time until an event, where some cases never had the event". (It is called that because it was developed for medical studies of time until recovery, where some patients are still alive when the study ends.) In practice we report:
- the **median time among successful trials**, alongside
- the **completion rate** (§4.1), which tells you how many failed.

Reporting both together is honest. Reporting time alone is not.

#### How we analyse it
Times are skewed, so we take the **logarithm** first (a transformation that pulls in the long tail and makes the data closer to the bell-shaped distribution these tests assume), then use a **linear mixed-effects model**. Alternatively, compare medians with **bootstrapping** — a technique that estimates uncertainty by repeatedly resampling the data.

#### What could go wrong
- **Speed–accuracy trade-off.** A participant can always go faster by being sloppier. Always report time and error together, or combine them into an efficiency score:
  ```
  Efficiency = completion rate ÷ median time
  ```
- **Familiarity.** Someone who knows Brooklyn will be quick regardless of our numbering. Must be measured and controlled (§4.10).

---

### 4.4 Learnability

This is the most under-appreciated method on the list, and possibly the most important one for a *real* addressing system.

#### What it is, in plain words
How much better people get with practice.

#### Why it fits road numbering — better than almost anything else
A city's addressing scheme is **learned once and used for decades**. Nobody judges a street numbering by how it feels in the first thirty seconds. What matters is whether, after seeing a few examples, you *get it* — whether the underlying rule clicks into place.

This means a scheme that starts confusing but is quickly learned may be genuinely **better** than one that is mildly intuitive but never improves. No other method on the list can detect that difference, because they all measure a single moment in time.

To our knowledge, nobody in the automated road-numbering literature has measured this. It is a strong, novel contribution.

#### Exactly how we measure it
In the "fill in the blank" task, each participant does a run of trials (say 20) with the same numbering. We record the error on each trial in order, then check whether error goes down as the trials go on.

The simplest robust version compares the first block of trials with the last:

```
                 (average error in first 5 trials) − (average error in last 5 trials)
Learning gain =  --------------------------------------------------------------------
                              average error in first 5 trials
```

Every symbol:
- *average error* — the mean normalised error from §4.2 across those trials.
- The result is a **proportion**: 0.40 means error dropped by 40% from start to finish.

Reading the result:
- **Positive** → people are learning the scheme. Bigger is better.
- **Near zero** → no learning. The scheme is not teaching anyone its rule.
- **Negative** → people are getting *worse*, usually a sign of fatigue rather than the numbering.

#### The more precise version
Rather than only comparing first and last, we fit a **learning curve** to all trials:

```
error on trial n  =  A  +  B × e^(−n / τ)
```

Every symbol:
- *n* — the trial number (1, 2, 3, …).
- *A* — the error level people eventually settle at, no matter how much practice. Lower is better; this is the scheme's ceiling.
- *B* — how much *extra* error there was at the very start, above that final level. This is the size of the initial confusion.
- *τ* (the Greek letter "tau") — the **learning rate constant**: roughly how many trials it takes for most of the initial confusion to disappear. A small τ means fast learning.
- *e* — the mathematical constant 2.718…, which produces the natural "fast at first, then levelling off" shape that describes almost all human learning.

This gives us three numbers per algorithm — how good it eventually gets (*A*), how confusing it is at first (*B*), and how quickly people catch on (*τ*) — instead of one.

#### Worked example (illustrative numbers)

A participant does 20 trials with MUCS. Their normalised errors:

- First 5 trials: 0.22, 0.19, 0.24, 0.15, 0.20 → average = **0.200**
- Last 5 trials: 0.09, 0.07, 0.11, 0.06, 0.07 → average = **0.080**

```
Learning gain = (0.200 − 0.080) / 0.200 = 0.120 / 0.200 = 0.60
```

Error fell by **60%** over the run — strong learning.

Now the same participant with a random numbering:

- First 5: 0.48, 0.51, 0.44, 0.55, 0.47 → average = **0.490**
- Last 5: 0.46, 0.52, 0.49, 0.45, 0.50 → average = **0.484**

```
Learning gain = (0.490 − 0.484) / 0.490 = 0.012
```

Essentially **1%** — no learning, exactly as expected, because there is no rule to learn. This also acts as a check that our measurement works.

#### How we analyse it
A mixed-effects model with **trial number** as a predictor and, crucially, an **interaction** between trial number and algorithm.

> **What "interaction" means.** It tests whether the *effect of practice* differs between algorithms — not just whether one algorithm is better overall, but whether one improves faster. A significant interaction is exactly the finding "algorithm A is more learnable than algorithm B".

#### What could go wrong
- **Fatigue works against learning.** People get tired over a long block, which pushes errors up while learning pushes them down. Keep blocks to about 20 trials, and counterbalance the order.
- **Learning the map, not the numbering.** If we use the same map region for all 20 trials, participants may memorise the map itself. **Fix: draw each trial's road from a different part of the network, and use different cities across blocks.**
- **Needs enough trials.** Fewer than about 15 trials makes the curve unreliable.

---

### 4.5 Route Deviation

#### What it is, in plain words
How much longer the route someone actually took is, compared with the shortest possible route.

#### Why it fits road numbering
This tests whether the numbers **point in the right direction**. In a good scheme, moving towards higher numbers should move you consistently through space, so following them takes you roughly the right way. In a bad scheme, the numbers give no directional guidance and people wander.

It also pairs beautifully with something we already compute automatically. Our software already measures "greedy routing stretch" — how far a *computer* detours when it follows the numbers. Route Deviation is the same measurement with a *human* doing the following. Comparing the two tells us whether our cheap automatic metric predicts real human behaviour, which is exactly the kind of validation that makes a metric credible.

#### Exactly how we measure it
In task T3, the participant is told "You are on road 12; reach road 47" and clicks the sequence of roads they would travel along. We record that sequence and compare its length with the shortest path through the road network.

#### The formula

```
                    length of the route the participant chose
Route Deviation =  -------------------------------------------
                       length of the shortest possible route
```

Every symbol:
- *length of route chosen* — total distance in metres of the roads they clicked, in order. (We can equally count the number of roads, called "hops".)
- *length of shortest route* — the distance of the best possible route between those two roads, computed by the software.

Reading the result:
- **1.0** — perfect. They took the shortest route.
- **1.3** — they travelled 30% further than necessary.
- **2.0** — they travelled twice as far as necessary.

Lower is better. A value below 1.0 is impossible and would indicate a bug.

#### Worked example (illustrative numbers)

A participant is asked to get from road 12 to road 47. The roads they click add up to **1,820 metres**. The shortest route between them is **1,400 metres**.

```
Route Deviation = 1820 / 1400 = 1.30
```

They took a route 30% longer than needed.

Averaged over 40 participants × 8 trials, suppose:
- MUCS: **1.42**
- Random numbering: **2.31**
- Hilbert curve ordering: **1.19**

Reading: MUCS clearly helps compared with random, but a Hilbert ordering guides people better still.

#### An alternative version: search-path deviation
The same idea can be applied to task T2 (find the road) by measuring how much of the map the participant panned across, compared with the straight-line distance from where they started to where the road is.

```
                        total distance the map view travelled
Search deviation =  --------------------------------------------
                    straight-line distance from start to target
```

This measures wandering while searching, rather than wandering while travelling.

#### How we analyse it
The ratio is skewed (it has a hard floor at 1.0 and a long upper tail), so we take the logarithm and use a linear mixed-effects model. Report the median deviation per algorithm.

#### What could go wrong
- **Failed trials have no deviation.** If someone never reaches the destination, there is no ratio to compute. Report deviation only for successful trials, always alongside the completion rate.
- **Some road pairs have several equally short routes.** That is fine — we compare against the shortest, so any of them scores 1.0.

---

### 4.6 Wayfinding Errors

#### What it is, in plain words
The number of wrong decisions someone makes while trying to get somewhere. A "wrong turn".

#### Why it fits road numbering
Route Deviation (§4.5) tells you *how much* worse the route was. Wayfinding Errors tell you *how often the numbering actively misled them*. These are different: one long detour and five small wrong turns can produce the same deviation but mean very different things about the numbering.

This is a classic, long-established measure in the study of how people find their way, so using it connects our work to an existing research literature rather than inventing something new.

#### Exactly how we measure it
During task T3, at each step we check whether the road the participant moved to brings them **closer to** or **further from** the destination. Moving further away is counted as an error.

#### The formulas

```
Wayfinding errors  =  number of moves that increase the remaining distance to the target
```

```
                    wayfinding errors
Error rate      =  -------------------  × 100 %
                     total moves made
```

```
Backtracks         =  number of times the participant returns to a road already visited
```

Every symbol:
- *remaining distance to the target* — the shortest-path distance from the current road to the destination, which the software computes at each step.
- *total moves* — how many roads the participant stepped through in total.
- *backtracks* — a separate count, because going back is a strong sign of confusion rather than a simple mistake.

#### Worked example (illustrative numbers)

A participant travels from road 12 to road 47, clicking 9 roads in total. At each step, the shortest-path distance remaining is:

| Step | Road clicked | Distance remaining | Closer? |
|---|---|---|---|
| 1 | 15 | 1200 m | ✓ |
| 2 | 21 | 950 m | ✓ |
| 3 | 33 | 1100 m | ✗ **error** |
| 4 | 21 | 950 m | ✓ (**backtrack**) |
| 5 | 28 | 700 m | ✓ |
| 6 | 39 | 800 m | ✗ **error** |
| 7 | 28 | 700 m | ✓ (**backtrack**) |
| 8 | 44 | 300 m | ✓ |
| 9 | 47 | 0 m | ✓ arrived |

```
Wayfinding errors = 2
Error rate        = 2 / 9 × 100 % = 22.2 %
Backtracks        = 2
```

#### What a good value looks like
Again, judged against the baselines. As a rough guide, an error rate under 10% suggests the numbers reliably indicate direction; above 30% suggests they are close to uninformative for navigation.

#### How we analyse it
Errors are counts, so we use a **Poisson mixed-effects model** (a version of the mixed model designed for count data such as "number of mistakes", which cannot be negative and is not bell-shaped). We report mean errors per trial with confidence intervals.

#### What could go wrong
- **Dead ends are not the participant's fault.** Some roads genuinely require moving away from the target first. Fix: mark moves that were *forced* (no closer option existed) and exclude them.
- **Exploration is not always error.** A participant may deliberately move away to get a better view. Backtracks are counted separately for this reason.

---

### 4.7 Panning and Zooming Frequency

#### What it is, in plain words
How many times the participant drags the map around (panning) or zooms in and out.

#### Why it fits road numbering
It is a direct measure of **hunting**. If the numbering is coherent, seeing "road 47" tells you roughly where to look, so you go there. If the numbering is arbitrary, road 47 could be anywhere, so you scan back and forth across the map.

Two further advantages: it is completely objective, and it costs nothing — our interface already records it.

#### Exactly how we measure it
Our interaction logger already counts pan and zoom gestures, and importantly it **groups continuous movements together**: one long drag counts as one pan, not two hundred. That is the right unit, because one decision to "look over there" is one act of searching.

#### The formulas

```
Pan count   =  number of separate drag gestures during the task
Zoom count  =  number of separate zoom gestures during the task
```

```
                     pan count + zoom count
Navigation rate  =  ------------------------
                      task time in seconds
```

We also record:

```
Zoom range  =  highest zoom level reached  −  lowest zoom level reached
```

which shows whether the participant kept zooming out to re-orient themselves — a recognised sign of being lost.

#### Worked example (illustrative numbers)

Finding road 47 with two numberings:

| | MUCS | Random |
|---|---:|---:|
| Pans | 4 | 17 |
| Zooms | 3 | 11 |
| Time | 22 s | 78 s |
| Navigation rate | (4+3)/22 = **0.32 /s** | (17+11)/78 = **0.36 /s** |
| Zoom range | 2 levels | 6 levels |

The raw counts show the random numbering demanded roughly four times as much searching. The *rate* is similar, which is informative in itself: people search at a steady pace, they simply have to do it for far longer.

#### How we analyse it
Counts → **Poisson mixed-effects model**. Report mean pans and zooms per task per algorithm.

#### What could go wrong
- **Screen size affects everything.** Someone on a large monitor sees more map at once and pans less. Fix: record the viewport size and include it in the model as a control, or fix the map size for all participants.
- **Trackpad versus mouse** produces different gesture patterns. Fix: ask which they used and control for it.

---

### 4.8 Interaction Effort

#### What it is, in plain words
The total amount of work — every click, drag, zoom, and search — needed to finish a task.

#### Why it fits road numbering
Panning and zooming (§4.7) shows *what kind* of effort was needed. Interaction Effort is the **single summary number** for *how much* effort in total. It is the natural quantity to put in a summary table, and it is what a reviewer will want as the one-line answer to "was this harder?"

#### The formula

```
Interaction Effort  =  pans + zooms + clicks + hovers + searches
```

Every symbol is simply a count of that type of event during the task. All five are already in our event log.

Optionally we normalise it so different tasks can be compared:

```
                            interaction effort actually used
Normalised effort  =  ----------------------------------------------
                      minimum interactions needed to finish the task
```

where the *minimum* is what a participant who knew exactly where to go would need — typically one zoom and one click. A value of 1.0 means perfectly efficient; 8.0 means eight times more work than necessary.

#### Worked example (illustrative numbers)

Finding road 47 under MUCS: 4 pans + 3 zooms + 2 clicks + 6 hovers + 0 searches = **15 interactions**.
The theoretical minimum is 1 zoom + 1 click = **2**.

```
Normalised effort = 15 / 2 = 7.5
```

Under a random numbering: 17 + 11 + 9 + 24 + 0 = **61 interactions**.

```
Normalised effort = 61 / 2 = 30.5
```

#### How we analyse it
Counts → Poisson mixed-effects model, as with §4.7.

#### What could go wrong
- **Not all interactions cost the same.** A hover is cheaper than a considered click. Fix: report the components separately as well as the total, so a reader can see the composition.
- **It correlates heavily with task time.** Report both, but do not treat them as independent evidence — they are two views of the same underlying effort.

---

### 4.9 NASA-TLX (Cognitive Load)

*This is the item circled on the list, and it deserves to be.*

#### What it is, in plain words
A short, very widely used questionnaire that measures **how mentally demanding a task felt**. Its full name is the **NASA Task Load Index** — which is why "Task Load Index (TLX)" further down the same list is not a second method, but the same one written twice.

It was developed at NASA in the 1980s to measure the workload on pilots, and has since become one of the most used instruments in all of human-factors research. That history matters: because thousands of studies have used it, reviewers already trust it, and there are published values to compare against.

#### Why it fits road numbering — when SUS and UEQ do not
This is the crucial distinction. Go back to the rule in Part 0:

- SUS asks **"how good is this system?"** Our system never changes, so SUS cannot tell our algorithms apart.
- NASA-TLX asks **"how demanding was this task?"** The task genuinely *is* harder with a confusing numbering. So NASA-TLX **can** tell them apart.

It is the one subjective instrument on the whole list that survives Part 0's test. That is why we keep it and reject the other three.

#### The six things it asks
Each is rated on a slider from 0 to 100:

| Subscale | The question it asks | What it means for us |
|---|---|---|
| **Mental Demand** | How much thinking, deciding, calculating was needed? | The key one. A confusing numbering forces more mental work |
| **Physical Demand** | How much physical activity was needed? | Near zero for a mouse task. Kept because removing items breaks comparability with other studies |
| **Temporal Demand** | How rushed or hurried did you feel? | Reflects perceived time pressure |
| **Performance** | How successful were you? *(reverse-scored)* | How well people *think* they did — which often differs from how they actually did |
| **Effort** | How hard did you have to work to reach your level of performance? | Overall exertion, mental and physical |
| **Frustration** | How irritated, stressed or annoyed did you feel? | A bad numbering is genuinely annoying, and this captures it |

> **"Reverse-scored" explained.** For five of the scales, a higher rating means more workload. For *Performance*, a higher rating means you did *better*, which is less workload. So before combining, we flip it: `adjusted Performance = 100 − rating`. Forgetting this step is a common error that quietly corrupts the total.

#### The formula

We use **Raw TLX** (also written RTLX), which simply averages the six:

```
                Mental + Physical + Temporal + (100 − Performance) + Effort + Frustration
Raw TLX   =  ---------------------------------------------------------------------------
                                              6
```

The result is a number from 0 to 100. **Lower is better** — it means less mental burden.

> **Why "Raw" TLX rather than the original.** The original version adds a step where participants make 15 pairwise comparisons to decide which subscales matter most for them, then uses those as weights. It takes several extra minutes per condition, and a large body of research has found it rarely changes conclusions. Raw TLX is standard, accepted practice and much kinder to participants — which matters when they complete it five times.

#### Worked example (illustrative numbers)

After a block of tasks using MUCS, a participant rates:

| Subscale | Rating |
|---|---:|
| Mental Demand | 45 |
| Physical Demand | 10 |
| Temporal Demand | 30 |
| Performance | 75 (they felt they did well) |
| Effort | 40 |
| Frustration | 25 |

First flip Performance: `100 − 75 = 25`.

```
Raw TLX = (45 + 10 + 30 + 25 + 40 + 25) / 6
        = 175 / 6
        = 29.2
```

After a block with a random numbering, the same participant rates 85, 12, 65, 20 (→ 80), 88, 79:

```
Raw TLX = (85 + 12 + 65 + 80 + 88 + 79) / 6
        = 409 / 6
        = 68.2
```

A jump from 29 to 68 on a 0–100 scale is a very large difference in perceived workload.

#### How we administer it
Immediately after each algorithm's block of tasks — six sliders, about 30 seconds. Never at the end of the whole session, because by then participants cannot separate one condition from another.

#### How we analyse it
The overall score is continuous → **linear mixed-effects model**. We also analyse **Mental Demand** and **Frustration** separately, as they are the two most likely to show a difference and the most interpretable.

#### What could go wrong
- **Forgetting to reverse-score Performance.** Silently wrong results. Worth double-checking.
- **Order effects.** The block done last may feel more demanding due to fatigue. Fix: counterbalance the order of algorithms across participants.
- **It measures feeling, not fact.** Someone may perform well while feeling strained, or vice versa. That is not a flaw — it is why we collect both objective and subjective measures.

---

### 4.10 Contextual Appropriateness

#### What it is, in plain words
Whether the design suits the actual situation the user is in — their city, their culture, their existing expectations about how addresses work.

#### Why it fits road numbering — and why it is more than a soft question
This may look like the vaguest item on the list. In fact it addresses a hard limit on what our paper can claim.

Address systems are deeply cultural:
- **Brooklyn** has a rigid numbered grid. People there already expect numbered streets in sequence.
- **Hyderabad** grew organically. Roads curve, meet at odd angles, and are often unnamed.
- **Japan** does not primarily number streets at all — it numbers *blocks*, and buildings are numbered by the order they were built.

If we test only people used to grids and declare our scheme "intuitive to humans", we have overclaimed. The honest claim is narrower and more useful: intuitive **to whom**, and **where**.

#### How we measure it — as a design factor, not just a rating

The strong version is to build it into the experiment's structure rather than asking an opinion question:

**Factor 1 — City.** Every participant does tasks on all three cities (Brooklyn grid, Hyderabad organic, Melbourne mixed).

**Factor 2 — Familiarity.** We recruit two groups: people who know the city, and people who have never been. We ask directly, before the tasks:

> "How familiar are you with this city?" — 1 (never heard of it) to 5 (I live/lived there)

Then we can test whether the algorithm's advantage holds across all combinations.

> **What an "interaction" would tell us here.** If MUCS performs excellently in Brooklyn but no better than random in Hyderabad, that is an **Algorithm × City interaction**. It would mean there is no single best algorithm — the right one depends on the city's shape. That is a genuinely valuable finding, and it can only be discovered by building city into the design.

**Plus a short rating.** Three Likert items after each city block:

1. "This numbering matches how addresses work where I live." (1–7)
2. "I could imagine this numbering being used in a real city." (1–7)
3. "What, if anything, felt wrong about this numbering?" *(free text)*

The free-text answer is often the most useful thing in the whole study, because it tells you *why* something failed in the participants' own words.

#### The formula

For the ratings, simply the average per algorithm per city:

```
                                  sum of all ratings for that algorithm in that city
Appropriateness score  =  --------------------------------------------------------------
                                        number of ratings
```

For the design factor, the analysis is the interaction term in the model:

```
performance  ~  algorithm  +  city  +  familiarity  +  (algorithm × city)  +  ...
```

Read as: "performance is explained by which algorithm, which city, how familiar the person is, **and whether the algorithm's effect changes from city to city**."

#### Worked example (illustrative numbers)

Mean parity agreement (from §4.2) for MUCS:

| | Brooklyn (grid) | Hyderabad (organic) | Melbourne (mixed) |
|---|---:|---:|---:|
| MUCS | 84% | 61% | 77% |
| Random baseline | 50% | 50% | 50% |
| **Advantage over random** | **+34** | **+11** | **+27** |

MUCS is three times as helpful in a grid city as in an organic one. Reporting only the overall average of +24 would hide the most interesting result in the study.

#### What could go wrong
- **Familiarity cuts both ways.** A local may be fast because they know the streets, not because the numbering helped. **Fix: measure familiarity and include it in the model.** Consider making unfamiliar participants the primary sample, with locals as a planned comparison.
- **Recruiting across cultures is harder.** Participant pools skew towards particular countries. State the actual composition of the sample honestly rather than claiming general applicability.

---


---

## Part 5 — The one gap, and the smallest thing that fills it

Rejecting SUS, UEQ and NPS removes **every measure of preference** from the study. That leaves a real hole: a reviewer will reasonably ask "but which one did people actually *like*?"

NASA-TLX partly covers it (how hard something felt) but not fully — a scheme can be effortless and still feel arbitrary.

The smallest, most defensible way to fill this gap is a **pairwise preference test**, which is not on the original list but costs about two minutes.

#### How it works
Show two maps of the same city side by side, numbered by two different algorithms. Ask one question:

> "Which of these two numbering schemes makes more sense to you?"

Force a choice between the two. Repeat for every pair. With 5 algorithms there are 10 pairs — around two minutes in total.

#### Why pairwise, rather than rating each one out of 10
People are unreliable at giving absolute ratings ("this is a 7") — their personal scale drifts over a session, and one person's 7 is another's 5. But people are very reliable at **comparing two things side by side**. Pairwise comparison exploits that.

#### Turning comparisons into a ranking
We use the **Bradley–Terry model**, a standard statistical method (from 1952) that converts many "A beat B" judgements into a single quality score per option, with a confidence interval. It is the same family of method used to rank chess players from individual games.

```
                            e^(strength of A)
probability A is preferred = ---------------------------------
                            e^(strength of A) + e^(strength of B)
```

Every symbol:
- *strength of A / B* — a hidden quality score the method estimates for each algorithm from all the comparisons.
- *e* — the mathematical constant 2.718…, used here to keep all the strengths positive and the probabilities between 0 and 1.

Reading it: if two algorithms have equal strength, the probability is 0.5 — a coin flip. The bigger the gap in strength, the more often one wins.

The output is a ranked list of algorithms with error bars, from data that is far more reliable than asking people to score each one alone.

---

## Part 6 — The methods we reject, and why

Each of these is a good method. None of them is a good method **for this particular question**.

### 6.1 System Usability Scale (SUS) — REJECT

**What it is.** A 10-item questionnaire (1986), rated 1–5, giving a score out of 100. Items include "I think that I would like to use this system frequently" and "I found the system unnecessarily complex".

**Why it fails here.** Every single item says *"the system"*. Our system — the website — is byte-for-byte identical in every condition. A participant would fill in the same questionnaire five times about the same website and give roughly the same score each time. It has no way to detect that the road numbers changed.

**Where it still has a small role.** Run it **once**, at the end, about the website itself. One sentence in the methods section: "The interface scored 82 on the SUS, above the 68 average, indicating the tool itself was not a barrier to the tasks." That is a useful reassurance. It is not a comparison between algorithms, and must not be presented as one.

### 6.2 User Experience Questionnaire (UEQ) — REJECT

**What it is.** 26 pairs of opposite words (e.g. *confusing / clear*), rated on a 7-point scale, producing scores on six dimensions: attractiveness, perspicuity ("understandability"), efficiency, dependability, stimulation and novelty.

**Why it fails here.** Two reasons.
1. Like SUS, it is built to evaluate a **product**, which does not change between our conditions.
2. **Participant fatigue.** 26 items × 5 conditions = 130 ratings per person, on top of all the tasks. Tired participants answer carelessly, which adds noise to *every* measure in the study, not just this one. The cost is paid by the whole experiment.

Only its "perspicuity" dimension is really relevant, and a single pairwise preference question (Part 5) captures that at a thirteenth of the cost.

### 6.3 Net Promoter Score (NPS) — REJECT

**What it is.** One question — "How likely are you to recommend this to a friend or colleague?", 0–10. Scores 9–10 are "promoters", 0–6 "detractors", and NPS = %promoters − %detractors.

**Why it fails here.** It is a **customer-loyalty metric for businesses**, designed to predict commercial growth. "How likely are you to recommend this road numbering scheme to a friend?" is not a question anyone can answer meaningfully. It has a single item (so it is statistically insensitive), no connection to spatial cognition, and its inclusion would signal to a reviewer that the metrics were chosen without regard to what they measure.

This is the clearest reject on the list.

### 6.4 Eye Tracking & Pupillometry — REJECT (for the main study)

**What it is.** A camera-based device that records exactly where on screen a person is looking (**eye tracking**), and how wide their pupils are (**pupillometry**). Pupils dilate slightly under mental effort, so pupil size is used as a physiological indicator of cognitive load.

**Why it fails here.** Not because the data is poor — it is excellent. Because of what it costs us:

| Requirement | Consequence |
|---|---|
| Specialised hardware | High cost; usually one lab, one device |
| In-person attendance | Cannot recruit online |
| Per-person calibration | Several minutes lost per participant, and failures |
| Controlled lighting | Pupil size responds far more strongly to screen brightness than to mental effort — a serious confound that must be engineered away |
| Heavy data cleaning | Blinks, head movement, dropped samples |

The practical effect is that we could test roughly 20–30 people instead of 60–80. The differences between our algorithms are **small**, and detecting small differences requires **more** participants, not fewer. Eye tracking would trade away the very thing we need most: the ability to show a difference is real.

**What replaces it.** Our interaction log already records a behavioural version of the same idea — where the participant moved the map, what they hovered over, and how long they lingered. That is attention measured through the mouse rather than the eye. It costs nothing and works with unlimited participants.

**Optional extra.** If an eye tracker is available, a small 15–20 person lab sub-study makes a nice secondary contribution — but it must be framed as a bonus, never as the main evidence.

### 6.5 Gaze Fixation Duration — REJECT

**What it is.** How long the eye rests on one spot before moving on. Long fixations generally indicate difficulty processing what is there.

**Why it fails here.** It requires the same hardware as 6.4, so it carries the same cost. It is really one measurement produced by eye tracking rather than an independent method, so it stands or falls with 6.4. It falls.

### 6.6 Cognitive Walkthrough Score — REJECT (as a comparison metric)

**What it is.** An **expert inspection** method. Two to five usability experts — not ordinary participants — step through each task and at every step ask four questions:
1. Will the user be trying to achieve the right thing?
2. Will they notice that the correct action is available?
3. Will they connect that action with the result they want?
4. Once they act, will they see that progress is being made?

Every "no" is recorded as a usability problem.

**Why it fails here.** Three reasons.
1. It evaluates an **interface**, and our interface never changes.
2. It uses **experts**, not the ordinary people whose intuition is the entire subject of our claim. Asking a usability expert whether road numbering is intuitive misses the point.
3. It produces a **list of problems**, not a score that can be compared statistically between five algorithms.

**Where it still has a real role.** Run it **once, before recruiting anyone**, on the study interface. Two experts, one hour. Any confusion it finds in the interface would otherwise add noise to every condition equally and weaken the whole study. This belongs in the methods section as quality assurance, not in the results.

### 6.7 Gulf of Execution / Evaluation Time — REJECT as a metric, KEEP as framing

**What it is.** Two ideas from Don Norman's foundational work on design (1986):

- **Gulf of Execution** — the gap between what you *want* to do and what the system lets you do. *"I want to find road 47 — but what do I actually click?"*
- **Gulf of Evaluation** — the gap between what the system *shows* you and your understanding of it. *"The map says road 82 — but what does that tell me about where I am?"*

A wide gulf means the user has to do mental work to bridge it.

**Why we do not use it as a number.** There is no standard, validated procedure for putting a number on either gulf. "Gulf of Evaluation Time" is not an established measurement with published values to compare against. If we invented our own way to score it, we would be doing precisely the thing that draws criticism: reporting a metric of our own invention with nothing external to anchor it.

**Why we keep the idea anyway.** The **Gulf of Evaluation is exactly the right way to describe our research problem**. The road number *is* the system's output. How easily a human turns "82" into an understanding of where they are *is* our research question, stated in Norman's terms. It belongs in the paper's introduction as framing.

The nearest thing we do measure is **wayfinding errors** in Task 3 (§4.6): every step that takes a participant no closer to their goal is a step where the numbering failed to tell them where they were. That is a behavioural measure of the same gap, using an established metric rather than an invented one.

(A relative-direction judgement task — "is road 82 north or south of road 47?", with the map hidden — would measure it more directly, and is the obvious addition if a later round has room for a fourth task.)

> **The general principle worth remembering.** Keep the concept, but measure it with an instrument that already exists. That way you get the theoretical depth without inventing a metric.

---

## Part 7 — What the interface already records for free

Six of the ten kept methods need **no new measurement work at all**. The website's interaction log already writes every event, with a timestamp, to `logs/events.jsonl`.

| Method | Already logged? | What is captured |
|---|---|---|
| Task Completion Rate | ✅ | Task start, answer submitted, correctness |
| Error Rate | ✅ | Guess, actual value, difference, parity match |
| Task Time | ✅ | Millisecond timestamp on every event |
| Learnability | ✅ | Trial order preserved, so error-by-trial is recoverable |
| Pan/Zoom Frequency | ✅ | Continuous gestures grouped into single actions |
| Interaction Effort | ✅ | Every click, pan, zoom, hover and search |
| Route Deviation | ⚠️ partly | Clicks are logged; the click *sequence* needs recording as a route |
| Wayfinding Errors | ❌ | Needs task T3 to be built |
| NASA-TLX | ❌ | Needs the six sliders to be built |
| Contextual Appropriateness | ❌ | Needs the rating questions to be built |

So roughly half the work is already done, and what remains is mostly new task screens rather than new measurement machinery.

---

## Part 8 — The whole study on one page

### Design
- **Within-subjects**: every participant sees every algorithm.
- **Schemes compared**: 4 - MUCS, MUCS+Min-cut+Bucketing, BFS as a reference point, and a random numbering as the floor.
- **Cities**: 3 (Brooklyn, Hyderabad, Melbourne), so contextual appropriateness can be tested.
- **Order**: counterbalanced, so no algorithm benefits from its position.
- **Participants**: 40. (Roughly 32 would be enough for one comparison, but comparing several pairs at once requires a stricter threshold, which needs a larger sample.)
- **Duration**: about 30 minutes per participant.

### Session flow

```
  Consent and background questions  (including city familiarity)      3 min
  Practice block  (with feedback, so people understand the task)      3 min
  ┌─ For each of the 4 schemes, in counterbalanced order ───────────┐
  │   T1  Fill in the blank        ~14 trials                        │
  │   T2  Find the road            ~4 trials                         │
  │   T3  Get there                ~3 trials                         │  ~6 min each
  │   Q1  NASA-TLX                 6 sliders                         │
  └──────────────────────────────────────────────────────────────────┘
  Q2  Pairwise preference  (6 comparisons)                           2 min
  Q2  Contextual appropriateness  (3 items per city)                 2 min
  SUS on the website itself  (once, as a sanity check)               1 min
```

### The ten metrics, and what each one buys us

| Method | The question it answers in one line |
|---|---|
| Task Completion Rate | Can people use it at all? |
| Error Rate | How wrong do they get it — and do they pick up the odd/even rule? |
| Task Time / Time to Destination | How long does it take? |
| Learnability | Does it click after practice? |
| Route Deviation | Do the numbers point the right way? |
| Wayfinding Errors | How often do the numbers mislead? |
| Pan/Zoom Frequency | How much hunting is required? |
| Interaction Effort | How much total work? |
| NASA-TLX | How mentally hard does it *feel*? |
| Contextual Appropriateness | Does it work in every kind of city, for every kind of person? |

### Three things that must not be forgotten

1. **Normalise every error by the number range.** Without this, an algorithm that happens to use fewer numbers wins automatically, and the entire study's headline result is an artefact. This is the single biggest risk in the whole design.
2. **Make parity agreement the primary outcome.** It is a yes/no measure, so the number range cannot distort it, and it tests a specific design decision in our algorithm directly.
3. **Decide the analysis before collecting data, and write it down.** Registering the plan in advance (on a public site such as OSF) is the strongest available answer to any suggestion that the metrics were chosen to flatter the result.

---

## Where this fits with the rest of the project

| Document | What it covers |
|---|---|
| **This file** | The human-evaluation methods going into the paper |
| `EVALUATION_GUIDE.md` | The **automatic** measurements already built into the website, in plain language |
| `EVALUATION.md` | The longer research plan, including statistical detail |
| `README.md` | The software itself: how to run it |

The automatic measurements and the human ones are meant to be joined up. Once the human study has run, we can check **which automatic measurement best predicts human performance** — and then use that cheap measurement as a stand-in for expensive human testing in future work. That link is the most valuable outcome available from doing both.
