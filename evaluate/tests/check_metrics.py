#!/usr/bin/env python3
"""Check every reported measure against a hand-computed answer.

    python3 evaluate/tests/check_metrics.py

`aggregate.py` turns a pile of result files into the numbers that go in the
paper. This builds sessions whose correct answer is known by construction -
"this person got exactly 3 of 4 finds" - and asserts the pipeline reproduces it.

The second half is the question that matters once trial counts are
configurable: **does the same behaviour produce the same number whether it was
measured over 3 trials or 30?** Every measure here is a per-trial mean, a
proportion or a median, so it must - and the test proves it rather than
asserting it.
"""

from __future__ import annotations

import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "evaluate"))

import aggregate as agg

FAILURES = []


def check(name, got, want, tol=1e-9):
    ok = (got is None and want is None) or (
        got is not None and want is not None and abs(float(got) - float(want)) <= tol)
    print(f"  {'ok  ' if ok else 'FAIL'}  {name:<46} got {got!r:>22}  want {want!r}")
    if not ok:
        FAILURES.append(name)


# --------------------------------------------------------------------------
# Session builders
# --------------------------------------------------------------------------

def infer_trial(i, algo, actual, guess, rng=100, ms=5000, **kw):
    error = abs(guess - actual)
    return {"key": f"b0:infer:{i}", "trialIndex": i, "blockIndex": 0,
            "algorithm": algo, "scheme": "Scheme A", "city": "Brooklyn/Network-1",
            "task": "infer", "roadId": i + 1, "actual": actual, "guess": guess,
            "errorAbs": error, "errorNorm": error / rng,
            "parityMatch": (guess % 2) == (actual % 2), "numberRange": rng,
            "ms": ms, "pans": 1, "zooms": 1, "clicks": 0, "hovers": 0, **kw}


def find_trial(i, algo, found, ms=20000, wrong=0, **kw):
    return {"key": f"b0:find:{i}", "trialIndex": i, "blockIndex": 0,
            "algorithm": algo, "scheme": "Scheme A", "city": "Brooklyn/Network-1",
            "task": "find", "roadId": i + 1, "target": 10 + i,
            "found": found, "gaveUp": not found, "wrongClicks": wrong,
            "timedOut": False, "ms": ms,
            "pans": 2, "zooms": 3, "clicks": 1, "hovers": 4, **kw}


def nav_trial(i, algo, arrived, moves, shortest, errors=0, backtracks=0, ms=30000):
    return {"key": f"b0:navigate:{i}", "trialIndex": i, "blockIndex": 0,
            "algorithm": algo, "scheme": "Scheme A", "city": "Brooklyn/Network-1",
            "task": "navigate", "from": 1, "to": 9, "targetNumber": 20 + i,
            "arrived": arrived, "moves": moves, "shortestHops": shortest,
            "routeDeviation": (moves / shortest) if arrived else None,
            "wayfindingErrors": errors, "backtracks": backtracks,
            "ms": ms, "pans": 3, "zooms": 2, "clicks": moves, "hovers": 5}


def session(pid, trials, tlx=None, counts=None, schemes=None, preference=None,
            practice=None):
    return {
        "version": 2, "participantId": pid,
        "startedAt": "2026-09-11T09:00:00Z", "finishedAt": "2026-09-11T09:30:00Z",
        "city": "Brooklyn/Network-1",
        "schemes": schemes or [{"label": "Scheme A", "algorithm": "mucs"}],
        "trialCounts": counts or {"infer": 0, "find": 0, "navigate": 0, "practice": 0},
        "background": {"age": "25-34", "mapUse": "Every day",
                       "familiarity": {"Brooklyn": 3}},
        "trials": trials, "practiceTrials": practice or [],
        "tlx": tlx or [], "preference": preference or [],
        "context": [],
        "userAgent": "test", "screen": None, "_file": f"P{pid}.json",
    }


def measure(df, key):
    """One measure's value for the single participant/scheme in `df`."""
    for measure_key, _label, _kind, _better, compute in agg.MEASURES:
        if measure_key == key:
            series = compute(df)
            return float(series.iloc[0]) if len(series) else None
    raise KeyError(key)


# --------------------------------------------------------------------------
print("\nOne participant, one scheme, every measure hand-computed")
print("-" * 96)

# Guesses:   actual  guess   |error|  norm    parity
#              50     50        0     0.00    same (even/even)  -> success
#              50     55        5     0.05    differ            -> success
#              50     70       20     0.20    same              -> miss
#              51     40       11     0.11    differ            -> miss
trials = [
    infer_trial(0, "mucs", 50, 50, ms=4000),
    infer_trial(1, "mucs", 50, 55, ms=6000),
    infer_trial(2, "mucs", 50, 70, ms=8000),
    infer_trial(3, "mucs", 51, 40, ms=10000),
    # 3 of 4 found; times count only where found: 10s, 20s, 30s -> median 20
    find_trial(0, "mucs", True, ms=10000, wrong=0),
    find_trial(1, "mucs", True, ms=20000, wrong=2),
    find_trial(2, "mucs", True, ms=30000, wrong=4),
    find_trial(3, "mucs", False, ms=120000, wrong=6),
    # 2 of 3 arrived; deviations 6/4 = 1.5 and 5/5 = 1.0 -> median 1.25
    nav_trial(0, "mucs", True, 6, 4, errors=2, backtracks=1),
    nav_trial(1, "mucs", True, 5, 5, errors=0, backtracks=0),
    nav_trial(2, "mucs", False, 3, 4, errors=4, backtracks=2),
]
df = agg.to_frame([session(1, trials)])

