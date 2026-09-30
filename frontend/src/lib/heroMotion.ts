// Home hero motion. Deliberately tiny and dependency-free.
//
// - Desktop (lg+, fine pointer): the board tilts toward the cursor. One rAF
//   loop lerps toward the target and writes the board's inline transform,
//   and stops as soon as it settles, so an idle page runs no frames. (Not a
//   CSS custom property: those inherit, so every change re-styled all ~115
//   elements on the board instead of just the board itself.)
// - Below lg the board is pure CSS (a slow drift plus the conveyor loop); the
//   script only pauses it. There is deliberately no device-orientation mode:
//   shifting columns sideways made cards cross the column dividers, and
//   columns moving by different amounts made the conveyor hand-off jump.
// - Everything pauses when the hero is off screen or the tab is hidden, is
//   skipped under prefers-reduced-motion, and is torn down before an Astro
//   view-transition swap.
//
// Only transforms change, so no frame triggers layout or paint.

const REST_RX = 4; // deg, resting tilt (matches HeroArtDesktop.astro)
const REST_RY = -8;
const TILT_X = 4; // deg of extra tilt at the viewport edge
const TILT_Y = 6;
const EASE = 0.08;

type Vec = { x: number; y: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function init() {
    const hero = document.querySelector<HTMLElement>('[data-hero]');
    if (!hero || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const controller = new AbortController();
    const { signal } = controller;

    const board = hero.querySelector<HTMLElement>('[data-hero-board]');
    const tiltQuery = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');

    const target: Vec = { x: 0, y: 0 };
    const current: Vec = { x: 0, y: 0 };
    let frame = 0;
    let onScreen = true;

    const canRun = () => onScreen && !document.hidden;

    function render() {
        if (!board) return;
        const rx = (REST_RX - current.y * TILT_X).toFixed(3);
        const ry = (REST_RY + current.x * TILT_Y).toFixed(3);
        board.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
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

    // ---- Pause off screen / hidden tab (CSS loops read data-hero-paused) ----
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

export {};
