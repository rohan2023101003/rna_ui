#!/usr/bin/env python3
"""Turn the participants' result files into the study's final numbers.

    pip install -r evaluate/requirements.txt
    python3 evaluate/aggregate.py

Reads every `rna-study-P**.json` in `evaluate/results/` and produces:

  * a results table printed to the terminal, with 95% confidence intervals
  * `output/trials.csv`   one row per trial, for any further analysis
  * `output/summary.csv`  the results table as a spreadsheet
  * `output/models.txt`   mixed-effects model output for the key measures
  * `output/figures/*.png` one chart per measure

Two kinds of statistics are reported, because they answer different questions:

  Confidence intervals come from a **cluster bootstrap over participants** -
  resampling whole people, not individual trials, because one person's trials
  are related to each other.

  **Mixed-effects models** then test whether the differences between schemes are
  larger than the differences between people. "Mixed" means the model handles
  both at once: the effect we care about (which scheme) and the nuisance
  variation (some people are simply better at this, some roads are harder).
"""

from __future__ import annotations

import json
import os
import sys
import warnings
from collections import defaultdict

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

try:
    import statsmodels.formula.api as smf
    HAVE_STATSMODELS = True
except ImportError:
    HAVE_STATSMODELS = False

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAVE_PLOTS = True
except ImportError:
    HAVE_PLOTS = False

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_DIR = os.path.join(ROOT, "evaluate", "results")
OUT_DIR = os.path.join(ROOT, "evaluate", "output")
FIG_DIR = os.path.join(OUT_DIR, "figures")

BOOTSTRAP = 4000
RNG = np.random.default_rng(12345)

# Scheme names come from the same decoder the interface uses, so a result file
# naming any of the 17 algorithm outputs is understood without a list to keep in
# step. Participants saw them only as "Scheme A" ... "Scheme D"; the mapping back
# is in each result file, and in the `algorithm` field of every trial.
sys.path.insert(0, ROOT)
try:
    from rna import algorithms as _algorithms
    SCHEME_NAMES = {}
    SCHEME_ORDER = []
    _results = os.path.join(ROOT, "results")

    def _short(stem: str) -> str:
        """A name that fits a table column: "MIDDFS+GP+B+UCS k=5"."""
        info = _algorithms.parse(stem)
        short = {"GP": "GP", "B": "B", "ucs": "UCS"}
        name = "+".join([info["family_label"]]
                        + [short[m] for m in info["modifiers"]])
        return name + (f" k={info['depth']}" if info["depth"] is not None else "")

    for _city in sorted(os.listdir(_results)) if os.path.isdir(_results) else []:
        for _net in sorted(os.listdir(os.path.join(_results, _city))):
            for _f in os.listdir(os.path.join(_results, _city, _net)):
                if _f.endswith(".csv"):
                    SCHEME_NAMES.setdefault(_f[:-4], _short(_f[:-4]))
    SCHEME_ORDER = sorted(SCHEME_NAMES, key=_algorithms.sort_key)
except Exception:                                  # results/ not next to us
    SCHEME_NAMES, SCHEME_ORDER = {}, []

# Not every participant sees every scheme: each draws 4 of the 17, so the design
# is an incomplete block design. The bootstrap and the mixed models cope with
# that - they never assume a participant contributed to every column - but a
# scheme seen by only a handful of people cannot support a confidence interval,
# so it is reported with its n and left out of the models.
MIN_PARTICIPANTS_PER_SCHEME = 5

# Which scheme the models compare everything else against, most preferred
# first. These are the unmodified traversals - no partitioning, no bucketing,
# no cost ordering - so a coefficient reads as what the pipeline added.
REFERENCE_PREFERENCE = ["bfs", "dfs", "mdfs", "mucs", "middfs_d5"]

MIN_PLAUSIBLE_MS = 400
INFER_SUCCESS_TOLERANCE = 0.10   # fixed in advance, not chosen after the fact