check("parity agreement           2 of 4", measure(df, "parity_agreement"), 0.5)
check("inference error   mean(0,.05,.2,.11)", measure(df, "infer_error"), 0.09)
check("inference success  2 of 4 within 10%", measure(df, "infer_success"), 0.5)
check("time per guess     median(4,6,8,10)s", measure(df, "infer_time"), 7.0)
check("find success               3 of 4", measure(df, "find_success"), 0.75)
check("find time    median of found only", measure(df, "find_time"), 20.0)
check("gave up finding            1 of 4", measure(df, "find_gaveup"), 0.25)
check("wrong clicks  mean(0,2,4,6)", measure(df, "find_wrong"), 3.0)
check("pans+zooms while finding   2+3", measure(df, "find_panzoom"), 5.0)
check("interaction effort   2+3+1+4", measure(df, "find_effort"), 10.0)
check("journey completion         2 of 3", measure(df, "nav_success"), 2 / 3)
check("route deviation   median(1.5,1.0)", measure(df, "route_deviation"), 1.25)
check("wayfinding errors  mean(2,0,4)", measure(df, "wayfinding_errors"), 2.0)
check("backtracks         mean(1,0,2)", measure(df, "backtracks"), 1.0)

# --------------------------------------------------------------------------
print("\nLearning gain: error halves from the first third to the last")
print("-" * 96)

# 9 guesses, thirds of 3. Early errors .30 .30 .30 -> 0.30
#                        Late  errors .10 .10 .10 -> 0.10   gain = 2/3
errs = [30, 30, 30, 20, 20, 20, 10, 10, 10]
learn = [infer_trial(i, "mucs", 50, 50 + e) for i, e in enumerate(errs)]
gains = agg.learning_gain(agg.to_frame([session(2, learn)]))
check("learning gain  (0.30-0.10)/0.30", gains.iloc[0], 2 / 3)

flat = [infer_trial(i, "mucs", 50, 70) for i in range(9)]
check("learning gain, no learning at all",
      agg.learning_gain(agg.to_frame([session(3, flat)])).iloc[0], 0.0)

short = [infer_trial(i, "mucs", 50, 70) for i in range(5)]
check("learning gain below 6 guesses -> not reported",
      len(agg.learning_gain(agg.to_frame([session(4, short)]))), 0)

# --------------------------------------------------------------------------
print("\nTrial counts: the same behaviour must give the same number")
print("-" * 96)

def rates(n_infer, n_find, n_nav):
    """A participant who is right 50% / 75% / 50% of the time, whatever n."""
    out = []
    for i in range(n_infer):                       # half the guesses exact
        out.append(infer_trial(i, "mucs", 50, 50 if i % 2 == 0 else 70,
                               ms=4000 + 2000 * (i % 2)))
    for i in range(n_find):                        # 3 in 4 found, 2 wrong clicks
        out.append(find_trial(i, "mucs", i % 4 != 3, ms=20000, wrong=2))
    for i in range(n_nav):                         # half arrive, deviation 1.5
        out.append(nav_trial(i, "mucs", i % 2 == 0, 6, 4, errors=1, backtracks=1))
    return out

small = agg.to_frame([session(5, rates(4, 4, 4))])
large = agg.to_frame([session(6, rates(40, 20, 12))])
for key, _label, _kind, _better, _fn in agg.MEASURES:
    a, b = measure(small, key), measure(large, key)
    check(f"{key:<20} 4 trials vs 40", a, b, tol=1e-9)

# --------------------------------------------------------------------------
print("\nInteraction counters")
print("-" * 96)

# One search with every counter set to a distinct value, so a field being
# dropped or added to the wrong total cannot pass unnoticed.
counted = find_trial(0, "mucs", True, ms=15000, wrong=1)
counted.update({"pans": 2, "zooms": 3, "panEvents": 180, "zoomEvents": 24,
                "toolPresses": 4, "clicks": 5, "emptyClicks": 6, "hovers": 7,
                "hiddenMs": 8000})
row = agg.to_frame([session(10, [counted])]).iloc[0]

check("pans are gestures, not events", row["pans"], 2)
check("...and the raw event count is kept", row["pan_events"], 180)
check("zooms are gestures, not events", row["zooms"], 3)
check("...and the raw event count is kept", row["zoom_events"], 24)
check("tool presses recorded", row["tool_presses"], 4)
check("road clicks recorded", row["clicks"], 5)
check("clicks on blank map kept apart", row["empty_clicks"], 6)
check("hovers recorded", row["hovers"], 7)
check("background time recorded", row["hidden_ms"], 8000)
check("pans+zooms = 2+3+4 tool presses", row["panzoom"], 9)
check("effort = 2+3+4+5+7 (not hovers-only)", row["effort"], 21)

