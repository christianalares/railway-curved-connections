(() => {
  "use strict";

  // Viz.js bundles Graphviz. The nop1 engine preserves Railway's node positions.
  let vizPromise;
  const round = (value) => Number(value.toFixed(2));

  function renderer() {
    if (!vizPromise) vizPromise = globalThis.Viz.instance();
    return vizPromise;
  }

  function graphFor(connections, rectangles) {
    const ids = new Map(rectangles.map((rect, index) => [rect.id, `n${index}`]));
    return {
      directed: true,
      graphAttributes: {
        splines: "true",
        overlap: "true",
        inputscale: 72,
        notranslate: "true",
        pad: 0,
        margin: 0,
      },
      nodeAttributes: {shape: "box", label: "", fixedsize: "true", pin: "true"},
      nodes: rectangles.map((rect) => ({
        name: ids.get(rect.id),
        attributes: {
          width: (rect.right - rect.left) / 72,
          height: (rect.bottom - rect.top) / 72,
          pos: `${(rect.left + rect.right) / 2},${-(rect.top + rect.bottom) / 2}!`,
        },
      })),
      edges: connections.map((edge, index) => ids.has(edge.source) && ids.has(edge.target) ? {
        tail: ids.get(edge.source),
        head: ids.get(edge.target),
        attributes: {id: `e${index}`, arrowhead: "none"},
      } : null).filter(Boolean),
    };
  }

  function curvePoint(a, b, c, d, t) {
    const u = 1 - t;
    return {
      x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
      y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y,
    };
  }

  function outward(point, rect) {
    const sides = [
      [Math.abs(point.x - rect.left), {x: -1, y: 0}],
      [Math.abs(point.x - rect.right), {x: 1, y: 0}],
      [Math.abs(point.y - rect.top), {x: 0, y: -1}],
      [Math.abs(point.y - rect.bottom), {x: 0, y: 1}],
    ];
    sides.sort((a, b) => a[0] - b[0]);
    return sides[0][1];
  }

  function snapSourcePort(point, rect) {
    if (!rect) return point;
    const margin = 18;
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const sides = [
      [Math.abs(point.x - rect.left), {x: rect.left, y: clamp(point.y, rect.top + margin, rect.bottom - margin)}],
      [Math.abs(point.x - rect.right), {x: rect.right, y: clamp(point.y, rect.top + margin, rect.bottom - margin)}],
      [Math.abs(point.y - rect.top), {x: clamp(point.x, rect.left + margin, rect.right - margin), y: rect.top}],
      [Math.abs(point.y - rect.bottom), {x: clamp(point.x, rect.left + margin, rect.right - margin), y: rect.bottom}],
    ];
    sides.sort((a, b) => a[0] - b[0]);
    return sides[0][1];
  }

  function elasticPath(points, rectangles, connection) {
    const source = rectangles.find((rect) => rect.id === connection.source);
    const target = rectangles.find((rect) => rect.id === connection.target);
    if (!source || !target) return null;
    const start = points[0];
    const end = points.at(-1);
    const from = outward(start, source);
    const into = outward(end, target);
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    let handle = Math.min(110, distance * 0.38);
    if (from.y && into.y) handle = Math.min(handle, Math.abs(end.y - start.y) * 0.43);
    if (from.x && into.x) handle = Math.min(handle, Math.abs(end.x - start.x) * 0.43);
    if (handle < 16) return null;
    const c1 = {x: start.x + from.x * handle, y: start.y + from.y * handle};
    const c2 = {x: end.x + into.x * handle, y: end.y + into.y * handle};
    for (let step = 1; step < 48; step++) {
      const point = curvePoint(start, c1, c2, end, step / 48);
      if (rectangles.some((rect) => point.x > rect.left + 1 && point.x < rect.right - 1 &&
        point.y > rect.top + 1 && point.y < rect.bottom - 1)) return null;
    }
    return `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)},` +
      ` ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`;
  }

  function pathFor(edge, rectangles, connection) {
    const spline = edge._draw_?.find((item) => item.op === "b")?.points;
    if (!spline || spline.length < 4 || (spline.length - 1) % 3) return null;
    const points = spline.map(([x, y]) => ({x, y: -y}));
    const source = rectangles.find((rect) => rect.id === connection.source);
    const snapped = snapSourcePort(points[0], source);
    const delta = {x: snapped.x - points[0].x, y: snapped.y - points[0].y};
    points[0] = snapped;
    points[1] = {x: points[1].x + delta.x, y: points[1].y + delta.y};
    let path = `M ${round(points[0].x)} ${round(points[0].y)}`;
    for (let index = 1; index < points.length; index += 3) {
      const controls = points.slice(index, index + 3);
      if (controls.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
      for (let step = 1; step <= 24; step++) {
        const point = curvePoint(points[index - 1], ...controls, step / 24);
        if (rectangles.some((rect) => rect.id !== connection.source && rect.id !== connection.target &&
          point.x > rect.left + 1 && point.x < rect.right - 1 &&
          point.y > rect.top + 1 && point.y < rect.bottom - 1)) return null;
      }
      path += ` C ${round(controls[0].x)} ${round(controls[0].y)},` +
        ` ${round(controls[1].x)} ${round(controls[1].y)},` +
        ` ${round(controls[2].x)} ${round(controls[2].y)}`;
    }
    return elasticPath(points, rectangles, connection) || path;
  }

  async function routeConnections(connections, rectangles) {
    const routes = new Map();
    if (!connections.length || !rectangles.length) return routes;
    const endpoints = new Set(connections.flatMap((edge) => [edge.source, edge.target]));
    // Railway renders service groups as large React Flow nodes around smaller nodes.
    // They are visual containers, not obstacles for connections inside them.
    const cards = rectangles.filter((rect) => endpoints.has(rect.id) || !rectangles.some((other) =>
      other !== rect && other.left >= rect.left + 4 && other.right <= rect.right - 4 &&
      other.top >= rect.top + 4 && other.bottom <= rect.bottom - 4));
    // Keep the native lines during a drag that puts two service cards on top of each other.
    if (cards.some((a, index) => cards.slice(index + 1).some((b) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 8 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 8))) return routes;
    const viz = await renderer();
    const result = viz.render(graphFor(connections, cards), {engine: "nop1", format: "json"});
    if (result.status !== "success") return routes;
    const layout = JSON.parse(result.output);

    // Never apply routes based on card positions different from Railway's canvas.
    const moved = layout.objects?.some((node) => {
      const rect = cards[Number(node.name.slice(1))];
      if (!rect) return true;
      const [x, y] = node.pos.split(",").map(Number);
      return Math.abs(x - (rect.left + rect.right) / 2) > 2 ||
        Math.abs(y + (rect.top + rect.bottom) / 2) > 2;
    });
    if (moved) return routes;

    for (const edge of layout.edges || []) {
      const connection = connections[Number(edge.id?.slice(1))];
      if (!connection) continue;
      const path = pathFor(edge, cards, connection);
      if (path) routes.set(connection.id, path);
    }
    return routes;
  }

  const api = {routeConnections, graphFor, pathFor};
  globalThis.RailwayCurvedRouter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