# --------------------------------------------------------------------------
# Load
# --------------------------------------------------------------------------

def load_sessions():
    sessions, problems = [], []
    if not os.path.isdir(RESULTS_DIR):
        return sessions, [f"no results directory at {RESULTS_DIR}"]

    for name in sorted(os.listdir(RESULTS_DIR)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(RESULTS_DIR, name), encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as exc:
            problems.append(f"{name}: unreadable ({exc})")
            continue
        pid = data.get("participantId")
        expected = expected_trials(data)
        if not pid:
            problems.append(f"{name}: no participant number")
        elif not data.get("finishedAt"):
            problems.append(f"{name}: P{pid} did not finish - excluded")
        elif len(data.get("trials", [])) < expected:
            problems.append(f"{name}: P{pid} has {len(data['trials'])} trials, "
                            f"expected {expected} - excluded")
        else:
            data["_file"] = name
            sessions.append(data)

    seen = {}
    for s in sessions:
        pid = s["participantId"]
        if pid in seen:
            problems.append(f"P{pid} submitted twice ({seen[pid]}, {s['_file']})")
        seen[pid] = s["_file"]
    return sessions, problems


def expected_trials(session) -> int:
    """How many scored trials this session should contain.

    The trial counts are a setting, not a constant - the setup screen can put
    any number behind each task - so "did this person finish?" has to be asked
    against what *their* session was configured to do. A fixed threshold would
    throw away every short session as if it were abandoned.
    """
    counts = session.get("trialCounts") or {}
    per_scheme = sum(int(counts.get(task, 0) or 0)
                     for task in ("infer", "find", "navigate"))
    schemes = len(session.get("schemes") or []) or len(
        {t.get("algorithm") for t in session.get("trials", []) if t.get("algorithm")})
    if not per_scheme or not schemes:
        return 1          # nothing to check against: accept any finished session
    return per_scheme * schemes


def quality_flags(session):
    flags, trials = [], session["trials"]
    rushed = [t for t in trials if (t.get("ms") or 0) < MIN_PLAUSIBLE_MS]
    if len(rushed) > 0.15 * len(trials):
        flags.append(f"{len(rushed)}/{len(trials)} answers under {MIN_PLAUSIBLE_MS} ms")
    infer = [t for t in trials if t["task"] == "infer"]
    if infer and len({t["guess"] for t in infer}) <= 2:
        flags.append("typed nearly the same number every time")

    # Time spent with the tab in the background inflates every duration, and in
    # an unsupervised online study it happens. Reported rather than silently
    # corrected, so the decision about what to do with it is yours.
    away = [t for t in trials if (t.get("hiddenMs") or 0) > 2000]
    if away:
        total = sum(t.get("hiddenMs") or 0 for t in away) / 1000
        flags.append(f"{len(away)} trial(s) with the tab in the background "
                     f"({total:.0f}s in total) - their times are inflated")

    # The study records the shortest route it offered; if the participant beat
    # it, the graph and the task disagree and the deviation figures are wrong.
    impossible = [t for t in trials
                  if t.get("task") == "navigate" and t.get("arrived")
                  and t.get("bestPath") and t.get("moves") is not None
                  and t["moves"] < len(t["bestPath"]) - 1]
    if impossible:
        flags.append(f"{len(impossible)} journey(s) shorter than the shortest "
                     "possible route - route deviation cannot be trusted")
    return flags


def to_frame(sessions, field="trials") -> pd.DataFrame:
    """One row per trial - the tidy table everything else is computed from.

    `field` selects which list to read: the scored `trials`, or the warm-up in
    `practiceTrials`. The two share a shape but are never mixed - practice is
    on a different network under a fixed scheme, so pooling them would be
    comparing across maps.
    """
    rows = []
    for s in sessions:
        bg = s.get("background", {})
        fam = bg.get("familiarity", {})
        for t in s.get(field) or []:
            rows.append({
                "participant": s["participantId"],
                "phase": t.get("phase", "scored" if field == "trials" else "practice"),
                "chosen_city": s.get("city"),
                "age": bg.get("age") or "",
                "map_use": bg.get("mapUse") or "",
                # Trials record the network ("Hyderabad/Network-2"); the
                # familiarity question was asked about the city.
                "familiarity": fam.get(str(t.get("city", "")).split("/")[0]),
                "block": t.get("blockIndex"),
                "algorithm": t.get("algorithm"),
                "city": t.get("city"),
                "task": t.get("task"),
                "trial_index": t.get("trialIndex"),
                "ms": t.get("ms"),
                "seconds": (t.get("ms") or 0) / 1000,
                # pans/zooms are *gestures*: one drag, one scroll burst. The
                # raw event counts are carried alongside so the coalescing can
                # be checked, or undone, without re-running anything.
                "pans": t.get("pans"), "zooms": t.get("zooms"),
                "pan_events": t.get("panEvents"), "zoom_events": t.get("zoomEvents"),
                "tool_presses": t.get("toolPresses"),
                "clicks": t.get("clicks"), "empty_clicks": t.get("emptyClicks"),
                "hovers": t.get("hovers"),
                # Milliseconds this trial spent with the browser tab in the
                # background. Elapsed time keeps running when someone switches
                # tab, so a trial with a large value here is not a slow one.
                "hidden_ms": t.get("hiddenMs"),
                "effort": sum(t.get(k) or 0 for k in
                              ("pans", "zooms", "toolPresses", "clicks", "hovers")),
                "panzoom": (t.get("pans") or 0) + (t.get("zooms") or 0)
                           + (t.get("toolPresses") or 0),
                "road_id": t.get("roadId"),
                "actual": t.get("actual"), "guess": t.get("guess"),
                "error_abs": t.get("errorAbs"), "error_norm": t.get("errorNorm"),
                "parity_match": t.get("parityMatch"),
                "number_range": t.get("numberRange"),
                "found": t.get("found"), "gave_up": t.get("gaveUp"),
                "wrong_clicks": t.get("wrongClicks"),
                "arrived": t.get("arrived"), "moves": t.get("moves"),
                "shortest_hops": t.get("shortestHops"),
                "route_deviation": t.get("routeDeviation"),
                "wayfinding_errors": t.get("wayfindingErrors"),
                "backtracks": t.get("backtracks"),
                # The shortest route that existed, recorded by the study so
                # route deviation can be checked rather than taken on trust.
                "best_moves": (len(t["bestPath"]) - 1) if t.get("bestPath") else None,
                "correct": t.get("correct"),
                "answer": t.get("answer"), "correct_answer": t.get("correctAnswer"),
            })
    df = pd.DataFrame(rows)
    if not df.empty:
        # A missing error is missing, not a failure: `NaN <= tolerance` is False
        # in numpy, which would quietly score an unrecorded trial as wrong.
        within = df["error_norm"] <= INFER_SUCCESS_TOLERANCE
        df["infer_success"] = np.where(
            (df["task"] == "infer") & df["error_norm"].notna(),
            within.astype(float), np.nan)
    return df


# --------------------------------------------------------------------------
# Measures
# --------------------------------------------------------------------------

# key, label, how to compute one value per participant per scheme, direction
MEASURES = [
    ("parity_agreement", "Parity agreement (odd/even)", "pct", "high",
     lambda d: d[d.task == "infer"].groupby(GROUP)["parity_match"].mean()),
    ("infer_error", "Inference error (normalised)", "num3", "low",
     lambda d: d[d.task == "infer"].groupby(GROUP)["error_norm"].mean()),
    ("infer_success", "Inference success rate", "pct", "high",
     lambda d: d[d.task == "infer"].groupby(GROUP)["infer_success"].mean()),
    ("infer_time", "Time per guess (s)", "num1", "low",
     lambda d: d[d.task == "infer"].groupby(GROUP)["seconds"].median()),
    ("find_success", "Find-the-road success", "pct", "high",
     lambda d: d[d.task == "find"].groupby(GROUP)["found"].mean()),
    ("find_time", "Time to find a road (s)", "num1", "low",
     lambda d: d[(d.task == "find") & (d.found == True)].groupby(GROUP)["seconds"].median()),
    ("find_gaveup", "Gave up finding", "pct", "low",
     lambda d: d[d.task == "find"].groupby(GROUP)["gave_up"].mean()),
    ("find_wrong", "Wrong clicks while finding", "num2", "low",
     lambda d: d[d.task == "find"].groupby(GROUP)["wrong_clicks"].mean()),
    ("find_panzoom", "Pans + zooms while finding", "num1", "low",
     lambda d: d[d.task == "find"].groupby(GROUP)["panzoom"].mean()),
    ("find_effort", "Interaction effort (find)", "num1", "low",
     lambda d: d[d.task == "find"].groupby(GROUP)["effort"].mean()),
    ("nav_success", "Journey completion", "pct", "high",
     lambda d: d[d.task == "navigate"].groupby(GROUP)["arrived"].mean()),
    ("route_deviation", "Route deviation", "num2", "low",
     lambda d: d[d.task == "navigate"].groupby(GROUP)["route_deviation"].median()),
    ("wayfinding_errors", "Wayfinding errors per journey", "num2", "low",
     lambda d: d[d.task == "navigate"].groupby(GROUP)["wayfinding_errors"].mean()),
    ("backtracks", "Backtracks per journey", "num2", "low",
     lambda d: d[d.task == "navigate"].groupby(GROUP)["backtracks"].mean()),
]

GROUP = ["participant", "algorithm"]


def learning_gain(df: pd.DataFrame) -> pd.Series:
    """Proportional drop in error from the first third of a block to the last.

    Positive means people are picking the scheme up as they go; near zero means
    there is no rule there to learn.
    """
    out = {}
    infer = df[df.task == "infer"].sort_values("trial_index")
    for (pid, algo), group in infer.groupby(GROUP):
        errors = group["error_norm"].dropna().to_numpy()
        if len(errors) < 6:
            continue
        cut = max(3, len(errors) // 3)
        early, late = errors[:cut].mean(), errors[-cut:].mean()
        if early > 0:
            out[(pid, algo)] = (early - late) / early
    return pd.Series(out)


def tlx_frame(sessions) -> pd.DataFrame:
    rows = []
    for s in sessions:
        for e in s.get("tlx", []):
            rows.append({"participant": s["participantId"], "algorithm": e["algorithm"],
                         "city": e.get("city"), "raw_tlx": e["rawTlx"],
                         "mental": e["mental"], "frustration": e["frustration"],
                         "effort_rating": e["effort"]})
    return pd.DataFrame(rows)


def bootstrap_ci(values: np.ndarray, statistic=np.mean, rounds=BOOTSTRAP):
    """95% interval, resampling whole participants."""
    values = np.asarray([v for v in values if v is not None and not pd.isna(v)], dtype=float)
    if len(values) < 3:
        return (np.nan, np.nan)
    draws = statistic(RNG.choice(values, size=(rounds, len(values)), replace=True), axis=1)
    return (float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5)))


