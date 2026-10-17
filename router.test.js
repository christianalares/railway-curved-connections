const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
require("./viz-global.js");
const {routeConnections, pathFor} = require("./router.js");

test("bundled Viz.js exposes its API even if CommonJS globals exist", async () => {
  const context = {
    exports: {}, module: {exports: {}}, WebAssembly, TextDecoder, TextEncoder, URL,
    document: {currentScript: null, baseURI: "https://railway.com/project/example"},
    location: {href: "https://railway.com/project/example"},
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("./viz-global.js"), "utf8"), context);
  assert.equal(typeof context.Viz?.instance, "function");
  const renderer = await context.Viz.instance();
  assert.ok(renderer.engines.includes("nop1"));
});

test("the injected bundle loads and routes in one content-script context", async () => {
  const context = {
    exports: {}, module: {exports: {}}, WebAssembly, TextDecoder, TextEncoder, URL,
    document: {
      currentScript: null, baseURI: "https://railway.com/project/example",
      documentElement: {}, querySelector: () => null,
    },
    location: {href: "https://railway.com/project/example"},
    window: {addEventListener() {}},
    MutationObserver: class {observe() {} disconnect() {}},
    chrome: {storage: {
      local: {get(_defaults, callback) {callback({enabled: false});}},
      onChanged: {addListener() {}},
    }},
    console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("./content-bundle.js"), "utf8"), context);
  const rectangles = [
    {id: "a", left: 0, top: 0, right: 100, bottom: 80},
    {id: "b", left: 260, top: 0, right: 360, bottom: 80},
  ];
  const routes = await context.RailwayCurvedRouter.routeConnections(
    [{id: "edge", source: "a", target: "b"}], rectangles);
  assert.ok(routes.get("edge")?.startsWith("M "));
});

function pointsOn(path) {
  const numbers = [...path.matchAll(/[-+]?\d*\.?\d+/g)].map((match) => Number(match[0]));
  const samples = [];
  let start = {x: numbers[0], y: numbers[1]};
  for (let offset = 2; offset < numbers.length; offset += 6) {
    const a = {x: numbers[offset], y: numbers[offset + 1]};
    const b = {x: numbers[offset + 2], y: numbers[offset + 3]};
    const end = {x: numbers[offset + 4], y: numbers[offset + 5]};
    for (let step = 0; step <= 48; step++) {
      const t = step / 48;
      const u = 1 - t;
      samples.push({
        x: u ** 3 * start.x + 3 * u ** 2 * t * a.x + 3 * u * t ** 2 * b.x + t ** 3 * end.x,
        y: u ** 3 * start.y + 3 * u ** 2 * t * a.y + 3 * u * t ** 2 * b.y + t ** 3 * end.y,
      });
    }
    start = end;
  }
  return samples;
}

test("Graphviz bends around a card without moving the cards", async () => {
  const rectangles = [
    {id: "source", left: 0, top: 0, right: 100, bottom: 80},
    {id: "blocker", left: 25, top: 130, right: 125, bottom: 210},
    {id: "target", left: 0, top: 260, right: 100, bottom: 340},
  ];
  const routes = await routeConnections([{id: "a", source: "source", target: "target"}], rectangles);
  const path = routes.get("a");
  assert.ok(path);
  assert.match(path, /^M .* C /);
  assert.ok(pointsOn(path).every(({x, y}) => x <= 25 || x >= 125 || y <= 130 || y >= 210));
  assert.ok(pointsOn(path).some(({x}) => x < 25));
});

test("two incoming arrows land at distinct points on one card", async () => {
  const rectangles = [
    {id: "upper", left: 0, top: 0, right: 100, bottom: 80},
    {id: "lower", left: 0, top: 150, right: 100, bottom: 230},
    {id: "target", left: 300, top: 70, right: 400, bottom: 210},
  ];
  const routes = await routeConnections([
    {id: "a", source: "upper", target: "target"},
    {id: "b", source: "lower", target: "target"},
  ], rectangles);
  assert.equal(routes.size, 2);
  const ends = [...routes.values()].map((path) => pointsOn(path).at(-1));
  assert.ok(ends.every((point) => Math.abs(point.x - 300) < 2));
  assert.ok(Math.abs(ends[0].y - ends[1].y) > 15);
});

test("clear diagonal connections leave and enter cards perpendicularly", async () => {
  const rectangles = [
    {id: "source", left: 0, top: 250, right: 100, bottom: 330},
    {id: "target", left: 260, top: 0, right: 360, bottom: 80},
  ];
  const routes = await routeConnections([{id: "elastic", source: "source", target: "target"}], rectangles);
  const path = routes.get("elastic");
  const values = [...path.matchAll(/[-+]?\d*\.?\d+/g)].map((match) => Number(match[0]));
  assert.equal(values.length, 8, "one cubic curve is used in open space");
  assert.equal(values[1], 250, "curve and dot share the source card border");
  assert.ok(Math.abs(values[0] - values[2]) < 0.01, "source tangent is vertical");
  assert.ok(Math.abs(values[4] - values[6]) < 0.01, "target tangent is vertical");
  assert.ok(values[3] < values[1] && values[5] > values[7]);
});

test("source ports avoid rounded card corners", () => {
  const rectangles = [
    {id: "source", left: 0, top: 0, right: 100, bottom: 80},
    {id: "target", left: 260, top: 80, right: 360, bottom: 160},
  ];
  const edge = {_draw_: [{op: "b", points: [[5, -4], [30, -30], [150, -100], [260, -120]]}]};
  const path = pathFor(edge, rectangles, {source: "source", target: "target"});
  assert.ok(path?.startsWith("M 18 0 "));
});

test("stays with Railway paths while cards overlap during a drag", async () => {
  const rectangles = [
    {id: "a", left: 0, top: 0, right: 100, bottom: 80},
    {id: "b", left: 70, top: 20, right: 170, bottom: 100},
  ];
  const routes = await routeConnections([{id: "ab", source: "a", target: "b"}], rectangles);
  assert.equal(routes.size, 0);
});

test("routes between service cards inside project group frames", async () => {
  const rectangles = [
    {id: "group", left: 0, top: 0, right: 600, bottom: 360},
    {id: "source", left: 30, top: 70, right: 230, bottom: 190},
    {id: "target", left: 360, top: 70, right: 560, bottom: 190},
  ];
  const routes = await routeConnections([{id: "edge", source: "source", target: "target"}], rectangles);
  assert.ok(routes.get("edge")?.startsWith("M "));
});

test("keeps card positions when neighboring services share a border", async () => {
  const rectangles = [
    {id: "group", left: 0, top: 0, right: 800, bottom: 460},
    {id: "source", left: 30, top: 220, right: 290, bottom: 380},
    {id: "neighbor", left: 290, top: 240, right: 550, bottom: 400},
    {id: "target", left: 300, top: 30, right: 560, bottom: 190},
  ];
  const connections = [
    {id: "up", source: "neighbor", target: "target"},
    {id: "left", source: "source", target: "target"},
  ];
  const routes = await routeConnections(connections, rectangles);
  assert.equal(routes.size, 2);
});
