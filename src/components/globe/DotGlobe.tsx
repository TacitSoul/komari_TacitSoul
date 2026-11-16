import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import createGlobe from 'cobe';
import { geoOrthographic, geoPath } from 'd3-geo';
import type { NodeWithStatus } from '@/services/api';
import type { VisualTheme } from '@/hooks/useTheme';
import { formatCompactRate } from '@/components/cards/cardFormat';
import { buildEarthRegions, buildHubArcs, hubRegionCode, type EarthRegion } from '@/components/earth/earthRegions';
import { buildEarthPolygons } from '@/components/earth/earthPolygons';
import { earthSpinFps, type EarthMarkerStyle } from '@/components/earth/earthPerformance';
import { createFrameProbe } from './frameProbe';
import { markerClassName, regionCardPosition, regionsKey, type RegionCardLayout } from './globeState';
import {
  anglesFor,
  arcPoints,
  d3Rotation,
  nearestAngle,
  projectLatLng,
  projectVector,
  screenRadius,
  type CobeView,
  type Vec3,
} from './cobeProjection';
import './dot-globe.css';

/*
 * So; cobe MIT © 2021 Shu Ding) with the overlays of the 3D earth it replaced:
 *
 * - country outlines + fills of the regions that host nodes (2D canvas, d3-geo orthographic with
 *   cobe's exact rotation, so the shapes sit on cobe's dots),
 * - flag markers with node counts, hub ring, status pulses (HTML, positioned per frame),
 * - hub-and-spoke arcs with a travelling dash (2D canvas, lifted great circles),
 * - selection: the globe turns to the region and the region card follows its flag.
 *
 * One render loop drives cobe and the overlays together. Frame budget as before: auto-spin is
 * capped (30 / 20 fps), interaction runs at full rate, an idle globe stops, and rendering pauses
 * while the tab is hidden or the stage is off screen.
 */

export type { EarthMarkerStyle };

export interface DotGlobeProps {
  nodes: NodeWithStatus[];
  theme: VisualTheme;
  className?: string;
  selectedNodeId?: string | null;
  onSelectNode?: (uuid: string) => void;
  onClearSelection?: () => void;
  hubNodeUuid?: string | null;
  respectReducedMotion?: boolean;
  autoRotate?: boolean;
  markerStyle?: EarthMarkerStyle;
}

type RGB = [number, number, number];

interface Palette {
  cobe: {
    dark: number;
    baseColor: RGB;
    glowColor: RGB;
    markerColor: RGB;
    mapBrightness: number;
    diffuse: number;
    scale: number;
  };
  fill: string;
  fillSelected: string;
  stroke: string;
  arc: string;
  arcBase: string;
  online: string;
  mixed: string;
  offline: string;
}

/* cobe colours of the dot globe; overlay colours from the 3D earth palette. */
const PALETTES: Record<VisualTheme, Palette> = {
  deepspace: {
    cobe: {
      dark: 1,
      baseColor: [0.15, 0.18, 0.28],
      glowColor: [0.0, 0.55, 0.74],
      markerColor: [0.0, 1.0, 0.9],
      mapBrightness: 6.25,
      diffuse: 1.4,
      scale: 0.98,
    },
    fill: 'rgba(0, 216, 255, 0.16)',
    fillSelected: 'rgba(0, 216, 255, 0.3)',
    stroke: 'rgba(0, 255, 255, 0.85)',
    arc: '#00e5ff',
    arcBase: 'rgba(0, 216, 255, 0.4)',
    online: '#21d7a7',
    mixed: '#f5aa26',
    offline: '#ff4f78',
  },
  clean: {
    cobe: {
      dark: 0,
      baseColor: [0.9, 0.9, 0.92],
      glowColor: [0.88, 0.88, 0.92],
      markerColor: [0.3, 0.4, 0.8],
      mapBrightness: 8,
      diffuse: 1.2,
      scale: 1.0,
    },
    fill: 'rgba(29, 111, 209, 0.14)',
    fillSelected: 'rgba(29, 111, 209, 0.3)',
    stroke: 'rgba(29, 111, 209, 0.85)',
    arc: '#1d6fd1',
    arcBase: 'rgba(29, 111, 209, 0.38)',
    online: '#14936f',
    mixed: '#d98514',
    offline: '#d93a55',
  },
};

