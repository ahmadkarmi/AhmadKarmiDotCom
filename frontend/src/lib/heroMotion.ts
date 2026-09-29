// Home hero motion. Deliberately tiny and dependency-free.
//
// - Desktop (xl+, fine pointer): the board tilts toward the cursor. One rAF
//   loop lerps toward the target and writes the board's inline transform,
//   and stops as soon as it settles, so an idle page runs no frames. (Not a
//   CSS custom property: those inherit, so every change re-styled all ~115
//   elements on the board instead of just the board itself.)
// - Below xl: CSS runs the "loop" mode (drift + ticket) by default. If the
//   device reports real orientation data within 2s we switch to "gyro" mode
//   and move each column by its depth. We never call
//   DeviceOrientationEvent.requestPermission(), so no device ever shows a
//   prompt: iOS delivers no events without it and simply stays on the loop.
//   (Feature-detecting requestPermission is not an iOS test: current Chrome
//   exposes it too and still streams events.)
// - Everything pauses when the hero is off screen or the tab is hidden, is
//   skipped under prefers-reduced-motion, and is torn down before an Astro
//   view-transition swap.
//
// Only transforms change, so no frame triggers layout or paint.

const REST_RX = 4; // deg, resting tilt (matches HeroArtDesktop.astro)
const REST_RY = -8;
const TILT_X = 4; // deg of extra tilt at the viewport edge
const TILT_Y = 6;
const GYRO_RANGE = 15; // deg of device tilt mapped to full travel
const GYRO_TRAVEL = 10; // px of travel at depth 1
const EASE = 0.08;

type Vec = { x: number; y: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function init() {
    const hero = document.querySelector<HTMLElement>('[data-hero]');
    if (!hero || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const controller = new AbortController();
    const { signal } = controller;

    const board = hero.querySelector<HTMLElement>('[data-hero-board]');
    const mobile = hero.querySelector<HTMLElement>('[data-hero-mobile]');
    const columns = mobile
        ? Array.from(mobile.querySelectorAll<HTMLElement>('[data-depth]'), (el) => ({
              el,
              depth: Number(el.dataset.depth) || 0,
          }))
        : [];

    const tiltQuery = matchMedia('(min-width: 1280px) and (hover: hover) and (pointer: fine)');
    const mobileQuery = matchMedia('(max-width: 1279.98px)');

    let mode: 'tilt' | 'gyro' | 'none' = 'none';
    const target: Vec = { x: 0, y: 0 };
    const current: Vec = { x: 0, y: 0 };
    let frame = 0;
    let onScreen = true;

    const canRun = () => onScreen && !document.hidden;

    function render() {
        if (mode === 'tilt' && board) {
            const rx = (REST_RX - current.y * TILT_X).toFixed(3);
            const ry = (REST_RY + current.x * TILT_Y).toFixed(3);
            board.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
        } else if (mode === 'gyro') {
            for (const { el, depth } of columns) {
                const dx = (current.x * depth * GYRO_TRAVEL).toFixed(2);
                const dy = (current.y * depth * GYRO_TRAVEL).toFixed(2);
                el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
            }
        }
    }

    function tick() {
        frame = 0;
        current.x += (target.x - current.x) * EASE;
        current.y += (target.y - current.y) * EASE;
        render();
        const settled = Math.abs(target.x - current.x) < 0.001 && Math.abs(target.y - current.y) < 0.001;
        if (!settled && canRun()) frame = requestAnimationFrame(tick);
    }

    function kick() {
        if (!frame && canRun()) frame = requestAnimationFrame(tick);
    }

    // ---- Pause off screen / hidden tab ----
    const observer = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        hero.toggleAttribute('data-hero-paused', !canRun());
        kick();
    });
    observer.observe(hero);

    document.addEventListener(
        'visibilitychange',
        () => {
            hero.toggleAttribute('data-hero-paused', !canRun());
            kick();
        },
        { signal }
    );

    // ---- Desktop: pointer tilt ----
    if (board) {
        hero.addEventListener(
            'pointermove',
            (e) => {
                if (e.pointerType !== 'mouse' || !tiltQuery.matches) return;
                mode = 'tilt';
                // Viewport-relative, so no layout reads on the hot path.
                target.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1);
                target.y = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1);
                kick();
            },
            { signal, passive: true }
        );
        hero.addEventListener(
            'pointerleave',
            () => {
                target.x = 0;
                target.y = 0;
                kick();
            },
            { signal, passive: true }
        );
    }

    // ---- Below xl: gyro, with the CSS loop as the default ----
    if (mobile && columns.length && mobileQuery.matches && 'DeviceOrientationEvent' in window) {
        let baseline: { beta: number; gamma: number } | null = null;

        const onOrientation = (e: DeviceOrientationEvent) => {
            if (e.beta == null || e.gamma == null) return;
            if (!baseline) {
                baseline = { beta: e.beta, gamma: e.gamma };
                mode = 'gyro';
                hero.dataset.heroMode = 'gyro';
            }
            // Let the neutral angle follow how the phone is held over time.
            baseline.beta += (e.beta - baseline.beta) * 0.002;
            baseline.gamma += (e.gamma - baseline.gamma) * 0.002;
            target.x = clamp((e.gamma - baseline.gamma) / GYRO_RANGE, -1, 1);
            target.y = clamp((e.beta - baseline.beta) / GYRO_RANGE, -1, 1);
            kick();
        };

        window.addEventListener('deviceorientation', onOrientation, { signal, passive: true });

        // No real reading within 2s (iOS without permission, laptop, no
        // sensor): stay on the loop.
        const timeout = setTimeout(() => {
            if (!baseline) window.removeEventListener('deviceorientation', onOrientation);
        }, 2000);
        signal.addEventListener('abort', () => clearTimeout(timeout));
    }

    document.addEventListener(
        'astro:before-swap',
        () => {
            controller.abort();
            observer.disconnect();
            cancelAnimationFrame(frame);
        },
        { once: true }
    );
}

// astro:page-load fires on the first load and after every client navigation.
document.addEventListener('astro:page-load', init);