def fmt(value, kind):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "-"
    if kind == "pct":
        return f"{value * 100:.1f}%"
    if kind == "num1":
        return f"{value:.1f}"
    if kind == "num2":
        return f"{value:.2f}"
    return f"{value:.3f}"


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------

MODEL_SPECS = [
    ("parity_match", "infer", "binomial",
     "Does the scheme change how often people get odd/even right?"),
    ("error_norm", "infer", "gaussian",
     "Does the scheme change how far off people's guesses are?"),
    ("seconds", "find", "gaussian",
     "Does the scheme change how long it takes to find a road?"),
]


def fit_models(df: pd.DataFrame, lines: list[str]):
    """Mixed-effects models with participant as a random effect.

    Each participant sees 4 of the 17 schemes, so no participant contributes to
    every column. That is an incomplete block design, and it is exactly what a
    model with a participant random effect is for: the scheme effect is
    estimated from the within-person comparisons that do exist, pooled across
    everyone, rather than by comparing raw column means.

    The reference level is the plainest scheme present, preferring the paper's
    own reference baselines, so every coefficient reads as "how much better or
    worse than plain traversal is this scheme".
    """
    if not HAVE_STATSMODELS:
        lines.append("statsmodels is not installed - skipping the models.")
        lines.append("Install it with:  pip install -r evaluate/requirements.txt")
        return

    for column, task, family, question in MODEL_SPECS:
        subset = df[(df.task == task)].dropna(subset=[column, "algorithm"]).copy()
        # Schemes only a couple of people saw cannot be separated from those
        # people, so they are dropped from the model rather than reported as a
        # difference that is really an individual.
        seen = subset.groupby("algorithm")["participant"].nunique()
        subset = subset[subset["algorithm"].isin(
            seen[seen >= MIN_PARTICIPANTS_PER_SCHEME].index)].copy()
        if subset["algorithm"].nunique() < 2 or subset["participant"].nunique() < 5:
            continue
        subset[column] = subset[column].astype(float)
        levels = [a for a in SCHEME_ORDER if a in set(subset["algorithm"])]
        for candidate in REFERENCE_PREFERENCE:
            if candidate in levels:
                levels = [candidate] + [a for a in levels if a != candidate]
                break
        subset["algorithm"] = pd.Categorical(subset["algorithm"], categories=levels)

        lines.append("")
        lines.append("=" * 74)
        lines.append(f"{question}")
        lines.append(f"  {column} ~ algorithm + (1 | participant)     [{task} trials, "
                     f"n={len(subset)}, {subset['algorithm'].nunique()} schemes, "
                     f"{subset['participant'].nunique()} participants]")
        lines.append(f"  reference level: {SCHEME_NAMES.get(levels[0], levels[0])}")
        lines.append("=" * 74)
        try:
            # statsmodels resets the warning filters on import, and a model with
            # this many levels routinely reports a boundary fit. Those belong in
            # the log next to the model they came from, not scrolling past the
            # results table.
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                model = smf.mixedlm(f"{column} ~ algorithm", subset,
                                    groups=subset["participant"]).fit(reml=False)
            if family == "binomial":
                lines.append("(linear probability model - the coefficient is the change")
                lines.append(f" in probability relative to {levels[0]})")
            lines.append(str(model.summary()))
            for warning in {str(w.message) for w in caught}:
                lines.append(f"  note: {warning}")
        except Exception as exc:
            lines.append(f"  model did not converge: {exc}")


