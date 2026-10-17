(() => {
  "use strict";

  const router = globalThis.RailwayCurvedRouter;
  const originalPaths = new WeakMap();
  const modifiedPaths = new Set();
  const startDots = new Map();
  let enabled = true;
  let canvas = null;
  let canvasObserver = null;
  let dotLayer = null;
  let scheduled = false;
  let rendering = false;
  let dirty = false;

  function remember(path) {
    if (!path) return;
    const current = path.getAttribute("d");
    const record = originalPaths.get(path);
    if (!record) {
      originalPaths.set(path, {
        original: current,
        applied: null,
        start: graphPoint(path, false),
        end: graphPoint(path, true),
      });
    } else if (current !== record.applied && current !== record.original) {
      // React Flow has redrawn the edge. Preserve that new native route for the off switch.
      record.original = current;
      record.applied = null;
      record.start = graphPoint(path, false);
      record.end = graphPoint(path, true);
    }
  }

  function setPath(path, route) {
    if (!path) return;
    remember(path);
    if (path.getAttribute("d") !== route) path.setAttribute("d", route);
    originalPaths.get(path).applied = route;
    modifiedPaths.add(path);
  }

  function restorePath(path) {
    const record = originalPaths.get(path);
    if (!record) return;
    if (record.original && path.getAttribute("d") !== record.original) {
      path.setAttribute("d", record.original);
    }
    record.applied = null;
    modifiedPaths.delete(path);
  }

  function restoreAll() {
    for (const path of [...modifiedPaths]) restorePath(path);
    dotLayer?.remove();
    dotLayer = null;
    startDots.clear();
  }

  function graphPoint(path, atEnd) {
    const length = path.getTotalLength();
    const point = path.getPointAtLength(atEnd ? length : 0);
    return {x: point.x, y: point.y};
  }

  function ensureDotLayer() {
    const viewport = canvas?.querySelector(".react-flow__viewport");
    if (!viewport) return null;
    if (dotLayer?.parentElement === viewport) return dotLayer;
    dotLayer?.remove();
    startDots.clear();
    dotLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    dotLayer.setAttribute("data-railway-curved-dot-layer", "");
    dotLayer.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:1000";
    viewport.append(dotLayer);
    return dotLayer;
  }

  function updateStartDot(edge) {
    const layer = ensureDotLayer();
    if (!layer) return;
    const point = graphPoint(edge.visible, false);
    let dot = startDots.get(edge.element);
    if (!dot) {
      dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("data-railway-curved-start", "");
      dot.setAttribute("aria-hidden", "true");
      dot.setAttribute("r", "4");
      layer.append(dot);
      startDots.set(edge.element, dot);
    }
    const stroke = getComputedStyle(edge.visible).stroke;
    const fill = stroke && stroke !== "none" ? stroke : "#8b879e";
    const x = String(Math.round(point.x * 100) / 100);
    const y = String(Math.round(point.y * 100) / 100);
    if (dot.getAttribute("fill") !== fill) dot.setAttribute("fill", fill);
    if (dot.getAttribute("cx") !== x) dot.setAttribute("cx", x);
    if (dot.getAttribute("cy") !== y) dot.setAttribute("cy", y);
  }

  function getGeometry() {
    const viewport = canvas?.querySelector(".react-flow__viewport");
    if (!viewport) return null;
    const viewportRect = viewport.getBoundingClientRect();
    const scale = Number(/scale\(([^)]+)\)/.exec(viewport.style.transform)?.[1]) || 1;
    const rectangles = [...canvas.querySelectorAll(".react-flow__node[data-id]")].map((node) => {
      const bounds = node.getBoundingClientRect();
      const left = (bounds.left - viewportRect.left) / scale;
      const top = (bounds.top - viewportRect.top) / scale;
      return {
        id: node.getAttribute("data-id"),
        left,
        top,
        right: left + bounds.width / scale,
        bottom: top + bounds.height / scale,
      };
    });

    const edges = [...canvas.querySelectorAll(".react-flow__edge-reference")].map((edge) => {
      const label = edge.getAttribute("aria-label") || "";
      const match = /^Edge from (\S+) to (\S+)$/.exec(label);
      const visible = edge.querySelector(".react-flow__edge-path");
      const hit = [...edge.querySelectorAll("path")].find((path) => path !== visible);
      if (!match || !visible) return null;
      try {
        remember(visible);
        remember(hit);
        return {
          element: edge,
          id: edge.getAttribute("data-testid") || label,
          source: match[1],
          target: match[2],
          start: originalPaths.get(visible).start,
          end: originalPaths.get(visible).end,
          visible,
          hit,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
    return {rectangles, edges};
  }

  async function render() {
    scheduled = false;
    if (!enabled || !canvas?.isConnected) return;
    rendering = true;
    const geometry = getGeometry();
    try {
      if (!geometry) return;
      const routes = await router.routeConnections(geometry.edges, geometry.rectangles);
      if (!enabled || !canvas?.isConnected || dirty) return;
      const currentEdges = new Set();
      for (const edge of geometry.edges) {
        currentEdges.add(edge.element);
        const path = routes.get(edge.id);
        if (path) {
          setPath(edge.visible, path);
          setPath(edge.hit, path);
        } else {
          restorePath(edge.visible);
          restorePath(edge.hit);
        }
        updateStartDot(edge);
      }
      for (const [element, dot] of startDots) {
        if (!currentEdges.has(element)) {
          dot.remove();
          startDots.delete(element);
        }
      }
    } catch (error) {
      console.warn("Railway Curved Connections:", error);
      restoreAll();
    } finally {
      rendering = false;
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (rendering) { dirty = true; return; }
    if (scheduled || !enabled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }

  function attach() {
    const nextCanvas = document.querySelector(".react-flow");
    if (nextCanvas === canvas) return;
    if (canvasObserver) canvasObserver.disconnect();
    restoreAll();
    canvas = nextCanvas;
    if (!canvas) return;
    canvasObserver = new MutationObserver(schedule);
    canvasObserver.observe(canvas, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "d", "data-id"],
    });
    schedule();
  }

  chrome.storage.local.get({enabled: true}, (settings) => {
    enabled = settings.enabled !== false;
    attach();
    if (!enabled) restoreAll();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;
    enabled = changes.enabled.newValue !== false;
    if (enabled) schedule();
    else restoreAll();
  });

  new MutationObserver(attach).observe(document.documentElement, {
    subtree: true,
    childList: true,
  });
  window.addEventListener("resize", schedule);
})();
