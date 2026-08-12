/**
 * Mood Menu recommendation engine.
 *
 * `rank()` is pure and deterministic: same input, same order out. `pick()` adds
 * the only randomness in the app, and takes an injectable rng so tests can pin it.
 *
 * The model is deliberately small and inspectable — a mood fit score, a handful
 * of tag affinities, an optional cycle-phase nutrient weighting, and hard
 * constraints for time, effort, portion and diet. If the constraints leave
 * nothing on the table we relax them one at a time rather than returning an
 * empty plate, and say which one we relaxed.
 */

import { DISHES } from "./dishes.js";

/**
 * Small nudges layered on top of the mood fit score. These break ties between
 * dishes that suit the mood equally well but differ in character — a drained
 * person and a restless person both want dinner, but not the same dinner.
 */
const MOOD_TAG_AFFINITY = {
  stressed: { meditative: 0.75, project: 0.5, quick: 0.5, warm: 0.25 },
  anxious: { gentle: 0.75, warm: 0.5, hydrating: 0.5, spicy: -0.75 },
  low: { comfort: 0.75, warm: 0.5, sweet: 0.25 },
  angry: { spicy: 0.75, crunch: 0.5, salty: 0.25, gentle: -0.5 },
  drained: { quick: 0.75, freezer: 0.75, "hands-off": 0.5, takeout: 0.5, project: -0.75 },
  foggy: { protein: 0.75, fresh: 0.5, crunch: 0.5, cold: 0.25 },
  restless: { project: 0.75, graze: 0.5, sharing: 0.5, crunch: 0.25 },
  queasy: { gentle: 1, broth: 0.75, soft: 0.5, hydrating: 0.5, rich: -1, spicy: -1 },
  cramping: { warm: 0.75, comfort: 0.5, soft: 0.5, broth: 0.5, cold: -0.5 },
  bloated: { gentle: 1, hydrating: 0.75, broth: 0.5, light: 0.5, rich: -1, salty: -0.5 },
  celebratory: { sharing: 0.75, rich: 0.5, project: 0.5 },
  lonely: { comfort: 0.75, warm: 0.5, sharing: 0.5, batch: 0.25 },
};

/**
 * Optional cycle-phase weighting over a dish's `nutrition` tags.
 *
 * This is a preference nudge, not a prescription — it reorders dishes that
 * already suit your mood rather than overriding it, and "none" is a no-op so
 * the app behaves identically for anyone who skips the question. The iron
 * weighting during menstruation is the best-supported entry here; the luteal
 * magnesium and complex-carb weighting reflects common practice rather than
 * settled evidence. See the README.
 */
const CYCLE_NUTRITION_AFFINITY = {
  none: {},
  menstrual: { iron: 1, protein: 0.5, magnesium: 0.5, omega3: 0.5 },
  follicular: { protein: 0.5, folate: 0.5, fibre: 0.5, iron: 0.25 },
  ovulation: { fibre: 0.5, folate: 0.5, protein: 0.25 },
  luteal: { magnesium: 1, complexCarbs: 0.75, calcium: 0.5, fibre: 0.25 },
};

/** Hard constraints, in the order we give them up when nothing fits. */
const RELAXATION_ORDER = [
  { key: "size", note: "ignoring whether you wanted a snack or a meal" },
  { key: "effort", note: "assuming you can manage a bit more cooking" },
  { key: "minutes", note: "stretching past the time you said you had" },
];

const DEFAULTS = {
  mood: null,
  minutes: 60,
  effort: 3,
  size: "any",
  diets: [],
  cycle: "none",
  exclude: [],
};

function affinityBonus(dish, mood) {
  const affinities = MOOD_TAG_AFFINITY[mood];
  if (!affinities) return 0;
  return dish.tags.reduce((sum, tag) => sum + (affinities[tag] ?? 0), 0);
}

function cycleBonus(dish, cycle) {
  const affinities = CYCLE_NUTRITION_AFFINITY[cycle];
  if (!affinities) return 0;
  return dish.nutrition.reduce((sum, nutrient) => sum + (affinities[nutrient] ?? 0), 0);
}