# --------------------------------------------------------------------------
# Charts
# --------------------------------------------------------------------------

def draw_charts(table: pd.DataFrame, algorithms: list[str]):
    if not HAVE_PLOTS or table.empty:
        return []
    os.makedirs(FIG_DIR, exist_ok=True)
    written = []
    # One colour per algorithm family, so a chart of a dozen schemes still
    # reads as "the MUCS ones" against "the MIDDFS ones" at a glance.
    family_colours = {"mucs": "#2f5fd0", "middfs": "#4cae9b", "mdfs": "#8a6bbf",
                      "mbfs": "#c46aa8", "bfs": "#e07a2f", "dfs": "#c2553a",
                      "random": "#9aa4b0"}

    def colour_for(key: str) -> str:
        family = key.split("_")[0]
        return family_colours.get(family, "#8896a4")
    for key in table["measure"].unique():
        rows = table[table.measure == key]
        if rows["value"].isna().all():
            continue
        fig, ax = plt.subplots(figsize=(6.4, 3.6))
        names = [SCHEME_NAMES.get(a, a) for a in rows["algorithm"]]
        values = rows["value"].to_numpy(dtype=float)
        lo = values - rows["ci_low"].to_numpy(dtype=float)
        hi = rows["ci_high"].to_numpy(dtype=float) - values
        ax.bar(names, values, color=[colour_for(a) for a in rows["algorithm"]],
               yerr=[np.nan_to_num(lo), np.nan_to_num(hi)], capsize=5)
        ax.set_title(rows["label"].iloc[0], fontsize=11)
        ax.spines[["top", "right"]].set_visible(False)
        ax.tick_params(axis="x", labelsize=8, rotation=12)
        fig.tight_layout()
        path = os.path.join(FIG_DIR, f"{key}.png")
        fig.savefig(path, dpi=140)
        plt.close(fig)
        written.append(path)
    return written


