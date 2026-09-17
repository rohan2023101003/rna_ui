# The Human Evaluation Study

A self-contained 30-minute study that participants run in their browser.
Nothing to install for them, no server, no login. When they finish, their
answers are sent to you automatically.

---

## What you do — the whole thing, in order

### Step 1 — Build the data bundle (once)

```bash
cd rna_ui
python3 evaluate/build_bundle.py
```

Bakes **all 6 road networks** and **all 17 algorithm outputs** into JavaScript:

```
evaluate/js/bundle.js                 the index - algorithms and networks   (3 KB)
evaluate/js/cities/Brooklyn-Network-1.js   one file per network        (18-285 KB)
```

The browser loads the index straight away and then only the one network the
participant chose, so nobody downloads five maps they will never see. Re-run it
only if `data/` or `results/` changes.

Check it agrees with the research interface at any time (needs Node, which you
only need for this check — the study itself has no build step):

```bash
node evaluate/tests/check_design.mjs
```

That plans every trial the study can produce, without a browser, and checks
every rule in *How trials are chosen* trial by trial — see *Checking the
arithmetic* for all five test suites.

### Step 2 — Try it yourself locally

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/evaluate/> and run through it once as participant 1.
This takes 30 minutes, but do it — you will spot anything confusing before 40
people meet it.

*(The study is plain static files, so any static server works. `python3
server.py` is the separate research interface and is not needed here.)*

> **Not seeing a change you just made?** A half-finished session is saved in the
> browser, and resuming it skips the opening screens — including the setup
> screen. Changing anything in `js/design.js` now invalidates that saved session
> automatically, but if you are ever unsure, press **Start again from the
> beginning** on the welcome-back screen, or hard-reload with **Ctrl+Shift+R**.

### Step 3 — Put it online