/** Auto-spin speed (radians per second). */
const SPIN_RATE = 0.16;
const INTERACTION_FPS = 60;
/** Dash travel time along an arc. */
const ARC_PERIOD_MS = 2200;

function dprFor(size: number) {
  const dpr = window.devicePixelRatio || 1;
  if (window.innerWidth < 640) return Math.min(dpr, 2);
  return dpr >= 2 && size <= 720 ? Math.min(dpr, 2.5) : Math.min(dpr, 2);
}

/** Map dot density (more dots on large backing buffers). */
function mapSamplesFor(size: number, style: EarthMarkerStyle) {
  const backing = size * dprFor(size);
  if (window.innerWidth < 640 || style === 'lite') return backing >= 1000 ? 10000 : 8000;
  if (backing >= 1400) return 16000;
  if (backing >= 1100) return 14000;
  if (backing >= 800) return 12000;
  return 10000;
}

function firstNode(region: EarthRegion) {
  return region.nodes.find((n) => n.status === 'online') ?? region.nodes[0];
}

export function DotGlobe({
  nodes,
  theme,
  className,
  selectedNodeId = null,
  onSelectNode,
  onClearSelection,
  hubNodeUuid = null,
  respectReducedMotion = false,
  autoRotate = true,
  markerStyle = 'rich',
}: DotGlobeProps) {
  const { t } = useTranslation();
  const slotRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const cobeCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [slowDevice, setSlowDevice] = useState(false);

  const regions = useMemo(() => buildEarthRegions(nodes), [nodes]);
  const key = regionsKey(regions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRegions = useMemo(() => regions, [key]);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const arcs = useMemo(() => buildHubArcs(stableRegions, hubNodeUuid), [stableRegions, hubNodeUuid]);
  const hubCode = useMemo(() => hubRegionCode(stableRegions, hubNodeUuid), [stableRegions, hubNodeUuid]);
  const polygons = useMemo(() => buildEarthPolygons(stableRegions.map((r) => r.code)), [stableRegions]);
  const selectedRegionCode = useMemo(() => {
    if (!selectedNodeId) return null;
    return regions.find((r) => r.nodes.some((n) => n.uuid === selectedNodeId))?.code ?? null;
  }, [regions, selectedNodeId]);

  /* motion preference */
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const spinning = autoRotate && !slowDevice && !(respectReducedMotion && reduceMotion) && !selectedRegionCode;
  const animateArcs = arcs.length > 0 && !slowDevice && !(respectReducedMotion && reduceMotion) && markerStyle !== 'lite';

  /* state read by the long-lived render loop */
  const live = useRef({
    phi: 0,
    theta: 0.15,
    targetPhi: null as number | null,
    targetTheta: null as number | null,
    size: 0,
    palette: PALETTES[theme],
    regions: stableRegions,
    polygons,
    arcs,
    hubCode,
    selected: selectedRegionCode,
    spinning,
    animateArcs,
    markerStyle,
    spinFps: earthSpinFps(markerStyle),
  });
  Object.assign(live.current, {
    palette: PALETTES[theme],
    regions: stableRegions,
    polygons,
    arcs,
    hubCode,
    selected: selectedRegionCode,
    spinning,
    animateArcs,
    markerStyle,
    spinFps: earthSpinFps(markerStyle),
  });
  const onSelectRef = useRef(onSelectNode);
  onSelectRef.current = onSelectNode;
  const onClearRef = useRef(onClearSelection);
  onClearRef.current = onClearSelection;
  const loopRef = useRef<{ wake: (fullRateMs?: number) => void; redrawStatic: () => void } | null>(null);

  const selectRegion = useCallback((code: string) => {
    const region = regionsRef.current.find((r) => r.code === code);
    if (!region) return;
    if (live.current.selected === code) {
      onClearRef.current?.();
      return;
    }
    const node = firstNode(region);
    if (node) onSelectRef.current?.(node.uuid);
  }, []);

  /* ── square host sized from the stage ── */
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const host = hostRef.current;
    if (!slot || !host) return;
    let frame = 0;
    const apply = () => {
      const rect = slot.getBoundingClientRect();
      const size = Math.floor(Math.max(0, Math.min(rect.width, rect.height)));
      if (!size || size === live.current.size) return;
      host.style.width = `${size}px`;
      host.style.height = `${size}px`;
      live.current.size = size;
      loopRef.current?.redrawStatic();
    };
    apply();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    observer.observe(slot);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  /* ── cobe + overlay loop (created once) ── */
  useEffect(() => {
    const canvas = cobeCanvasRef.current;
    const overlay = overlayRef.current;
    const markerLayer = markersRef.current;
    const host = hostRef.current;
    if (!canvas || !overlay || !markerLayer || !host) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    let size = live.current.size || host.clientWidth || 400;
    let dpr = dprFor(size);
    let samples = mapSamplesFor(size, live.current.markerStyle);
    const palette = live.current.palette.cobe;
    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: size,
      height: size,
      phi: live.current.phi,
      theta: live.current.theta,
      dark: palette.dark,
      diffuse: palette.diffuse,
      mapSamples: samples,
      mapBrightness: palette.mapBrightness,
      baseColor: palette.baseColor,
      markerColor: palette.markerColor,
      glowColor: palette.glowColor,
      scale: palette.scale,
      markers: [],
      context: { powerPreference: 'high-performance', antialias: false, desynchronized: true },
    });

    /* overlay canvas (country outlines, arcs) */
    const sizeOverlay = () => {
      overlay.width = Math.round(size * dpr);
      overlay.height = Math.round(size * dpr);
      overlay.style.width = `${size}px`;
      overlay.style.height = `${size}px`;
    };
    sizeOverlay();
    const projection = geoOrthographic().clipAngle(90).precision(0.3);
    const path = geoPath(projection, ctx);

    /* flag markers (HTML), rebuilt when the region set changes */
    const markerEls = new Map<string, HTMLButtonElement>();
    let builtRegions: readonly EarthRegion[] | null = null;
    let builtStyle: EarthMarkerStyle | null = null;
    const buildMarkers = () => {
      const s = live.current;
      if (s.regions === builtRegions && s.markerStyle === builtStyle) return;
      builtRegions = s.regions;
      builtStyle = s.markerStyle;
      markerLayer.replaceChildren();
      markerEls.clear();
      for (const region of s.regions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = markerClassName(region, s.markerStyle, s.selected, s.hubCode);
        button.setAttribute('aria-label', `${region.code} · ${region.online}/${region.nodes.length}`);
        if (s.markerStyle !== 'lite') {
          const img = document.createElement('img');
          img.src = `/assets/flags/${region.code}.svg`;
          img.alt = '';
          img.draggable = false;
          button.appendChild(img);
        }
        if (region.nodes.length > 1 && s.markerStyle !== 'lite') {
          const count = document.createElement('span');
          count.className = 'dot-marker-count';
          count.textContent = String(region.nodes.length);
          button.appendChild(count);
        }
        button.addEventListener('pointerdown', (event) => event.stopPropagation());
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          selectRegion(region.code);
        });
        markerLayer.appendChild(button);
        markerEls.set(region.code, button);
      }
    };

    /* Cache card geometry on resize, not on every animation frame. */
    let cardLayout: RegionCardLayout | null = null;
    let cardDirty = true;
    let observedTip: HTMLDivElement | null = null;
    let observedMarker: HTMLButtonElement | null = null;
    let lastCardPosition = '';
    const cardResize = new ResizeObserver(() => {
      cardDirty = true;
      wake();
    });
    if (slotRef.current) cardResize.observe(slotRef.current);
    const followCard = (point: { x: number; y: number; z: number } | null) => {
      const tip = tipRef.current;
      const slot = slotRef.current;
      const marker = markerEls.get(live.current.selected ?? '') ?? null;
      if (tip !== observedTip || marker !== observedMarker) {
        if (observedTip) cardResize.unobserve(observedTip);
        if (observedMarker) cardResize.unobserve(observedMarker);
        observedTip = tip;
        observedMarker = marker;
        if (tip) cardResize.observe(tip);
        if (marker) cardResize.observe(marker);
        cardDirty = true;
        lastCardPosition = '';
      }
      if (!tip || !slot) return;
      if (!point || point.z <= 0.08 || window.innerWidth <= 768) {
        if (lastCardPosition !== 'docked') {
          tip.style.left = '';
          tip.style.top = '';
          tip.classList.add('is-docked');
          lastCardPosition = 'docked';
        }
        return;
      }
      if (cardDirty || !cardLayout) {
        cardLayout = {
          slotWidth: slot.clientWidth,
          slotHeight: slot.clientHeight,
          globeSize: size,
          markerWidth: marker?.offsetWidth ?? 0,
          markerHeight: marker?.offsetHeight ?? 0,
          cardWidth: tip.offsetWidth,
          cardHeight: tip.offsetHeight,
        };
        cardDirty = false;
      }
      const { left, top } = regionCardPosition(point.x, point.y, cardLayout);
      const position = `${left},${top}`;
      if (position === lastCardPosition) return;
      lastCardPosition = position;
      tip.classList.remove('is-docked');
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };

    /* ── drawing ── */
    let lastMarkerKey = '';
    let appliedPalette = live.current.palette;
    const drawFrame = (now: number) => {
      const s = live.current;
      const view: CobeView = { phi: s.phi, theta: s.theta, size, scale: s.palette.cobe.scale };
      if (s.palette !== appliedPalette) {
        appliedPalette = s.palette;
        globe.update({ ...s.palette.cobe, phi: s.phi, theta: s.theta });
      } else {
        globe.update({ phi: s.phi, theta: s.theta });
      }

      // country outlines and fills
      const r = screenRadius(view);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      projection.rotate(d3Rotation(s.phi, s.theta)).scale(r).translate([size / 2, size / 2]);
      ctx.lineJoin = 'round';
      for (const polygon of s.polygons) {
        const selected = polygon.code === s.selected;
        ctx.beginPath();
        path(polygon.geometry as Parameters<typeof path>[0]);
        ctx.fillStyle = selected ? s.palette.fillSelected : s.palette.fill;
        ctx.fill();
        ctx.lineWidth = selected ? 2 : 1.1;
        ctx.strokeStyle = s.palette.stroke;
        ctx.stroke();
      }

      // arcs: faint full line + travelling dash, hidden behind the sphere
      if (s.arcs.length > 0) {
        const hubRegion = s.regions.find((region) => region.code === s.hubCode);
        for (let index = 0; index < s.arcs.length; index += 1) {
          const arc = s.arcs[index];
          if (!hubRegion) break;
          const { points } = arcPoints({ lat: arc.startLat, lng: arc.startLng }, { lat: arc.endLat, lng: arc.endLng });
          const projected = points.map((p: Vec3) => projectVector(p, view));
          // faint base, segment by segment so hidden parts are skipped
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = s.palette.arcBase;
          ctx.beginPath();
          let pen = false;
          for (const p of projected) {
            if (!p.visible) {
              pen = false;
              continue;
            }
            if (pen) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
            pen = true;
          }
          ctx.stroke();
          // dash: a moving window of ~30 % of the arc, fading at its tail
          if (s.animateArcs) {
            const phase = ((now / ARC_PERIOD_MS + index * 0.37) % 1) * 1.3 - 0.3;
            const n = projected.length - 1;
            const head = Math.floor(Math.min(1, phase + 0.3) * n);
            const tail = Math.max(0, Math.floor(phase * n));
            for (let i = tail; i < head; i += 1) {
              const a = projected[i];
              const b = projected[i + 1];
              if (!a.visible || !b.visible) continue;
              const alpha = (i - tail) / Math.max(1, head - tail);
              ctx.globalAlpha = 0.2 + 0.8 * alpha;
              ctx.strokeStyle = s.palette.arc;
              ctx.lineWidth = 2.4;
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
        }
      }

      // flags follow their regions
      buildMarkers();
      const markerKey = `${s.selected}|${s.hubCode}`;
      const classesChanged = markerKey !== lastMarkerKey;
      lastMarkerKey = markerKey;
      let selectedPoint = null;
      for (const region of s.regions) {
        const el = markerEls.get(region.code);
        if (!el) continue;
        const p = projectLatLng(region.lat, region.lng, view);
        if (region.code === s.selected) selectedPoint = p;
        const front = p.z > 0.08;
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(var(--dm-scale, 1)) translate(-50%, -50%)`;
        el.classList.toggle('is-hidden', !front);
        if (classesChanged) {
          el.classList.toggle('is-selected', region.code === s.selected);
          el.classList.toggle('is-hub', region.code === s.hubCode);
        }
      }
      followCard(selectedPoint);
    };

    /* ── loop ── */
    let raf = 0;
    let timer = 0;
    let lastDraw = 0;
    let fullRateUntil = 0;
    let stopped = document.hidden;
    let onScreen = true;
    let dragging: { x: number; y: number; phi: number; theta: number; moved: number } | null = null;
    let slow = false;
    const probe = createFrameProbe((duration) => wake(duration), () => {
      slow = true;
      setSlowDevice(true);
    });

    const interval = () => {
      const now = performance.now();
      if (dragging || live.current.targetPhi !== null || now < fullRateUntil) return 1000 / INTERACTION_FPS;
      if (slow) return 1000;
      if (live.current.spinning) return 1000 / live.current.spinFps;
      if (live.current.animateArcs) return 1000 / 20;
      return Number.POSITIVE_INFINITY; // idle: no frames until something changes
    };

    const tick = (now: number) => {
      raf = 0;
      if (stopped || !onScreen) return;
      const step = interval();
      if (lastDraw && now - lastDraw < step - 2) {
        schedule(step - (now - lastDraw));
        return;
      }
      const dt = lastDraw ? Math.min(0.05, (now - lastDraw) / 1000) : 1 / INTERACTION_FPS;
      lastDraw = now;
      const s = live.current;
      if (s.targetPhi !== null && s.targetTheta !== null) {
        const dPhi = s.targetPhi - s.phi;
        const dTheta = s.targetTheta - s.theta;
        s.phi += dPhi * 0.1;
        s.theta += dTheta * 0.1;
        if (Math.abs(dPhi) < 0.001 && Math.abs(dTheta) < 0.001) {
          s.targetPhi = null;
          s.targetTheta = null;
        }
      } else if (!dragging && s.spinning) {
        s.phi += SPIN_RATE * dt;
      }
      probe.frame();
      drawFrame(now);
      schedule(interval());
    };

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (stopped || !onScreen || !Number.isFinite(delay)) return; // paused / idle
      if (delay > 20) {
        timer = window.setTimeout(() => {
          raf = requestAnimationFrame(tick);
        }, delay - 16);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };

    const wake = (fullRateMs = 0) => {
      if (fullRateMs > 0) fullRateUntil = Math.max(fullRateUntil, performance.now() + fullRateMs);
      if (!stopped && onScreen && !raf) {
        lastDraw = 0; // Explicit redraws must also wake an idle globe.
        schedule(0);
      }
    };
    loopRef.current = {
      wake,
      redrawStatic: () => {
        const next = live.current.size;
        if (next && next !== size) {
          size = next;
          cardDirty = true;
          const nextDpr = dprFor(size);
          const nextSamples = mapSamplesFor(size, live.current.markerStyle);
          const patch: Record<string, number> = { width: size, height: size };
          if (nextDpr !== dpr) patch.devicePixelRatio = nextDpr;
          if (nextSamples !== samples) patch.mapSamples = nextSamples;
          dpr = nextDpr;
          samples = nextSamples;
          globe.update(patch);
          sizeOverlay();
        }
        if (!stopped && onScreen) drawFrame(performance.now());
        wake();
      },
    };

    /* first frame, then reveal */
    if (!stopped && onScreen) drawFrame(performance.now());
    const readyTimer = window.setTimeout(() => setReady(true), 80);
    wake();

    /* drag to rotate (both axes), click on empty globe clears the selection */
    const onPointerDown = (event: PointerEvent) => {
      dragging = { x: event.clientX, y: event.clientY, phi: live.current.phi, theta: live.current.theta, moved: 0 };
      live.current.targetPhi = null;
      live.current.targetTheta = null;
      host.setPointerCapture(event.pointerId);
      host.classList.add('is-dragging');
      wake();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      dragging.moved = Math.max(dragging.moved, Math.abs(dx) + Math.abs(dy));
      live.current.phi = dragging.phi + dx / 200;
      live.current.theta = Math.max(-1.2, Math.min(1.2, dragging.theta + dy / 300));
      wake();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!dragging) return;
      const moved = dragging.moved;
      dragging = null;
      host.classList.remove('is-dragging');
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      if (moved < 4 && live.current.selected) onClearRef.current?.();
      wake(300);
    };
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);

    /* pause while hidden / off screen */
    const syncRunning = () => {
      stopped = document.hidden;
      probe.setRunning(!stopped && onScreen);
      if (stopped || !onScreen) schedule(Number.POSITIVE_INFINITY);
      else wake();
    };
    syncRunning();
    document.addEventListener('visibilitychange', syncRunning);
    const onResize = () => {
      cardDirty = true;
      wake();
    };
    window.addEventListener('resize', onResize);
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      syncRunning();
    });
    visibility.observe(host);

    return () => {
      loopRef.current = null;
      window.clearTimeout(timer);
      window.clearTimeout(readyTimer);
      probe.dispose();
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', syncRunning);
      window.removeEventListener('resize', onResize);
      visibility.disconnect();
      cardResize.disconnect();
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      markerLayer.replaceChildren();
      globe.destroy();
    };
  }, [selectRegion]);

  /* ── palette changes (drawFrame pushes the cobe colours) ── */
  useEffect(() => {
    loopRef.current?.redrawStatic();
  }, [theme]);

  /* ── data / selection / spin changes: one redraw, then the loop decides its rate ── */
  useEffect(() => {
    loopRef.current?.redrawStatic();
  }, [stableRegions, polygons, arcs, hubCode, selectedRegionCode, markerStyle, spinning, animateArcs]);

  /* ── turn to the selected region ── */
  useEffect(() => {
    if (!selectedRegionCode) return;
    const region = regionsRef.current.find((r) => r.code === selectedRegionCode);
    if (!region) return;
    const target = anglesFor(region.lat, region.lng);
    live.current.targetPhi = nearestAngle(live.current.phi, target.phi);
    live.current.targetTheta = Math.max(-1.2, Math.min(1.2, target.theta * 0.85));
    loopRef.current?.wake(1500);
  }, [selectedRegionCode]);

  useEffect(() => {
    if (!selectedNodeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClearRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedNodeId]);

  const tipRegion = selectedRegionCode ? regions.find((r) => r.code === selectedRegionCode) : undefined;

  return (
    <div ref={slotRef} className={`dot-globe-slot ${className ?? ''}`}>
      <div className="globe-radar-layer" aria-hidden>
        <div className="radar-scan" />
        <div className="globe-radar-ring globe-radar-ring-60" />
        <div className="globe-radar-ring globe-radar-ring-40" />
        <div className="globe-radar-ring globe-radar-ring-20" />
      </div>
      <div ref={hostRef} className={`dot-globe-host${ready ? ' is-ready' : ''}`}>
        <canvas ref={cobeCanvasRef} className="dot-globe-cobe" />
        <canvas ref={overlayRef} className="dot-globe-overlay" aria-hidden />
        <div ref={markersRef} className="dot-globe-markers" />
      </div>
      {tipRegion && (
        <div
          ref={tipRef}
          className="earth-tooltip is-open is-docked"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          role="group"
          aria-label={tipRegion.code}
        >
          <div className="earth-tooltip-head">
            <span className="earth-tooltip-title">
              <img src={`/assets/flags/${tipRegion.code}.svg`} alt="" />
              {tipRegion.code}
            </span>
            <span className="earth-tooltip-status">
              {t('earth.onlineOf', { online: tipRegion.online, total: tipRegion.nodes.length })}
            </span>
          </div>
          <ul className="earth-tooltip-list">
            {tipRegion.nodes.map((node) => (
              <li key={node.uuid}>
                <button
                  type="button"
                  className={`earth-tooltip-item${node.status === 'offline' ? ' is-offline' : ''}${
                    node.uuid === selectedNodeId ? ' is-selected' : ''
                  }`}
                  onClick={() => onSelectRef.current?.(node.uuid)}
                >
                  <span>{node.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {tipRegion.online > 0 && (
            <div className="earth-tooltip-speed">
              <span>↑ {formatCompactRate(tipRegion.up)}</span>
              <span>↓ {formatCompactRate(tipRegion.down)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DotGlobe;
