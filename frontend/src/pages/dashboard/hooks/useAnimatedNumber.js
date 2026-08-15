import { useEffect, useRef, useState } from "react";

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** Ease-out from the CURRENT value toward `target` (positive rises, negative falls).
 *  Does NOT restart from 0 on every target change — restarting made numbers flash
 *  back to 0.00 and roll up again on any refresh (scope switch, realtime update),
 *  which reads as flicker on slow connections. The first mount still animates from 0
 *  (nothing to ease from); later updates ease from where the display currently is. */
export function useAnimatedNumber(target, { duration = 550, active = true } = {}) {
  const safeTarget = Number.isFinite(Number(target)) ? Number(target) : 0;
  const [value, setValue] = useState(active ? 0 : safeTarget);
  const rafRef = useRef(0);
  // Latest animated value, kept across renders so a new target eases from where the
  // display currently is (not from 0). Null until the first animation step runs.
  const currentValueRef = useRef(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (!active) {
      setValue(safeTarget);
      currentValueRef.current = null;
      return undefined;
    }

    if (safeTarget === 0) {
      setValue(0);
      currentValueRef.current = null;
      return undefined;
    }

    const from =
      currentValueRef.current != null && Number.isFinite(currentValueRef.current)
        ? currentValueRef.current
        : 0;
    const to = safeTarget;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const next = from + (to - from) * easeOutCubic(progress);
      currentValueRef.current = next;
      setValue(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        currentValueRef.current = null;
        setValue(to);
      }
    };

    setValue(from);
    currentValueRef.current = from;
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [safeTarget, duration, active]);

  return value;
}
