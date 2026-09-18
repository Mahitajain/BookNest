import { useCallback, useEffect, useRef } from "react";
import { BOOK_CONFIG } from "../components/bookGeometry";

type Refs = {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  rowRef: React.RefObject<HTMLDivElement | null>;
  /** Wrapper that receives the parallax custom properties. */
  sceneRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * One interaction system for the whole shelf.
 *
 * Every book derives its motion from a single pointer position rather than
 * carrying its own listener. Influence is integrated with an overdamped
 * spring and written straight to CSS custom properties on the spine nodes,
 * so proximity motion costs zero React renders.
 *
 * The rAF loop runs only while something is actually moving.
 */
export function useShelfInteraction({ scrollerRef, rowRef, sceneRef }: Refs) {
  /** Spine centre offsets inside the row, in row-local px. Recomputed on layout. */
  const centersRef = useRef<Float64Array>(new Float64Array(0));
  const nodesRef = useRef<HTMLElement[]>([]);
  /** Current + velocity of the influence spring, one slot per spine. */
  const valueRef = useRef<Float64Array>(new Float64Array(0));
  const velocityRef = useRef<Float64Array>(new Float64Array(0));
  const dirRef = useRef<Int8Array>(new Int8Array(0));

  const pointerRef = useRef<{ x: number; y: number; inside: boolean }>({
    x: 0,
    y: 0,
    inside: false,
  });
  const parallaxRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const reducedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedRef.current = mq.matches;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /** Re-read spine geometry. One layout pass, never per frame, never per book per frame. */
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const nodes = Array.from(row.querySelectorAll<HTMLElement>("[data-spine]"));
    nodesRef.current = nodes;
    const centers = new Float64Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      centers[i] = nodes[i].offsetLeft + nodes[i].offsetWidth / 2;
    }
    centersRef.current = centers;
    if (valueRef.current.length !== nodes.length) {
      valueRef.current = new Float64Array(nodes.length);
      velocityRef.current = new Float64Array(nodes.length);
      dirRef.current = new Int8Array(nodes.length);
    }
  }, [rowRef]);

  /**
   * The loop, the listeners and the spring all live in one effect so the
   * recursive rAF call never has to reference a callback declared later.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let raf: number | null = null;
    let lastTime = 0;

    const tick = (time: number) => {
      raf = null;
      const row = rowRef.current;
      const nodes = nodesRef.current;
      const centers = centersRef.current;
      if (!row || nodes.length === 0) return;

      const dt = Math.min(0.033, lastTime ? (time - lastTime) / 1000 : 0.016);
      lastTime = time;

      const { stiffness, damping, mass } = BOOK_CONFIG.spring;
      const radius = BOOK_CONFIG.interactionRadius;

      // One layout read per frame for the whole shelf, not one per book.
      const rowLeft = row.getBoundingClientRect().left;
      const pointer = pointerRef.current;
      const localX = pointer.x - rowLeft;

      const values = valueRef.current;
      const velocities = velocityRef.current;
      const dirs = dirRef.current;

      let moving = false;

      for (let i = 0; i < nodes.length; i++) {
        const distance = pointer.inside ? Math.abs(centers[i] - localX) : Infinity;
        const target = distance < radius ? 1 - distance / radius : 0;

        // Settled and outside the field: no maths, no DOM write.
        if (target === 0 && Math.abs(values[i]) < 0.0015 && Math.abs(velocities[i]) < 0.0015) {
          if (values[i] !== 0) {
            values[i] = 0;
            velocities[i] = 0;
            nodes[i].style.setProperty("--i", "0");
          }
          continue;
        }

        const acceleration = (stiffness * (target - values[i]) - damping * velocities[i]) / mass;
        velocities[i] += acceleration * dt;
        values[i] += velocities[i] * dt;

        // Books left of the cursor are pushed left, right of it pushed right.
        // The book under the cursor gets 0 so it pulls forward instead.
        const offset = centers[i] - localX;
        const next = Math.abs(offset) < nodes[i].offsetWidth / 2 ? 0 : offset < 0 ? -1 : 1;
        if (dirs[i] !== next) {
          dirs[i] = next;
          nodes[i].style.setProperty("--d", String(next));
        }
        nodes[i].style.setProperty("--i", values[i].toFixed(3));
        moving = true;
      }

      const p = parallaxRef.current;
      p.x += (p.tx - p.x) * Math.min(1, dt * 7);
      p.y += (p.ty - p.y) * Math.min(1, dt * 7);
      const scene = sceneRef.current;
      if (scene) {
        scene.style.setProperty("--px", p.x.toFixed(4));
        scene.style.setProperty("--py", p.y.toFixed(4));
      }
      if (Math.abs(p.tx - p.x) > 0.001 || Math.abs(p.ty - p.y) > 0.001) moving = true;

      if (moving || pointer.inside) {
        raf = requestAnimationFrame(tick);
      } else {
        lastTime = 0;
      }
    };

    const start = () => {
      if (reducedRef.current) return;
      if (raf === null) {
        lastTime = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    const onMove = (event: PointerEvent) => {
      const rect = scroller.getBoundingClientRect();
      pointerRef.current.x = event.clientX;
      pointerRef.current.y = event.clientY;
      pointerRef.current.inside = true;
      parallaxRef.current.tx = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      parallaxRef.current.ty = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;
      start();
    };

    const onLeave = () => {
      pointerRef.current.inside = false;
      parallaxRef.current.tx = 0;
      parallaxRef.current.ty = 0;
      start();
    };

    // One pointer listener for the whole shelf, never one per book.
    scroller.addEventListener("pointermove", onMove, { passive: true });
    scroller.addEventListener("pointerleave", onLeave);
    scroller.addEventListener("pointercancel", onLeave);

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerleave", onLeave);
      scroller.removeEventListener("pointercancel", onLeave);
    };
  }, [rowRef, scrollerRef, sceneRef]);

  return { measure };
}
