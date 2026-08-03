import { useEffect, useRef, useState } from "react";

/**
 * Delays showing a "still loading" placeholder so an already-cached scope
 * (resolves within `delayMs`) paints instantly with no placeholder and no
 * reveal animation — indistinguishable from data that was always there.
 * Only a genuine fetch that outlives the grace window shows the placeholder,
 * and gets a one-shot reveal animation (via `revealKey`) once it lands.
 */
export function useDeferredReveal(isLoading, delayMs = 150) {
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const [reveal, setReveal] = useState({ animate: false, revealKey: 0 });
  const shownRef = useRef(false);

  useEffect(() => {
    if (isLoading) {
      shownRef.current = false;
      const timer = window.setTimeout(() => {
        shownRef.current = true;
        setShowPlaceholder(true);
      }, delayMs);
      return () => window.clearTimeout(timer);
    }
    setShowPlaceholder(false);
    if (shownRef.current) {
      shownRef.current = false;
      setReveal((r) => ({ animate: true, revealKey: r.revealKey + 1 }));
    }
    return undefined;
  }, [isLoading, delayMs]);

  return { showPlaceholder, animate: reveal.animate, revealKey: reveal.revealKey };
}
