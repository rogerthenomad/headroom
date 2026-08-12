import assert from "node:assert/strict";
import test from "node:test";

import { CYCLE_PHASES, DISHES, DIETS, MOODS } from "./dishes.js";
import { cycleReasons, pick, rank } from "./engine.js";

const moodIds = new Set(MOODS.map((m) => m.id));
const dietIds = new Set(DIETS.map((d) => d.id));
const NUTRIENTS = new Set([
  "iron",
  "protein",
  "magnesium",
  "calcium",
  "folate",
  "fibre",
  "omega3",
  "complexCarbs",
]);

test("every dish is well formed", () => {
  const seen = new Set();
  for (const dish of DISHES) {
    assert.ok(!seen.has(dish.id), `duplicate dish id: ${dish.id}`);
    seen.add(dish.id);
    assert.ok(dish.name && dish.blurb && dish.why, `${dish.id} is missing copy`);
    assert.ok(dish.minutes > 0, `${dish.id} has a nonsense time`);
    assert.ok(dish.effort >= 0 && dish.effort <= 3, `${dish.id} has a bad effort level`);
    assert.ok(["snack", "meal"].includes(dish.size), `${dish.id} has a bad size`);
    for (const mood of Object.keys(dish.moods)) {
      assert.ok(moodIds.has(mood), `${dish.id} scores unknown mood ${mood}`);
    }
    for (const diet of dish.diet) {
      assert.ok(dietIds.has(diet), `${dish.id} claims unknown diet ${diet}`);
    }
    assert.ok(Array.isArray(dish.nutrition), `${dish.id} is missing a nutrition list`);
    for (const nutrient of dish.nutrition) {
      assert.ok(NUTRIENTS.has(nutrient), `${dish.id} claims unknown nutrient ${nutrient}`);
    }
    // Vegan implies vegetarian; both imply nothing about gluten, so only this one.
    if (dish.diet.includes("vegan")) {
      assert.ok(dish.diet.includes("vegetarian"), `${dish.id} is vegan but not vegetarian`);
    }
  }
});

test("every mood has enough dishes to feel like a choice", () => {
  for (const mood of MOODS) {
    const { results } = rank({ mood: mood.id, minutes: 90, effort: 3 });
    assert.ok(results.length >= 4, `${mood.id} only has ${results.length} dishes`);
  }
});

test("hard constraints are respected when something fits", () => {
  const { results, relaxed } = rank({ mood: "drained", minutes: 15, effort: 1, size: "meal" });
  assert.equal(relaxed.length, 0);
  assert.ok(results.length > 0);
  for (const { dish } of results) {
    assert.ok(dish.minutes <= 15);
    assert.ok(dish.effort <= 1);
    assert.equal(dish.size, "meal");
  }
});

test("dietary constraints are never relaxed", () => {
  // A tight budget plus vegan forces relaxation, but the diet must still hold.
  const { results, relaxed } = rank({
    mood: "celebratory",
    minutes: 3,
    effort: 0,
    size: "meal",
    diets: ["vegan", "glutenFree"],
  });
  assert.ok(relaxed.length > 0, "expected this request to need relaxing");
  assert.ok(results.length > 0);
  for (const { dish } of results) {
    assert.ok(dish.diet.includes("vegan"));
    assert.ok(dish.diet.includes("glutenFree"));
  }
});

test("constraints are relaxed in order, and reported", () => {
  // Nothing at all is ready in one minute, so all three constraints have to go.
  const { results, relaxed } = rank({ mood: "celebratory", minutes: 1, effort: 0, size: "meal" });
  assert.ok(results.length > 0);
  assert.deepEqual(relaxed, [
    "ignoring whether you wanted a snack or a meal",
    "assuming you can manage a bit more cooking",
    "stretching past the time you said you had",
  ]);
});

test("only dishes that suit the mood are offered", () => {
  const { results } = rank({ mood: "queasy", minutes: 90, effort: 3 });
  for (const { dish } of results) {
    assert.ok((dish.moods.queasy ?? 0) > 0, `${dish.id} does not serve queasy`);
  }
  // Rich and spicy dishes are penalised hard enough to stay off the podium.
  const top = results.slice(0, 3).map((r) => r.dish.id);
  assert.ok(!top.includes("dan-dan"), "spicy noodles should not top the queasy list");
});