# --------------------------------------------------------------------------
# Preference ranking
# --------------------------------------------------------------------------

def bradley_terry(comparisons, rounds=500):
    """Rank schemes from pairwise wins, on a scale where 1.0 is average.

    Counting wins alone would reward a scheme that happened to be compared
    against weak opponents. Bradley-Terry instead fits each scheme a strength
    such that the chance of i beating j is s_i / (s_i + s_j), so beating a
    strong scheme counts for more than beating a weak one. That matters here
    because each participant sees only some of the schemes, so different
    schemes meet different opponents.

    Fitted by the standard MM iteration, rescaled each round so the strengths
    average 1.0 (the scale is arbitrary - only the ratios mean anything).
    """
    items = sorted({a for pair in comparisons for a in pair})
    wins = defaultdict(int)
    played = defaultdict(int)
    for winner, loser in comparisons:
        wins[winner] += 1
        played[(winner, loser)] += 1
        played[(loser, winner)] += 1

    strength = {i: 1.0 for i in items}
    for _ in range(rounds):
        updated = {}
        for i in items:
            denominator = sum(played[(i, j)] / (strength[i] + strength[j])
                              for j in items if j != i and played[(i, j)])
            updated[i] = wins[i] / denominator if denominator > 0 and wins[i] else 1e-9
        total = sum(updated.values())
        strength = {k: v * len(items) / total for k, v in updated.items()}
    return strength