# A journey records the route that was available, so deviation can be checked.
journey = nav_trial(0, "mucs", True, 6, 4)
journey["bestPath"] = [1, 5, 9, 12, 20]          # 4 steps
check("shortest route recovered from the recorded path",
      agg.to_frame([session(11, [journey])]).iloc[0]["best_moves"], 4)

# Quality flags for the two things that silently corrupt timings and routes.
away = session(12, [dict(t, hiddenMs=9000) for t in trials])
check("a session with background time is flagged",
      1.0 if any("background" in f for f in agg.quality_flags(away)) else 0.0, 1.0)

cheated = nav_trial(0, "mucs", True, 2, 4)       # 2 moves, shortest was 4
cheated["bestPath"] = [1, 5, 9, 12, 20]
check("a journey shorter than the shortest route is flagged",
      1.0 if any("shortest" in f for f in
                 agg.quality_flags(session(13, [cheated]))) else 0.0, 1.0)

# --------------------------------------------------------------------------
print("\nThe warm-up is recorded, and kept out of the scored data")
print("-" * 96)

warm = [dict(infer_trial(0, "mucs_BGP", 50, 60), phase="practice",
             city="Hyderabad/Network-1"),
        dict(find_trial(0, "mucs_BGP", True), phase="practice",
             city="Hyderabad/Network-1"),
        dict(nav_trial(0, "mucs_BGP", True, 5, 4), phase="practice",
             city="Hyderabad/Network-1")]
both = session(14, trials, practice=warm)

scored = agg.to_frame([both])
warmed = agg.to_frame([both], "practiceTrials")
check("scored trials exclude the warm-up", len(scored), len(trials))
check("the warm-up is read from its own list", len(warmed), 3)
check("every warm-up trial is labelled practice",
      1.0 if set(warmed["phase"]) == {"practice"} else 0.0, 1.0)
check("every scored trial is labelled scored",
      1.0 if set(scored["phase"]) == {"scored"} else 0.0, 1.0)
check("all three tasks are kept from the warm-up",
      1.0 if set(warmed["task"]) == {"infer", "find", "navigate"} else 0.0, 1.0)
check("the warm-up keeps its own network",
      1.0 if set(warmed["city"]) == {"Hyderabad/Network-1"} else 0.0, 1.0)
check("the warm-up does not count towards completeness",
      agg.expected_trials(both), 1)

# --------------------------------------------------------------------------
print("\nQuestionnaires and the preference ranking")
print("-" * 96)

# Raw TLX: performance is reversed before averaging, per the standard scoring.
tlx = [{"blockIndex": 0, "algorithm": "mucs", "scheme": "Scheme A",
        "city": "Brooklyn/Network-1", "mental": 60, "physical": 20, "temporal": 40,
        "performance": 80, "effort": 50, "frustration": 30,
        "rawTlx": (60 + 20 + 40 + (100 - 80) + 50 + 30) / 6}]
frame = agg.tlx_frame([session(7, trials, tlx=tlx)])
check("raw TLX  (60+20+40+20+50+30)/6", frame["raw_tlx"].iloc[0], 220 / 6)

# Bradley-Terry: A beats B every time, B beats C every time.
prefs = ([{"leftAlgorithm": "mucs", "rightAlgorithm": "bfs", "chose": "mucs", "ms": 1}] * 6
         + [{"leftAlgorithm": "bfs", "rightAlgorithm": "dfs", "chose": "bfs", "ms": 1}] * 6)
strength = agg.bradley_terry([(p["chose"],
                               p["rightAlgorithm"] if p["chose"] == p["leftAlgorithm"]
                               else p["leftAlgorithm"]) for p in prefs])
ordered = sorted(strength, key=lambda k: -strength[k])
check("Bradley-Terry ranks A > B > C",
      1.0 if ordered == ["mucs", "bfs", "dfs"] else 0.0, 1.0)

# --------------------------------------------------------------------------
print("\nCompleteness check adapts to the session's own trial counts")
print("-" * 96)

short_session = session(8, rates(2, 1, 1),
                        counts={"infer": 2, "find": 1, "navigate": 1, "practice": 0})
check("a 4-trial session is complete when it says so",
      agg.expected_trials(short_session), 4)
check("...and is not excluded",
      1.0 if len(short_session["trials"]) >= agg.expected_trials(short_session) else 0.0, 1.0)
missing = session(9, rates(2, 1, 0),
                  counts={"infer": 2, "find": 1, "navigate": 1, "practice": 0})
check("a session missing a journey is excluded",
      1.0 if len(missing["trials"]) < agg.expected_trials(missing) else 0.0, 1.0)

# --------------------------------------------------------------------------
print("\n" + "=" * 96)
if FAILURES:
    print(f"  {len(FAILURES)} FAILED: {', '.join(FAILURES)}")
else:
    print("  every measure matches its hand-computed value")
print("=" * 96 + "\n")
sys.exit(1 if FAILURES else 0)