test("skipping the cycle question changes nothing", () => {
  const request = { mood: "low", minutes: 90, effort: 3 };
  const withoutField = rank(request).results.map((r) => [r.dish.id, r.score]);
  const explicitNone = rank({ ...request, cycle: "none" }).results.map((r) => [r.dish.id, r.score]);
  assert.deepEqual(withoutField, explicitNone);
});

test("cycle phase reorders without overriding mood", () => {
  const request = { mood: "drained", minutes: 90, effort: 3 };
  const neutral = rank(request).results;
  const period = rank({ ...request, cycle: "menstrual" }).results;

  // Same candidate set — the phase is a preference, not a filter.
  assert.deepEqual(
    neutral.map((r) => r.dish.id).sort(),
    period.map((r) => r.dish.id).sort(),
  );
  // ...but it does move iron up the list.
  const ironRank = (results) => results.findIndex((r) => r.dish.nutrition.includes("iron"));
  assert.ok(ironRank(period) <= ironRank(neutral), "menstrual phase should favour iron");
  assert.ok(period.every((r) => (r.dish.moods.drained ?? 0) > 0), "mood fit still gates entry");
});

test("every cycle phase is a known key with sane weighting", () => {
  const ironDish = DISHES.find((d) => d.id === "steak-frites");
  for (const phase of CYCLE_PHASES) {
    const { results } = rank({ mood: "drained", minutes: 90, effort: 3, cycle: phase.id });
    assert.ok(results.length > 0, `${phase.id} produced nothing`);
    for (const { score } of results) {
      assert.ok(Number.isFinite(score), `${phase.id} produced a non-finite score`);
    }
  }
  assert.deepEqual(cycleReasons(ironDish, "none"), []);
  assert.deepEqual(cycleReasons(ironDish, "menstrual").sort(), ["iron", "protein"]);
});

test("pick surfaces the nutrients behind a cycle-weighted choice", () => {
  const result = pick(
    { mood: "drained", minutes: 90, effort: 3, cycle: "menstrual" },
    () => 0,
  );
  assert.ok(result.nutrients.length > 0, "expected an explanation for the top pick");
  for (const nutrient of result.nutrients) {
    assert.ok(result.dish.nutrition.includes(nutrient));
  }
});

test("mood changes the answer", () => {
  const request = { minutes: 90, effort: 3 };
  const angry = rank({ ...request, mood: "angry" }).results[0].dish.id;
  const queasy = rank({ ...request, mood: "queasy" }).results[0].dish.id;
  assert.notEqual(angry, queasy);
});

test("ranking is deterministic and ordered by score", () => {
  const request = { mood: "low", minutes: 45, effort: 2 };
  const first = rank(request).results;
  const second = rank(request).results;
  assert.deepEqual(
    first.map((r) => r.dish.id),
    second.map((r) => r.dish.id),
  );
  for (let i = 1; i < first.length; i += 1) {
    assert.ok(first[i - 1].score >= first[i].score, "results are out of order");
  }
});

test("pick honours the exclude list", () => {
  const request = { mood: "low", minutes: 90, effort: 3 };
  const exclude = rank(request)
    .results.slice(0, 3)
    .map((r) => r.dish.id);
  for (let i = 0; i < 20; i += 1) {
    const { dish } = pick({ ...request, exclude }, () => i / 20);
    assert.ok(!exclude.includes(dish.id), `${dish.id} was excluded but came back`);
  }
});

test("pick falls back to the full pool rather than returning nothing", () => {
  const request = { mood: "low", minutes: 90, effort: 3 };
  const everything = rank(request).results.map((r) => r.dish.id);
  const result = pick({ ...request, exclude: everything }, () => 0);
  assert.ok(result, "expected a dish even with everything excluded");
  assert.ok(everything.includes(result.dish.id));
});

test("pick varies its answer across calls", () => {
  const request = { mood: "restless", minutes: 90, effort: 3 };
  const picks = new Set();
  for (let i = 0; i < 10; i += 1) {
    picks.add(pick(request, () => i / 10).dish.id);
  }
  assert.ok(picks.size > 1, "the same dish came back for every rng value");
});

test("pick returns null when diet rules out everything", () => {
  const impossible = { mood: "low", minutes: 90, effort: 3, diets: ["nonexistent"] };
  assert.equal(pick(impossible), null);
});

test("rank refuses a request with no mood", () => {
  assert.throws(() => rank({}), /needs a mood/);
});
