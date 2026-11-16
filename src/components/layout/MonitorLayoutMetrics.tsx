import { useLayoutEffect } from 'react';

/** Reserve actual mobile chrome space without touching the globe renderer. */
export function MonitorLayoutMetrics() {
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    const property = '--monitor-mobile-chrome';
    const previous = style.getPropertyValue(property);
    const header = document.querySelector<HTMLElement>('.app-header');
    const footer = document.querySelector<HTMLElement>('footer');
    const main = document.querySelector<HTMLElement>('main');
    if (!header || !footer || !main) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const padding = getComputedStyle(main);
      const reserved = header.getBoundingClientRect().height + footer.getBoundingClientRect().height
        + (Number.parseFloat(padding.paddingTop) || 0) + (Number.parseFloat(padding.paddingBottom) || 0);
      const value = `${Math.ceil(reserved)}px`;
      if (style.getPropertyValue(property) !== value) style.setProperty(property, value);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    for (const element of [header, footer, main]) observer?.observe(element);
    window.addEventListener('resize', schedule);
    measure();

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      if (previous) style.setProperty(property, previous);
      else style.removeProperty(property);
    };
  }, []);

  return null;
}