/** Diet is never relaxed — "vegan" is a constraint, not a preference. */
function satisfiesDiet(dish, diets) {
  return diets.every((diet) => dish.diet.includes(diet));
}

function violations(dish, input) {
  const failed = [];
  if (dish.minutes > input.minutes) failed.push("minutes");
  if (dish.effort > input.effort) failed.push("effort");
  if (input.size !== "any" && dish.size !== input.size) failed.push("size");
  return failed;
}

function score(dish, input) {
  const fit = dish.moods[input.mood] ?? 0;
  if (fit <= 0) return null;

  let total = fit + affinityBonus(dish, input.mood) + cycleBonus(dish, input.cycle);
  // Comfortably inside the time budget is worth a nudge: when you have twenty
  // minutes, a fifteen-minute dish is a better bet than a twenty-minute one.
  if (dish.minutes <= input.minutes / 2) total += 0.25;
  return total;
}

/**
 * The nutrients this dish carries that the chosen cycle phase weights for, so
 * the UI can explain why a dish moved up rather than just reshuffling silently.
 */
export function cycleReasons(dish, cycle) {
  const affinities = CYCLE_NUTRITION_AFFINITY[cycle] ?? {};
  return dish.nutrition.filter((nutrient) => (affinities[nutrient] ?? 0) > 0);
}

/**
 * Rank every dish that fits the request, best first.
 *
 * @param {object} request  partial input; see DEFAULTS
 * @returns {{results: Array, relaxed: string[]}} results carry {dish, score},
 *          relaxed lists human-readable notes for constraints we gave up on.
 */
export function rank(request = {}) {
  const input = { ...DEFAULTS, ...request };
  if (!input.mood) throw new Error("rank() needs a mood");

  const eligible = DISHES.filter((dish) => satisfiesDiet(dish, input.diets))
    .map((dish) => ({ dish, score: score(dish, input), failed: violations(dish, input) }))
    .filter((entry) => entry.score !== null);

  const ignored = new Set();
  const relaxed = [];
  let matches = eligible.filter((entry) => entry.failed.length === 0);

  for (const { key, note } of RELAXATION_ORDER) {
    if (matches.length > 0) break;
    ignored.add(key);
    relaxed.push(note);
    matches = eligible.filter((entry) => entry.failed.every((f) => ignored.has(f)));
  }

  // Penalise dishes that only made the cut because we relaxed something, so the
  // closest-to-asked-for option still wins within the relaxed pool.
  const results = matches
    .map((entry) => ({ dish: entry.dish, score: entry.score - entry.failed.length * 0.5 }))
    .sort((a, b) => b.score - a.score || a.dish.id.localeCompare(b.dish.id));

  return { results, relaxed };
}

/**
 * Pick one dish for the request.
 *
 * Anything within 0.75 of the top score is treated as an equally good answer and
 * chosen between at random, so pressing "something else" gives a real alternative
 * instead of walking down a fixed list. `exclude` holds recently shown ids and is
 * honoured unless it would empty the pool.
 *
 * @param {object} request  see rank()
 * @param {() => number} rng  injectable [0,1) source, for deterministic tests
 * @returns {{dish, alternatives, relaxed, nutrients} | null}
 */
export function pick(request = {}, rng = Math.random) {
  const input = { ...DEFAULTS, ...request };
  const { results, relaxed } = rank(input);
  if (results.length === 0) return null;

  const exclude = new Set(input.exclude);
  const fresh = results.filter((entry) => !exclude.has(entry.dish.id));
  const pool = fresh.length > 0 ? fresh : results;

  const contenders = pool.filter((entry) => entry.score >= pool[0].score - 0.75);
  const chosen = contenders[Math.floor(rng() * contenders.length)] ?? contenders[0];

  return {
    dish: chosen.dish,
    alternatives: pool.filter((entry) => entry.dish.id !== chosen.dish.id).slice(0, 3),
    relaxed,
    nutrients: cycleReasons(chosen.dish, input.cycle),
  };
}
