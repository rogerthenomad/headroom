# Mood Menu

A small web app that answers one question: *given how you feel right now, what should
you eat?* You pick a mood and say what you actually have — time, energy for cooking,
how hungry you are, any dietary lines you don't cross — and it names one dish, with a
sentence explaining why that dish suits that mood.

It is built for everyone. Decision fatigue at dinnertime is not particular to any one
kind of person, and neither is wanting a warm bowl of something when you feel rough.

Some of what it knows applies to some people and not others, so those parts are opt-in
rather than assumed. Cramping and bloating sit in the mood list next to stressed and
drained — anyone can have either, for any reason. The cycle question is genuinely
optional: `none` is the default, carries no weighting at all, and produces
byte-identical results to omitting the field, so the app behaves exactly the same for
anyone who isn't cycling, isn't tracking, or would simply rather not say. There is a
test pinning that equivalence.

## Running it

The app is plain HTML and ES modules, no build step and no dependencies. Because it
imports JavaScript modules, it needs to be served over HTTP rather than opened from
the filesystem:

```bash
cd examples/mood-menu
python3 -m http.server 8000
# then open http://localhost:8000
```

## Running the tests

```bash
cd examples/mood-menu
node --test
```

The tests cover the recommendation engine and validate the dish catalogue itself —
that every dish is well formed, that moods only reference real mood ids, and that
every mood has at least four dishes behind it so the answers don't get repetitive.

## How the recommendation works

`engine.js` is the whole model, and it is deliberately small enough to read.

1. **Mood fit.** Each dish scores 0–3 against each mood it suits. A dish scoring 0 for
   your mood is not a candidate at all.
2. **Tag affinity.** Small ±1 nudges break ties between dishes that fit the mood
   equally well. Queasy pushes broth and gentle up and rich and spicy down; drained
   rewards freezer food and penalises anything described as a project.
3. **Cycle weighting.** If a phase is given, dishes gain a bonus for the nutrients
   that phase weights for. This reorders dishes that *already* suit your mood — it
   never adds a dish the mood ruled out, and never filters one away.
4. **Hard constraints.** Time, effort, portion size and diet are filters, not
   preferences.
5. **Relaxation.** If the constraints leave nothing, they are dropped one at a time —
   portion first, then effort, then time — and the UI says which one it gave up on.
   Dietary constraints are never relaxed; "vegan" is not a suggestion.
6. **Choosing.** Anything within 0.75 of the top score counts as an equally good
   answer, and one is picked at random from that band. "Something else" excludes the
   last few dishes shown, so pressing it gives a real alternative.

### How solid is the cycle weighting?

Worth being straight about, since the weights are visible in `engine.js` and someone
will ask:

- **Iron during menstruation** is the best-supported entry. Iron is lost with
  menstrual bleeding, and people who menstruate have a substantially higher daily iron
  requirement as a result — this one is uncontroversial.
- **Calcium, folate and omega-3s** are weighted because intakes of all three commonly
  fall short of recommendations, not because of anything phase-specific.
- **Luteal magnesium and slow carbs** reflect common dietary practice for PMS
  symptoms. The evidence there is mixed and mostly from small trials — treat it as a
  reasonable nudge, not a finding.

Nothing here is a clinical tool. Persistent fatigue, heavy bleeding, or severe pain
are worth a doctor's time, not a dinner suggestion.

`rank()` is pure and deterministic — the same request always produces the same ordered
list. All the randomness lives in `pick()`, which takes an injectable rng so the tests
can pin it.

## Design

The page carries The AI Cowboys brand system: a dark-mode navy ground with pink, teal
and gold accents. Dark is the primary expression, so `:root` holds the dark palette and
the light variant is the override — the mirror of the usual pattern, applied
consistently across all three viewer states (system default, explicit light, explicit
dark) so a stamped `data-theme` and a bare `prefers-color-scheme` both resolve
correctly.

Accent roles are fixed so colour carries meaning rather than decoration:

| Token       | Role                                              |
| ----------- | ------------------------------------------------- |
| `--accent`  | pink — action and current selection                |
| `--info`    | teal — the reasoning behind a pick (why, nutrients) |
| `--advisory`| gold — optional and advisory notes                 |

**The hex values are derived, not official.** They come from the brand system described
in the RODEO visual-direction reference (dark mode navy, pink, teal, gold); the exact
corporate hexes weren't reachable from this environment. Swap the token values at the
top of `index.html` for the real ones and everything else follows — nothing outside the
`:root` blocks names a colour directly. The same goes for typography: the brand's type
system isn't specified here, so the page uses a system sans stack.

Layout is responsive without a framework: a single column capped at `46rem`, option
chips on an auto-fitting grid that lands four across on desktop and two on phones, and
a `44px` minimum on every tap target.

## Files

| File              | What it is                                                 |
| ----------------- | ---------------------------------------------------------- |
| `index.html`      | The UI — form, result card, styling, light and dark themes  |
| `dishes.js`       | Mood, diet, cycle-phase and dish catalogue; the data the engine reasons over |
| `engine.js`       | Scoring, filtering, relaxation and selection                |
| `engine.test.mjs` | Tests for the engine and the catalogue                      |

## Adding a dish

Append an entry to `DISHES` in `dishes.js` following the shape documented at the top
of that file, then run `node --test`. The catalogue tests will tell you if the mood
ids, diet tags, or required copy are wrong.

Two things worth honouring when you write one: keep `why` specific to the mood rather
than generic food praise, and be honest in `minutes` and `effort` — a recommendation
that lies about being quick is worse than no recommendation.

## Scope

These are suggestions, not nutrition or medical advice. The app deliberately says
nothing about calories, weight, or "earning" food.