# --------------------------------------------------------------------------
# The results table
# --------------------------------------------------------------------------

def best_algorithm(rows: pd.DataFrame):
    values = rows.set_index("algorithm")["value"]
    if values.isna().all():
        return None
    return values.idxmax() if rows["better"].iloc[0] == "high" else values.idxmin()


def print_results(table: pd.DataFrame, algorithms: list[str]):
    """Print the headline table, laid out for however many schemes there are.

    Four schemes fit across a terminal as columns. Seventeen do not - the names
    would have to be cut to a few characters each, which is how a table stops
    being readable - so past a handful the layout flips and each measure gets
    its own short block with the schemes down the side.
    """
    print("\n" + "-" * 78)
    print("  RESULTS BY SCHEME     value  [95% confidence interval]")
    print("-" * 78)

    if len(algorithms) <= 5:
        width = 32
        print("  " + "Measure".ljust(width) + "".join(
            SCHEME_NAMES.get(a, a)[:20].rjust(23) for a in algorithms))
        print("  " + "-" * (width + 23 * len(algorithms)))
        for key in table["measure"].unique():
            rows = table[table.measure == key]
            kind = rows["kind"].iloc[0]
            best = best_algorithm(rows)
            cells, cis = [], []
            for algo in algorithms:
                r = rows[rows.algorithm == algo].iloc[0]
                mark = "*" if algo == best else " "
                cells.append((fmt(r["value"], kind) + mark).rjust(23))
                cis.append((f"[{fmt(r['ci_low'], kind)}, {fmt(r['ci_high'], kind)}]"
                            if not np.isnan(r["ci_low"]) else "").rjust(23))
            print("  " + rows["label"].iloc[0].ljust(width) + "".join(cells))
            print("  " + "".ljust(width) + "".join(cis))
        print("\n  * marks the best value in that row.")
        return

    for key in table["measure"].unique():
        rows = table[table.measure == key]
        if rows["value"].isna().all():
            continue
        kind = rows["kind"].iloc[0]
        best = best_algorithm(rows)
        direction = "higher is better" if rows["better"].iloc[0] == "high" \
            else "lower is better"
        print(f"\n  {rows['label'].iloc[0]}   ({direction})")
        ordered = rows.sort_values("value", ascending=rows["better"].iloc[0] == "low")
        for _, r in ordered.iterrows():
            if np.isnan(r["value"]):
                continue
            ci = (f"[{fmt(r['ci_low'], kind)}, {fmt(r['ci_high'], kind)}]"
                  if not np.isnan(r["ci_low"]) else "")
            mark = "*" if r["algorithm"] == best else " "
            name = SCHEME_NAMES.get(r["algorithm"], r["algorithm"])
            print(f"    {mark} {name[:30].ljust(32)}{fmt(r['value'], kind).rjust(9)}"
                  f"  {ci.ljust(20)} n={int(r['n'])}")
    print("\n  * marks the best value for that measure. n is how many participants")
    print("    saw that scheme - each one sees only some of them, so n varies.")