See [Hosting it, step by step](#hosting-it-step-by-step) below — GitHub Pages,
from `git init` to a working link, then Apps Script so the results arrive on
their own.

### Step 4 — Set up a place to receive results

Leave `submit.url` empty and the last screen asks the participant to download a
file and send it to you. That works, and it is where people drop out.

**Put a URL in `submit.url` and there is nothing for them to do.** Their answers
are posted to you the moment they finish; they never touch a file. See
[Hosting it, step by step](#hosting-it-step-by-step), Part 3, for the
five-minute setup.

### Step 5 — Invite the 40 participants

Send each person **their own number, 1 to 40**. This is important: the number
decides which schemes they see and in what order, and the design only balances
correctly if each number is used exactly once. Keep a list of who got what.

> Hi — thanks for helping with our road-numbering study.
> It takes about 30 minutes and runs in your browser. Nothing to install.
>
> **Your participant number is: 7**
>
> Open this link and enter that number:
> https://your-username.github.io/rna_ui/evaluate/
>
> Your answers are sent automatically when you finish — please keep the tab
> open until it says "Sent".

### Step 6 — Collect the files

They arrive in your Drive folder as people finish, one `rna-study-P07_….json`
per participant. When you are ready, download the folder and unzip it into
`evaluate/results/`.

### Step 7 — Get the results

```bash
pip install -r evaluate/requirements.txt     # once
python3 evaluate/aggregate.py
```

Prints the results table and writes into `evaluate/output/`:

| File | What it is |
|---|---|
| `trials.csv` | one row per scored trial — the raw table for any further analysis |
| `practice.csv` | one row per warm-up trial, recorded but not analysed |
| `ratings.csv` | the real-city rating and comment, one row per participant per scheme |
| `summary.csv` | the printed results table as a spreadsheet |
| `models.txt` | mixed-effects models testing whether the differences are real |
| `figures/*.png` | one bar chart per measure, with error bars |

Run it any time. Below 10 participants it warns you not to read anything into
the numbers yet.

---

## What a participant experiences

| Step | What happens | Time |
|---|---|---|
| Welcome & consent | What the study is, what is recorded | 2 min |
| Participant number | The number you sent them | 1 min |
| Background | Age range, map use, familiarity with each city | 1 min |
| **Choose a map** | They pick one of the **six networks** (a small and a large one for each of Brooklyn, Hyderabad and Melbourne); everything then happens on that map. *While `schemeSelection` is `'ask'` this screen also carries the setup box — see below.* | 1 min |
| **Practice** | The odd/even rule is explained, then all three activities on a small fixed map, **with the answers shown** — 2 guesses, 1 search, 1 journey. Recorded separately, not analysed | 4 min |
| **One block per scheme** (4 by default) | Each: 14 guesses → 4 road-finds → 3 journeys → 6 workload sliders → one 1–7 rating and an optional comment about that scheme | ~5 min each |
| Done | Their answers are **sent automatically**. Nothing to download, nothing to email | seconds |

The four schemes are shown as **A, B, C and D**. Participants are never told
which is which, so nobody tries to be helpful about "the good one". Which four
of the seventeen they get, and in what order, comes from their participant
number alone — see *Which schemes, and how many* below.

Practice is **identical for everyone**, and recorded apart from the scored
trials — see *The warm-up* below.

---

## The warm-up

Fixed for every participant, so that what people bring to their first scored
trial is the same thing:

| | |
|---|---|
| **Map** | `Hyderabad/Network-1` — the smallest of the six at 83 roads and under 3 km, so the whole thing fits on screen |
| **Scheme** | `mucs_BGP` — partitioned **and** bucketed |
| **Trials** | 2 guesses, 1 search, 1 journey — all three tasks |
| **Recorded?** | Yes, in a separate list, never mixed with the scored trials — see *The warm-up is recorded too* |

Three deliberate choices there:

**All three tasks, not just the guessing one.** Meeting a task for the first
time while being measured is what produces a slow, error-filled first block. One
go at each removes it.

**The smallest map.** Nobody should be learning to pan and zoom at the same time
as learning the task.

**A partitioned and bucketed scheme.** These are the two things that confuse
people — coloured zones where the numbering restarts, and several roads sharing
a number. Meeting them here, where the answer is shown every time, is much
better than meeting them mid-study and reading them as a bug.

It is set in `js/design.js` and is not offered on the setup screen, because a
warm-up that differs between participants is one more thing that could explain a
difference in the results:

```js
practice: {
  city: 'Hyderabad/Network-1',
  scheme: 'mucs_BGP',
  infer: 2, find: 1, navigate: 1,
},
```

> **One thing to weigh.** If `mucs_BGP` ends up among your scored schemes, those
> participants have seen that style of numbering once before — on a different
> map, with completely different numbers, but the idea is pre-learned. It is the
> same for every participant so it cannot vary between people, but it could
> flatter `mucs_BGP` slightly against the others. If that bothers you, set
> `practice.scheme` to a variant you will not be scoring, such as
> `middfs_BGP_d5` — it is partitioned and bucketed in the same way.

---

## The three tasks

**Task 1 — Fill in the blank.** One road's number is hidden and highlighted.
The participant types the number they expect. *14 repeats per scheme* — the
repetition is what makes **learnability** measurable: we compare error in the
first third of the block against the last third. **The correct number is shown
after every guess**, because learning needs feedback; the guess is recorded
before the answer appears, so it cannot affect what we score.

**Task 2 — Find the road.** "Find road 47." They search the map and click it.
The target's label is **pinned**, so it is guaranteed to be drawn however
crowded the map gets — nobody is ever hunting for a number that is not on
screen. "I cannot find it" is available from the start, and taking it **shows
them where the road was** before moving on. Measures time-to-destination, wrong
clicks, give-ups, and how much panning and zooming it took.

**Task 3 — Get there.** They start on one road and click roads one step at a
time to reach a target **number**. The road they are on is green, and **every
road they can actually step onto is outlined in blue**. Measures route deviation
(their route ÷ the shortest) and wayfinding errors (steps that move them further
from the goal). The shortest route is counted in **steps**, with distance on the
ground recorded beside it — see *Steps, with distance alongside* below.

When the journey ends, **both routes are drawn**: the one they took in green,
and the shortest one that existed in dashed orange, with both written out as
number sequences. The shortest route is also saved in the results, so route
deviation can be checked against the road graph rather than taken on trust.

### Every trial ends the same way

All three tasks, practice and scored alike, end on the same two-line review and
a **Next** button. Nothing advances on a timer.

| Task | What the review says |
|---|---|
| Fill in the blank | *You said: 55* / *The answer: 50 — out by 5*, with the road highlighted carrying its real number |
| Find the road | *You: found it after 2 other roads* / *The answer: road 47, highlighted in green* |
| Travel | *Your route: 12 → 18 → 40 → 9 → 6 (4 steps)* / *Shortest route: 12 → 21 → 9 → 6 (3 steps)*, both drawn on the map |

The clock stops and the interaction counters are read **when the answer is
given**, before any of that is drawn — so however long someone spends reading
the review, none of it lands in their task time.

**Enter is still the submit key.** Type a number, press Enter, and the guess is
submitted — that has not changed. A *second* Enter (or Space, or a click) moves
on to the next trial.

> **A bug this replaced, and why it needed two fixes.** Pressing Enter to submit
> used to skip the review entirely, so the answer flashed past unread. Clicking
> *Submit* with the mouse worked; pressing Enter did not. Two separate routes
> caused it:
>
> 1. `review()` attaches its Enter-to-continue listener to `document` from
>    inside the submit handler — while that same keypress is still bubbling
>    *towards* `document`. A node's listener list is read when the event arrives
>    there, so the keypress that opened the review immediately closed it.
> 2. The Next button is focused, and a focused `<button>` is **natively**
>    activated by Enter. That is a click the page never sees as a keypress, so
>    guarding the key listener alone would not have caught it — and a reflex
>    "Enter, Enter" would still have skipped the answer.
>
> So the gate sits on the advance itself, not on the key listener, and holds for
> `ADVANCE_GUARD_MS` (350 ms) — long enough to absorb a reflex double-tap, short
> enough that a deliberate press after reading two lines is never refused.
>
> `evaluate/tests/check_review.mjs` reproduces all of this against a real DOM.
> It fails 5 of its 8 checks against the old code and passes all 8 against the
> current one.

### The warm-up is recorded too

Practice trials are written to **`practiceTrials`** in the result file, and to
**`output/practice.csv`**, completely separate from the scored `trials`. Every
row carries `phase: "practice"`; scored rows carry `phase: "scored"`.

They are not analysed and they never count towards whether a session is
complete. They are kept because the first few attempts at a task are the
steepest part of any learning curve, and discarding them now would make that
unrecoverable later. Pooling them with the scored trials would be wrong — they
are a different network under a fixed scheme — which is exactly why they live in
their own list rather than being filtered out of one shared list.

> **The destination is always reachable, and always a real journey.** The start
> road is picked first; the possible destinations are then whatever a
> breadth-first search from it actually reached, so an unreachable pair cannot
> be generated. All six networks are in fact a single connected component
> (193, 873, 83, 1351, 170 and 684 roads), and because travel is undirected the
> participant can never strand themselves — the road they came from is always
> among the blue options, and every step stays inside the component the goal is
> in.
>
> The 4-to-9-hop window is measured to the **nearest** road carrying the target
> number, not to the road the picker named. That matters on the partitioned and
> bucketed schemes, where a number belongs to several roads: measuring to the
> named road instead let 130 of 1224 journeys finish in under 4 hops, all of
> them on those schemes, which would have flattered exactly the schemes the
> paper is testing. If a participant runs out of time, the trial is recorded as
> not arrived — that is a result, not a broken trial.

> **Why the blue outlines matter.** Some roads meet on screen without sharing a
> junction in the underlying data — 32 such pairs in Melbourne Network-1, 4 in
> Hyderabad. Without the outlines, participants click a road that visibly
> touches theirs and are told it is not connected, which reads as a bug and adds
> noise to the results. This is not one-way streets: the task treats travel as
> undirected. (Brooklyn's data marks all 193 roads `oneway=1`, which looks like
> an artefact of how it was exported rather than a real restriction.)

---

## The odd/even rule

The paper numbers roads by one convention: **roads running north–south get odd
numbers, roads running east–west get even numbers**. Participants are told this
before practice, it stays on screen under the map in every trial, and a north
arrow sits in the corner of the map, because the rule means nothing without it.

It is told rather than left to be discovered because it is part of the numbering
system, not a hint about it — the way drivers are told that odd US interstates
run north–south. A real city using this numbering would publish it.

**Telling people favours no scheme.** Every one of the 17 was generated with the
rule. Measured across all six networks:

| Schemes | Roads that obey the rule |
|---|---|
| the 15 modified schemes | 99.7–99.9% |
| plain `bfs`, `dfs` | about 86% |

A scheme gains from the rule being known only by actually keeping it, which is
exactly the property claimed for it. Telling everyone the same sentence is what
makes that a fair test.

Two things are recorded on every guess, and they are kept apart because they are
different findings:

| Field | Means |
|---|---|
| `ruleFollowed` | the participant's guess had the parity the road's direction calls for |
| `ruleHolds` | the scheme's real number has it too |

A participant who follows the rule on a road where the scheme breaks it gets the
parity wrong — and that is the rule failing them, not them failing the task.
`showParityRule: false` in `js/design.js` hides the rule, which turns the
guessing task into discovering it unaided; that is a different question, and not
one the paper asks.

---

## How trials are chosen

Not simply at random, and this matters more than it sounds. Random sampling was
**measured against the shipped data first**, and it failed in ways that bias the
very comparison the study exists to make:

| Problem with plain random sampling | Small networks |
|---|---|
| a block asked the same number twice, so the second time its answer had just been shown | 28–44% of blocks |
| a *find road N* target had just been revealed as an earlier guess's answer | ~28% of searches |
| a journey's goal had already been shown earlier in the block | ~30% of journeys |
| find targets landed on multi-segment roads, versus their share of numbers | 4× over-represented |

All of these bite hardest on **partitioned and bucketed schemes**, which have the
fewest distinct numbers — so those schemes would have looked better for reasons
that have nothing to do with how good their numbering is.

The rules now, strongest first:

**Never**
- use the same road twice in a block, or guess the same physical road twice;
- ask a guess whose answer the block later asks you to find or travel to;
- ask you to find or travel to a number an earlier trial has already located.

**Avoid** — relaxed only when a small network runs out, and recorded when it is
- two guesses with the same number in different zones;
- a trial on a road that shares a junction with the trial just before it.

Find targets are drawn **uniformly over numbers**, not roads, so a road split into
fifteen segments is not fifteen times as likely to be asked. Each block also
draws its roads from its own share of the network, so the blocks of one session
test different roads.

> **Why spacing is applied to the order, not the choice.** A first version
> filtered the choice for spacing, and measuring it showed a new bias: a number
> spread over many segments is more likely to touch an earlier pick, so the most
> heavily bucketed schemes lost their multi-segment numbers — the easy ones to
> find — more often than chance allows (z = −3.6). Choosing with the hard rules
> alone and then arranging the order keeps the choice uniform (worst |z| = 1.45,
> mean z = −0.03 across schemes) and still removes adjacency.

Verified by `tests/check_design.mjs` on **every trial** of 6 blocks × 17 schemes ×
6 networks at the default 14/4/3:

| | Result |
|---|---|
| answers revealed before they are asked | **0** |
| same physical road guessed twice in a block | **0** |
| blocks shorter than configured | **0** |
| trial next to the one before it | ≤ 0.4%, each one flagged |
| same number reused across zones | 0 on five networks. On Brooklyn/Network-1: 2.5% of trials across all 17 schemes, but 7.1% for a set with two partitioned schemes (`mucs_BGP` alone, 12 of 84). Each is flagged |
| guess roads reused across blocks | 0 on the large networks; 1–12% on the small ones, which do not have enough roads |

Every trial carries a `relaxed` list naming any soft rule it needed, so a
sensitivity analysis can drop those trials in one line.

> **Small maps have a ceiling.** Because answers are never repeated, a
> partitioned scheme — whose numbering restarts in every zone — can run out of
> distinct numbers on a small map at high trial counts. The setup screen asks the
> real planner and warns you before that happens. At the defaults, every network
> and scheme supplies every trial.
>
> Short of running out, a small map can still force some guesses to reuse a
> number already answered in another zone. For `mucs`, `mucs_BGP`,
> `middfs_BucsGP_d5` and `bfs` at the defaults that happens on
> **Brooklyn/Network-1 only** — 7.1% of trials — and on none of the other five
> networks. So if a partitioned scheme is in your final set, **do not fix
> Brooklyn/Network-1 as the study map**. The setup screen warns about this too.

---

## Time: recorded, never shown

There is **no running clock** in any task. A visible timer is a manipulation,
not a neutral display: it pushes people to trade accuracy for speed, and pushes
hardest on the hardest schemes — so it would change the very numbers being
compared. Every duration is recorded silently.

The two tasks with a limit say so up front (*"You have up to 2 minutes for each
road"*), and in the last 30 seconds of a trial a notice appears, so nobody is cut
off without warning. Whether that notice was shown is recorded as `warned`.

---

## Steps, with distance alongside

The shortest route in Task 3 is counted in **steps** — roads stepped onto. That
is the primary measure, for three reasons: one click *is* one step, so it is what
the participant actually does; it is unambiguous; and it matches the paper's own
connectivity metrics, which count hops (`sHop` in Metrics 2 and 3).

Distance on the ground is recorded beside it, because a route with fewer but
longer roads can win on steps and lose on metres:

| Field | Means |
|---|---|
| `routeMetres` | length of the route taken |
| `shortestMetres` | length of the shortest route by distance (Dijkstra), to the nearest road with the target number |
| `routeDeviationMetres` | the first divided by the second |

A step is counted midpoint to midpoint — half of each road — which is symmetric
and does not depend on which end of a road someone is imagined to enter.
`aggregate.py` reports route deviation both ways.

---

## Why two roads can share a number

This is not a rendering fault — it is what the algorithm produced, and both
causes are steps of the pipeline in the paper.

**Step 1, min-cut partitioning (`GP`).** The network is cut into partitions and
the numbering **starts again inside each one**, so number 6 exists once per
partition. In the study these are drawn in **different colours**, one per
partition, with a line under the map saying so. A scheme that was not
partitioned stays plain black — colouring it would imply a division that is not
there.

**Step 2, bucketing (`B`).** Every segment of one physical road is put in one
bucket and given **one number**, the way a real street keeps its name for miles.
Those segments are drawn **slightly thicker** than a road that is a single
segment.

Measured across the shipped data, the two are cleanly separated:

| Scheme | Roads sharing a number | …of those, in the same partition |
|---|---|---|
| `mucs`, `mdfs`, `middfs_*`, `bfs`, `dfs` | 0 | 0 |
| `mucs_GP` (partitioned only) | 1309 of 1351 | **0** |
| `mucs_B` (bucketed only) | 939 of 1351 | **939** |
| `mucs_BGP` (both) | 1340 of 1351 | 935 |

*(Hyderabad Network-2.)* Partitioning never repeats a number inside a
partition; bucketing only ever repeats one inside a partition. Every one of the
264 multi-segment groups in that table is **connected** in the road graph, which
is what makes them one physical road rather than a coincidence.

**So which road should the participant click?** Any of them. Every task is
scored on the **number**, never on a particular road id:

- *Fill in the blank* asks for a number, and hides that number on **every** road
  carrying it, so the answer is never printed next to the question.
- *Find the road* accepts a click on any road with that number, and says so in
  the prompt when there is more than one.
- *Get there* finishes when you step onto **any** road with the target number,
  and the "are you getting closer?" measure is distance to the nearest of them.

---

## Which schemes, and how many

There are **17** algorithm outputs — `mucs`, `mucs_B`, `mucs_GP`, `mucs_BGP`,
`middfs_d1/d3/d5`, six more MIDDFS variants, `mdfs`, `bfs`, `dfs` — and the same
17 exist for every one of the 6 networks. Nobody can sit through 17 of them in
half an hour, so a session covers a handful. `schemeSelection` in
`js/design.js` decides which:

| Mode | What happens | When to use it |
|---|---|---|
| `'ask'` *(current)* | The setup screen lists all 17 next to the map chooser. Tick the ones to compare — 1 to 6 of them, and set the trial counts alongside. | Piloting: try any combination without editing code |
| `'random'` | Each participant gets `schemesPerParticipant` drawn from the pool by participant number | A wide first pass, when you want every algorithm seen by someone |
| `'fixed'` | Everyone does `fixedSchemes` | **The real study** |

**Whichever mode, the order is always counterbalanced by participant number.**
The set is one decision; the order it is presented in is another, and the second
one is never yours to make.

### `'ask'` — the setup screen

Ticking the boxes shows a live estimate of how long a session will take, so you
can see what six schemes costs before committing to it. Any count from **1 to
6** works: the balanced order is generated (a Williams design), not looked up in
a table, so there is nothing to add when you change the number.

The same box sets **how many trials** of each task, while `trialSelection` is
`'ask'`. Change a number and the estimate updates, along with notes on what that
count costs you in the analysis — see *Does the trial count change any of
these?* below.

> **One scheme is allowed** and is the quickest way to check an algorithm end to
> end. With one there is nothing to compare against, so the models have no
> contrast to work with. It is a way to look at a scheme, not a way to get a
> result.

> **This screen must not be shown to participants.** It names the algorithms,
> and the blinding depends on them not knowing which scheme is which. There is a
> warning on the screen itself saying so. Switch to `'fixed'` before you invite
> anyone.

### `'random'` — the wide pass

The draw is **systematic, not random-per-person**: one shuffled ordering of all
17 is shared by everyone and read from a different starting point per
participant. Across 40 participants that gives every algorithm 9 or 10 sessions
instead of leaving some unseen by chance. Seeded by participant number, so the
same number always produces the same set, order and roads.

### `'fixed'` — what to ship

Once you and your advisor have chosen, name them:

```js
schemeSelection: 'fixed',
fixedSchemes: ['mucs', 'mucs_BGP', 'middfs_BucsGP_d5', 'bfs'],
citySelection: 'fixed',
fixedCity: 'Brooklyn/Network-2',
trialSelection: 'fixed',
trials: { infer: 14, find: 4, navigate: 3 },
practice: 3,
submit: { url: 'https://script.google.com/macros/s/.../exec', askEmail: true },
```

The setup screen disappears, every participant does those schemes on that map,
and each participant number gives a different order. `aggregate.py` reads
whichever schemes are actually in the result files, so nothing else changes.

> **A note on power.** Four fixed schemes × 40 participants is a much stronger
> comparison than 17 schemes × ~9 participants each. The wide draw is right for
> a pilot — it shows which algorithms are worth the participants' time — but the
> study that goes in the paper should fix a small set.

---

## What gets measured

Every one of these is computed **once per participant per scheme**, and it is
those per-participant values the confidence intervals resample. The exact
formula is given because "error rate" on its own is not a definition.

### From Task 1 — fill in the blank

| Measure | Exactly what is computed | Better |
|---|---|---|
| **Parity agreement** | proportion of guesses whose odd/even matches the answer's. 50% is chance | high |
| **Guess follows the odd/even rule** | proportion of guesses with the parity the road's direction calls for. Roads with no clear direction are left out | high |
| **Inference error** | mean of `|guess − answer| ÷ (highest number − lowest number in that scheme)`. Dividing by the scheme's own range is what makes a scheme numbering to 1353 comparable with one numbering to 18 | low |
| **Inference success rate** | proportion of guesses within 10% of the range. The 10% is fixed in `INFER_SUCCESS_TOLERANCE`, set in advance | high |
| **Time per guess** | median seconds per guess (median, not mean, so one interruption does not move it) | low |
| **Learning gain** | `(mean error over the first third − mean error over the last third) ÷ mean error over the first third`. Positive means the scheme is being picked up. Needs ≥ 6 guesses | high |

### From Task 2 — find the road

| Measure | Exactly what is computed | Better |
|---|---|---|
| **Find success** | proportion of searches where a road with the target number was clicked | high |
| **Time to find** | median seconds **over successful searches only** — a timed-out search has no meaningful duration | low |
| **Gave up** | proportion where "I cannot find it" was pressed | low |
| **Wrong clicks** | mean wrong clicks per search | low |
| **Pans + zooms** | mean pan gestures + zoom gestures + map-button presses per search | low |
| **Interaction effort** | mean of pans + zooms + button presses + clicks + hovers per search | low |

### From Task 3 — travel between roads

| Measure | Exactly what is computed | Better |
|---|---|---|
| **Journey completion** | proportion of journeys where a road carrying the target number was reached | high |
| **Route deviation (steps)** | median of `steps taken ÷ shortest possible steps`, over completed journeys. 1.00 is a perfect route | low |
| **Route deviation (distance)** | the same, in metres: `route length ÷ shortest route length` | low |
| **Wayfinding errors** | mean steps per journey that left the participant no closer to the nearest road with the target number | low |
| **Backtracks** | mean uses of "undo last step" per journey | low |

### From the questionnaires

| Measure | Exactly what is computed | Better |
|---|---|---|
| **NASA-TLX workload** | Raw TLX: the six sliders averaged, with "your performance" reversed first (`100 − value`), per the standard scoring | low |
| **Mental demand, Frustration** | those two sliders on their own, since they are the ones a numbering scheme should move | low |

The six dimensions are Hart & Staveland's, unchanged. Their *descriptions* are
written in terms of this study — "how much physical work was it, clicking,
dragging, zooming the map?" rather than the generic "how much physical activity
was required?" — which is ordinary practice and makes them answerable. Two
deliberate restraints: *confusion* is left out of Frustration, because it
belongs to Mental Demand and would blur the two; and no item mentions the
numbering scheme, because the heading over the sliders already does, once, for
all six. Time pressure will sit near the floor for most people, since there is
no visible clock — that is expected, and it doubles as a check that the
30-second warning is not creating pressure of its own.
| **Could be used in a real city** | 1–7 agreement with *"I could imagine a numbering like this being used in a real city"*, asked **after each block about that scheme**. Buttons with no default, so an untouched answer cannot pass for a middle one | high |

The optional comment asked with it — *"What, if anything, felt wrong about this
numbering?"* — is written to `output/ratings.csv` against its scheme.

> **Why the rating moved, and the comparison round went.** The real-city question
> used to be asked once, at the very end, after all four schemes — one number
> that could not be attributed to any of them, the same flaw that removed the
> usability questionnaire below. Asked per block it belongs to one scheme and
> becomes a comparison. The side-by-side preference round was removed: it asked
> people to judge schemes from two small maps at the end of the session, from
> memory of blocks up to half an hour old, and the per-scheme rating now answers
> the same question at the moment the scheme is fresh.

> **Why there is no usability questionnaire.** An earlier draft ended with a
> 10-item System Usability Scale. It was removed, because it cannot contribute
> to this paper: SUS is answered once, about the website, so it is *constant
> across schemes* within a participant and can never separate them. The
> objection it is usually there to answer — "these differences are artefacts of
> your custom interface" — is answered by the design instead, and answered
> better: every scheme is judged through the same interface, by the same person,
> in a counterbalanced order. An interface effect that applied equally to all
> four schemes cannot produce a difference *between* them. A single SUS number
> could not have ruled out an interface×scheme interaction anyway, and the
> minute it cost came at the worst possible moment — right before the step where
> the results are submitted.

### Does the trial count change any of these?

**No.** Every measure above is a proportion, a per-trial mean or a median — none
is a total — so a participant who does 4 searches and one who does 20 are on the
same scale. `tests/check_metrics.py` proves it: it runs identical behaviour
through 4 trials and through 40 and asserts every measure comes out the same
number.

What the count does change is **precision**, and two measures have a floor:

- **Learning gain needs at least 6 guesses** (`learnMin`), because it splits the
  block into thirds. Below that it is not reported at all rather than reported
  badly.
- **Proportions out of 1 or 2 trials** can only be 0%, 50% or 100% per person,
  which widens the confidence interval a lot.

The setup screen says both of these next to the box you are typing in.

> **One thing that must not change mid-study:** if some participants do 14
> guesses and others do 6, their learning-gain numbers are measuring slightly
> different things (thirds of different sizes). Fix the counts before you invite
> anyone — the same reason you fix the schemes.

See [../HCI_EVALUATION_METHODS.md](../HCI_EVALUATION_METHODS.md) for what each
means and why it is included.

### What "one pan" means

This is worth being precise about, because getting it wrong would have put a
**device confound inside an outcome measure**.

Dragging the map fires 50–200 `pointermove` events; one scroll gesture fires
5–30 `wheel` events. How many depends on the pointing device and the screen
refresh rate — a trackpad produces far more than a mouse for the same physical
action. Counting those events would have measured the participant's hardware,
not their behaviour, and would have done so *inside* `find_panzoom` and
`find_effort`.

So the renderer coalesces each continuous gesture into one event:

| Recorded as | Counts |
|---|---|
| `pans` | one per drag, one per arrow-key press |
| `zooms` | one per scroll burst, one per +/− press, double-click or box-zoom |
| `toolPresses` | presses of the on-screen **+**, **−**, **Whole map**, **Back to road** |
| `clicks` | clicks that landed on a road |
| `emptyClicks` | clicks that landed on blank map |
| `hovers` | roads the cursor entered — emitted on transitions, so resting on one road is one hover, not one per frame |
| `panEvents`, `zoomEvents` | the raw event counts, kept alongside so the coalescing can be checked or undone at analysis time |
| `hiddenMs` | milliseconds the browser tab spent in the background during that trial |

Nothing is thrown away: the raw counts are in every trial row of `trials.csv`
next to the coalesced ones.

### Time, and people switching tabs

`performance.now()` is monotonic, so times are not affected by the clock
changing. But elapsed time keeps running when someone switches tab or answers
the door, and this is an unsupervised online study, so it will happen.

Every trial records `hiddenMs` — how long its tab spent in the background — and
`aggregate.py` flags any session where that is more than a couple of seconds:

```
Worth checking before you trust these:
  P17: 3 trial(s) with the tab in the background (94s in total) - their times are inflated
```

It is reported rather than silently subtracted, because what to do about it is a
judgement call and should be yours, made once, in the open.

### Checking the arithmetic

```bash
python3 evaluate/tests/check_metrics.py
```

Builds sessions whose right answer is known by construction — "this person found
3 of 4 roads, with wrong-click counts 0, 2, 4, 6" — and asserts the pipeline
reproduces every number, including each interaction counter separately, both
route deviations, both rule measures and the Raw TLX reversal.

```bash
node evaluate/tests/check_design.mjs
```

plans every trial of 6 blocks × 17 schemes × 6 networks and asserts every rule in
*How trials are chosen* trial by trial, that find targets are uniform over
numbers, and that every shortest route shown — by steps and by distance — is a
genuine chain of connected roads of exactly the recorded length.

```bash
node evaluate/tests/check_flow.mjs
```

plays a participant through the **whole study** in a real DOM — consent, setup,
every practice task, two scored blocks, the end-of-block questions, the automatic
send — clicking the same buttons and roads a person would, then opens the file
that would have been sent and checks every field the analysis relies on.
`fetch` is replaced first, so nothing is ever posted to the real address.

All five suites at once:

```bash
npm install      # once: jsdom, the only dependency, and only the tests need it
npm test
```

| Suite | Checks |
|---|---|
| `evaluate/tests/check_design.mjs` | schemes, ordering, trial selection, routes, the warm-up |
| `evaluate/tests/check_review.mjs` | the review screen, against a real DOM |
| `evaluate/tests/check_flow.mjs` | the whole study end to end, and the result file it sends |
| `evaluate/tests/check_metrics.py` | every measure against a hand-computed answer |
| `analysis/test_metrics.py` | the automatic (non-human) metrics |

---

## How the design protects the results

**Order is rotated per participant.** A balanced Latin square means each scheme
appears equally often in each position, so no scheme benefits from being first
(fresh) or last (tired). Participant 1 gets a different order from participant 2.

**One map per participant.** All four blocks use the same network, so the only
thing changing between blocks is the numbering. Which network is either chosen
by the participant or fixed for everyone — see `citySelection` in
`js/design.js`.

> **Recommendation: fix one network.** Letting people choose means they pick the
> city they know, so familiarity contaminates the comparison, and it splits 40
> participants across 6 networks (~7 each) which is too few to compare schemes
> within any one of them. Set `citySelection: 'fixed'` and `fixedCity:
> 'Brooklyn/Network-2'` (or any map the setup screen shows no warning for) and all 40 people give data on the same
> map.

**Participants never choose their schemes.** Which schemes are compared is set
before anyone is invited — by you, once, in `js/design.js`. What the participant
number decides is the *order*, so there is no way for anyone to steer a
favourable comparison by reordering.

**Practice is kept apart.** The warm-up runs on its own map with its own scheme,
and is recorded in its own list, so learning the *task* never enters the data on
learning the *numbering*.

**No trial gives away another's answer.** Within a block, nothing a participant
is asked to find or reach has been located by an earlier trial — see *How trials
are chosen*. Left to chance this happened in about a third of searches on the
small maps, and most often on the schemes the paper argues for.

**Trials are the same for everyone given the same scheme in the same slot.**
Selection is seeded by network, block position and scheme, so two participants
doing Scheme B second answer about the same roads — differences between schemes
are not muddled by some people happening to get harder roads.

---

## Hosting it, step by step

Everything below is free and takes about twenty minutes the first time. At the
end you have a link to send people, and their answers land in your Google Drive
without anyone emailing you a file.

### Part 1 — Get the repository on GitHub

Skip to Part 2 if it is already pushed.

```bash
cd rna_ui
git init                      # only if this is not already a git repository
git add .
git commit -m "Road numbering study"
```

Make an **empty** repository at <https://github.com/new> — name it `rna_ui`, set
it **Public** (GitHub Pages needs public unless you pay), and do **not** tick
"Add a README". Then:

```bash
git remote add origin https://github.com/<your-username>/rna_ui.git
git branch -M main
git push -u origin main
```

Two things to check before you push, both already handled but worth confirming:

- `evaluate/js/bundle.js` and `evaluate/js/cities/*.js` **must be committed** —
  they are generated, but the hosted page loads them, so they belong in the
  repository. `git status` should not list them as untracked.
- `evaluate/results/*.json` must **never** be committed. `.gitignore` already
  covers it. The repository is public, so participants' answers must not go near
  it — and they will not, since they post to Apps Script instead.

### Part 2 — Turn on GitHub Pages

1. Your repository → **Settings** → **Pages** (left sidebar).
2. **Source:** *Deploy from a branch*.
3. **Branch:** `main`, folder `/ (root)`. **Save.**
4. Wait about a minute, then reload the page — it shows your site URL.

Your study is at:

```
https://<your-username>.github.io/rna_ui/evaluate/
```

Open it. If you get a 404, give it another minute; if it persists, check the
**Actions** tab for a failed "pages build and deployment".

Open it on a phone too — the study works on small screens.

### Part 3 — Make the results come to you

Until `submit.url` is set, the last screen shows a setup warning and a download
button. Once it is set, the participant's answers are **posted the moment they
finish** — no button to press, nothing to download, nothing to email. They see
*"Sending your answers…"* and then *"Sent — thank you."*

The download only reappears if a send fails, folded behind *"Having trouble?"*,
so nothing is ever lost.

A static page has no server, so it cannot email you by itself: doing that needs
a password or an API key, and anything in a public page is public. The fix is to
post to a small script that holds the credentials for you. Google Apps Script is
free, has no submission cap, and needs no new account.

**3a. Make two places for the results to land**

- A **Drive folder**, e.g. "RNA study results". Open it and copy the ID from the
  URL — `drive.google.com/drive/folders/`**`1AbC...xyz`**.
- A **Google Sheet**, e.g. "RNA study tracker". Copy its ID from the URL —
  `docs.google.com/spreadsheets/d/`**`1DeF...uvw`**`/edit`.

**3b. Write the script**

Go to <https://script.google.com> → **New project**. Delete what is there, paste
this in, and put your two IDs at the top:

```javascript
const FOLDER_ID = 'paste-your-drive-folder-id';
const SHEET_ID  = 'paste-your-sheet-id';

function doPost(e) {
  const text = e.postData.contents;
  const data = JSON.parse(text);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const name = 'rna-study-P' + String(data.participantId).padStart(2, '0')
             + '_' + stamp + '.json';

  // The whole session, as a file. This is the real record: a Sheet cell caps at
  // 50,000 characters and a six-scheme session is bigger than that, so storing
  // the session in a cell would silently truncate your longest ones.
  DriveApp.getFolderById(FOLDER_ID).createFile(name, text, MimeType.PLAIN_TEXT);

  // One row per participant, so you can see at a glance who has finished.
  // Columns: when, participant, map, schemes, scored trials, warm-up trials,
  //          email, file name.
  SpreadsheetApp.openById(SHEET_ID).getSheets()[0].appendRow([
    new Date(),
    data.participantId,
    data.city,
    (data.schemes || []).map(function (s) { return s.algorithm; }).join(' '),
    data.trials.length,
    (data.practiceTrials || []).length,
    data.email || '',
    name,
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**3c. Deploy it**

1. **Deploy** → **New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. *Execute as:* **Me**. *Who has access:* **Anyone**.
4. **Deploy.** Google asks you to authorise it — it is your own script writing to
   your own Drive, so approve it. (You will pass an "unverified app" warning:
   **Advanced** → **Go to … (unsafe)**. That warning is about *you* trusting
   *your own* script.)
5. Copy the **Web app URL**. It ends in `/exec`.

*"Anyone" is what lets a participant's browser post without a Google login. They
can only run `doPost`; they cannot read your folder or your sheet.*

**3d. Point the study at it**

In `evaluate/js/design.js`:

```js
submit: {
  url: 'https://script.google.com/macros/s/AKfy.../exec',
  askEmail: true,
},
```

Then push:

```bash
git add evaluate/js/design.js
git commit -m "Send results to Apps Script"
git push
```

Wait a minute for Pages to rebuild, open your study link, and run one session
through to the end as participant 1. A file should appear in the Drive folder
and a row in the Sheet. **Do this once before inviting anyone** — it is the only
part of the setup that can silently fail.

> **If the send fails** the participant sees a plain explanation, a *Try sending
> again* button, and the download opens automatically. Their answers are never
> lost. Common causes: the deployment is set to "Only myself" rather than
> "Anyone", or you copied the `/dev` URL instead of `/exec`.

### Part 4 — Lock the design before you invite anyone

The setup screen names the algorithms, and the study depends on participants not
knowing which scheme is which. In `js/design.js`:

```js
citySelection: 'fixed',
fixedCity: 'Brooklyn/Network-2',      // any map with no setup-screen warning
schemeSelection: 'fixed',
fixedSchemes: ['mucs', 'mucs_BGP', 'middfs_BucsGP_d5', 'bfs'],
trialSelection: 'fixed',
trials: { infer: 14, find: 4, navigate: 3 },
```

Push again. The whole setup box disappears, and participants go from the
background questions straight into practice.

### Part 5 — Getting your results at the end

Drive folder → select all → **Download** → a zip → unzip into
`evaluate/results/` → `python3 evaluate/aggregate.py`.

---

### Instead of Apps Script: Formspree

Simpler, and it **emails you each submission** — which is the "get it in my mail"
version. Sign up at <https://formspree.io>, make a form, copy the endpoint
(`https://formspree.io/f/abcdwxyz`) into `submit.url`. Nothing else changes; the
study detects the host and sends the right request shape.

The free tier is **50 submissions a month**, which fits 40 participants with a
little room for re-sends. Export from the dashboard as CSV; the `results` column
holds each session file.

### Instead of GitHub Pages

Any static host works. This only matters if you want something GitHub Pages
cannot do.

| Host | Free tier | Collecting results | Worth it when |
|---|---|---|---|
| **GitHub Pages** | unlimited, public repo | pair with Apps Script or Formspree | You already have the repo here. **Simplest path.** |
| **Cloudflare Pages** | unlimited bandwidth, no card | add a Worker (100k requests/day free) as your own endpoint | You want a custom domain and your own endpoint with no third party |
| **Netlify** | 100 GB/month | **Netlify Forms, 100 submissions/month** — no extra code at all | You want hosting and collection from one account |
| **Vercel** | hobby tier | a serverless function you write | You already use Vercel |
| **Firebase Hosting** | 10 GB | Firestore, written to straight from the page | You want a real database and will write security rules |
| **Surge.sh** | unlimited | none | One command: `surge ./` |

All are genuinely free at this scale — 40 participants is nothing.

### Is the email address required?

No. `submit.askEmail` puts an optional box on the last screen, purely so you can
thank someone or ask what happened if a file looks odd. Leaving it blank changes
nothing. The consent text on the first screen says exactly this, and setting
`askEmail: false` removes both the box and that sentence.

---

## Things worth knowing

**Refreshing is safe.** Progress saves to the browser as they go. If they close
the tab, they are offered "continue where I left off".

**One browser per participant.** If two people share a computer, the second
should use a private window or click "start again".

**Nothing is transmitted.** No analytics, no tracking, no network calls after
the page loads. The only data you get is the file they choose to send.

**Changing the design.** Trial counts, the success threshold, the time limits,
which network and which schemes are all at the top of `js/design.js`. Any scheme
count from 2 to 6 works with no other change — the balanced order is generated
for that size rather than looked up, so there is no table to extend. Raise
`schemeCountRange` if you want to go further, remembering that each scheme costs
about five minutes plus a longer comparison round at the end.

**Incomplete blocks are fine.** While `fixedSchemes` is `null`, each participant
sees only 4 of the 17, so no participant contributes to every column. That is an
incomplete block design, and `aggregate.py` handles it: confidence intervals come
from a cluster bootstrap over whoever saw that scheme (its `n` is printed beside
every value), and the mixed models estimate the scheme effect from the
within-person comparisons that do exist. Schemes fewer than 5 people saw are
reported but left out of the models.

---

## Files

```
evaluate/
  index.html          the study
  study.css
  js/design.js        which map, which schemes, how many trials, the warm-up
  js/scheme.js        loading a network; partitions, buckets, colours
  js/tasks.js         the three tasks
  js/study.js         screen flow, saving, export
  js/bundle.js        the index: 17 algorithms, 6 networks   (generated)
  js/cities/*.js      one network each: geometry + 17 numberings   (generated)
  build_bundle.py     regenerates both from data/ and results/
  tests/check_design.mjs   every trial rule, on every block, scheme and network
  tests/check_review.mjs   the trial review screen, against a real DOM
  tests/check_flow.mjs     the whole study end to end, and the file it sends
  tests/check_metrics.py   checks every measure against a hand-computed answer
  aggregate.py        result files -> final numbers
  requirements.txt    pandas, numpy, statsmodels, matplotlib
  results/            put the files you receive here
  output/             written by aggregate.py
```
