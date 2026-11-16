import { useLayoutEffect, type RefObject } from 'react';
import { getFleetNameWidth } from '@/lib/fleetNameColumn';

/** One name column for every authorized node, not just the mounted/filtered rows. */
export function useFleetNameColumn(parentRef: RefObject<HTMLDivElement | null>, nodes: readonly { name: string }[]) {
  const namesKey = JSON.stringify(nodes.map(node => node.name));

  useLayoutEffect(() => {
    const root = parentRef.current;
    const context = document.createElement('canvas').getContext('2d');
    if (!root || !context) return;
    const names = JSON.parse(namesKey) as string[];
    const property = '--fp-name-width';
    const previous = root.style.getPropertyValue(property);
    let active = true;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (!active) return;
      // One temporary font probe also works before a virtual window mounts.
      const probe = document.createElement('span');
      probe.className = 'fleet-row-name';
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:max-content;max-width:none';
      probe.textContent = 'M汉';
      root.appendChild(probe);
      try {
        const font = getComputedStyle(probe);
        context.font = `${font.fontStyle} ${font.fontWeight} ${font.fontSize} ${font.fontFamily}`;
        const width = getFleetNameWidth(names, name => context.measureText(name).width);
        if (width > 0) {
          const value = `${width}px`;
          if (root.style.getPropertyValue(property) !== value) root.style.setProperty(property, value);
        } else root.style.removeProperty(property);
      } finally {
        probe.remove();
      }
    };
    const schedule = () => {
      if (active && !frame) frame = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(root);
    window.addEventListener('resize', schedule);
    document.fonts.addEventListener('loadingdone', schedule);
    void document.fonts.ready.then(schedule);
    measure();
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      document.fonts.removeEventListener('loadingdone', schedule);
      if (frame) cancelAnimationFrame(frame);
      if (previous) root.style.setProperty(property, previous);
      else root.style.removeProperty(property);
    };
  }, [namesKey, parentRef]);
}