# --------------------------------------------------------------------------

def main() -> int:
    sessions, problems = load_sessions()

    print("\n" + "=" * 78)
    print("  ROAD NUMBERING STUDY - RESULTS")
    print("=" * 78)

    if problems:
        print("\n  Files that could not be used:")
        for p in problems:
            print(f"    - {p}")

    if not sessions:
        print(f"\n  No usable sessions. Put the participants' .json files in")
        print(f"  {RESULTS_DIR} and run this again.\n")
        return 1

    df = to_frame(sessions)
    practice = to_frame(sessions, "practiceTrials")
    ids = sorted(s["participantId"] for s in sessions)
    print(f"\n  {len(sessions)} complete sessions: participants "
          f"{', '.join(str(i) for i in ids)}")
    print(f"  {len(df)} scored trials in total")
    if not practice.empty:
        print(f"  {len(practice)} warm-up trials, kept separately and not "
              "analysed here")

    flagged = [(s["participantId"], quality_flags(s)) for s in sessions]
    flagged = [(p, f) for p, f in flagged if f]
    if flagged:
        print("\n  Worth checking before you trust these:")
        for pid, notes in flagged:
            print(f"    P{pid}: {'; '.join(notes)}")

    if len(sessions) < 10:
        print(f"\n  ** Only {len(sessions)} participants - intervals will be very wide.")
        print("     Do not report these as findings yet. **")

    algorithms = [a for a in SCHEME_ORDER if a in set(df["algorithm"])]

    # -- headline table ----------------------------------------------------
    records = []
    per_participant = {}
    for key, label, kind, better, compute in MEASURES:
        series = compute(df)
        per_participant[key] = series
        for algo in algorithms:
            values = series.xs(algo, level="algorithm").to_numpy(dtype=float) \
                if algo in series.index.get_level_values("algorithm") else np.array([])
            value = float(np.nanmean(values)) if len(values) else np.nan
            lo, hi = bootstrap_ci(values)
            records.append({"measure": key, "label": label, "kind": kind,
                            "better": better, "algorithm": algo, "value": value,
                            "ci_low": lo, "ci_high": hi, "n": len(values)})

    gains = learning_gain(df)
    for algo in algorithms:
        values = np.array([v for (p, a), v in gains.items() if a == algo], dtype=float)
        lo, hi = bootstrap_ci(values)
        records.append({"measure": "learning_gain", "label": "Learning gain",
                        "kind": "pct", "better": "high", "algorithm": algo,
                        "value": float(np.nanmean(values)) if len(values) else np.nan,
                        "ci_low": lo, "ci_high": hi, "n": len(values)})

    tlx = tlx_frame(sessions)
    if not tlx.empty:
        for column, label in [("raw_tlx", "NASA-TLX workload"),
                              ("mental", "  ...mental demand"),
                              ("frustration", "  ...frustration")]:
            for algo in algorithms:
                values = tlx[tlx.algorithm == algo][column].to_numpy(dtype=float)
                lo, hi = bootstrap_ci(values)
                records.append({"measure": column, "label": label, "kind": "num1",
                                "better": "low", "algorithm": algo,
                                "value": float(np.nanmean(values)) if len(values) else np.nan,
                                "ci_low": lo, "ci_high": hi, "n": len(values)})

    table = pd.DataFrame(records)

    print_results(table, algorithms)

    # -- preference --------------------------------------------------------
    comparisons = []
    for s in sessions:
        for pref in s.get("preference", []):
            if pref.get("chose"):
                winner = pref["chose"]
                loser = (pref["rightAlgorithm"] if winner == pref["leftAlgorithm"]
                         else pref["leftAlgorithm"])
                comparisons.append((winner, loser))
    if comparisons:
        strength = bradley_terry(comparisons)
        wins = defaultdict(int)
        for w, _ in comparisons:
            wins[w] += 1
        print("\n" + "-" * 78)
        print("  WHICH SCHEME PEOPLE PREFERRED    (Bradley-Terry, 1.0 = average)")
        print("-" * 78)
        for algo, score in sorted(strength.items(), key=lambda kv: -kv[1]):
            plays = sum(1 for w, l in comparisons if algo in (w, l))
            print(f"  {SCHEME_NAMES.get(algo, algo)[:28].ljust(30)} {score:5.2f}"
                  f"   {wins[algo]:3d}/{plays:3d} wins  {'#' * int(min(38, score * 13))}")

    # -- context -----------------------------------------------------------
    ctx = [(e["city"], e["matchesHome"], e["couldBeReal"])
           for s in sessions for e in s.get("context", [])]
    if ctx:
        cdf = pd.DataFrame(ctx, columns=["city", "matches_home", "could_be_real"])
        print("\n" + "-" * 78)
        print("  CONTEXTUAL APPROPRIATENESS   (1-7, higher is better)")
        print("-" * 78)
        for city, g in cdf.groupby("city"):
            print(f"  {city.ljust(16)} matches home: {g['matches_home'].mean():.2f}"
                  f"    could be real: {g['could_be_real'].mean():.2f}   (n={len(g)})")

    # -- files -------------------------------------------------------------
    os.makedirs(OUT_DIR, exist_ok=True)
    df.to_csv(os.path.join(OUT_DIR, "trials.csv"), index=False)
    if not practice.empty:
        practice.to_csv(os.path.join(OUT_DIR, "practice.csv"), index=False)
    table.to_csv(os.path.join(OUT_DIR, "summary.csv"), index=False)

    lines = ["MIXED-EFFECTS MODELS", "=" * 74, "",
             "Each model asks whether the differences between schemes are bigger",
             "than the differences between people. Each participant saw only some",
             "of the schemes, so the scheme effect is estimated from the",
             "within-person comparisons that exist, pooled across everyone.",
             "The reference level is named above each model; a coefficient is the",
             "change relative to it, and P>|z| below 0.05 is the usual threshold",
             "for calling a difference real.", ""]
    fit_models(df, lines)
    with open(os.path.join(OUT_DIR, "models.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))

    figures = draw_charts(table, algorithms)

    print("\n" + "-" * 78)
    print(f"  Wrote {OUT_DIR}/trials.csv    ({len(df)} rows, one per scored trial)")
    if not practice.empty:
        print(f"  Wrote {OUT_DIR}/practice.csv  ({len(practice)} rows, the warm-up)")
    print(f"  Wrote {OUT_DIR}/summary.csv   (the table above)")
    print(f"  Wrote {OUT_DIR}/models.txt    (mixed-effects models)")
    if figures:
        print(f"  Wrote {len(figures)} charts to {FIG_DIR}/")
    if not HAVE_STATSMODELS:
        print("\n  statsmodels is missing, so no models were fitted.")
        print("  pip install -r evaluate/requirements.txt")
    print("=" * 78 + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
