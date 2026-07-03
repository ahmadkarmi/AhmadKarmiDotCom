import { useState, useRef, useEffect } from 'react';

interface BodyImageLightboxProps {
    rootSelector?: string;
}

interface Slide {
    src: string;
    fullSrc: string;
    alt: string;
    caption: string;
}

// WordPress inserts scaled renditions like "photo-768x432.jpg"; the original
// lives at "photo.jpg". Prefer it for zooming, fall back to src via onError.
function fullSizeSrc(src: string): string {
    return src.replace(/-\d+x\d+(?=\.(?:jpe?g|png|gif|webp|avif)$)/i, '');
}

const MIN_SIZE = 200;

// Webflow-imported media carries placeholder alts like "__wf_reserved_inherit"
function cleanAlt(alt: string): string {
    return alt.startsWith('__wf_') ? '' : alt;
}

// Zoom/pan/pinch logic mirrors GalleryCarousel.tsx (kept separate to avoid
// touching the working gallery); extract a shared hook if a third consumer appears.
export default function BodyImageLightbox({ rootSelector = '[data-lightbox-root]' }: BodyImageLightboxProps) {
    const [open, setOpen] = useState(false);
    const [index, setIndex] = useState(0);
    const [slides, setSlides] = useState<Slide[]>([]);
    const [zoomScale, setZoomScale] = useState(1);
    const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
    const zoomAreaRef = useRef<HTMLDivElement>(null);
    const pointerMapRef = useRef<Map<number, { x: number; y: number }>>(new Map());
    const panStartRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
    const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);
    const triggerRef = useRef<HTMLElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    function clamp(n: number, min: number, max: number) {
        return Math.max(min, Math.min(n, max));
    }

    function clampOffsetForScale(next: { x: number; y: number }, scale: number) {
        const rect = zoomAreaRef.current?.getBoundingClientRect();
        const w = rect?.width || window.innerWidth;
        const h = rect?.height || window.innerHeight;
        const maxX = (w * (scale - 1)) / 2;
        const maxY = (h * (scale - 1)) / 2;
        return {
            x: clamp(next.x, -maxX, maxX),
            y: clamp(next.y, -maxY, maxY),
        };
    }

    function resetZoom() {
        setZoomScale(1);
        setZoomOffset({ x: 0, y: 0 });
        pointerMapRef.current.clear();
        panStartRef.current = null;
        pinchStartRef.current = null;
    }

    function adjustZoom(delta: number) {
        setZoomScale((s) => {
            const next = clamp(s + delta, 1, 4);
            if (next === 1) setZoomOffset({ x: 0, y: 0 });
            else setZoomOffset((o) => clampOffsetForScale(o, next));
            return next;
        });
    }

    function collectImages(): HTMLImageElement[] {
        return Array.from(document.querySelectorAll<HTMLImageElement>(`${rootSelector} img[data-lightbox-bound]`));
    }

    function openLightbox(img: HTMLImageElement) {
        const images = collectImages();
        const clickedAt = images.indexOf(img);
        if (clickedAt === -1) return;
        setSlides(images.map((el) => ({
            src: el.currentSrc || el.src,
            fullSrc: fullSizeSrc(el.currentSrc || el.src),
            alt: cleanAlt(el.alt || ''),
            caption: el.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || '',
        })));
        setIndex(clickedAt);
        triggerRef.current = img;
        setOpen(true);
    }

    function closeLightbox() {
        setOpen(false);
        triggerRef.current?.focus();
        triggerRef.current = null;
    }

    function paginate(direction: number) {
        setIndex((prev) => {
            let next = prev + direction;
            if (next < 0) next = slides.length - 1;
            if (next >= slides.length) next = 0;
            return next;
        });
    }

    useEffect(() => {
        const loadListeners: Array<{ img: HTMLImageElement; handler: () => void }> = [];

        function isTiny(img: HTMLImageElement) {
            const width = img.naturalWidth || img.offsetWidth;
            const height = img.naturalHeight || img.offsetHeight;
            return width < MIN_SIZE && height < MIN_SIZE;
        }

        function enhance(img: HTMLImageElement) {
            if (img.dataset.lightboxBound !== undefined) return;
            img.dataset.lightboxBound = '';
            img.classList.add('cursor-zoom-in');
            img.setAttribute('role', 'button');
            img.setAttribute('tabindex', '0');
            if (!img.getAttribute('aria-label')) {
                img.setAttribute('aria-label', cleanAlt(img.alt) || 'Open image in fullscreen');
            }
        }

        function unenhance(img: HTMLImageElement) {
            delete img.dataset.lightboxBound;
            img.classList.remove('cursor-zoom-in');
            img.removeAttribute('role');
            img.removeAttribute('tabindex');
        }

        // Bind every body image up front (not just loaded ones) so the slide
        // set and counter always cover the whole post, even before lazy
        // images below the fold have loaded. Icon-sized images are unbound
        // once their real dimensions are known.
        document.querySelectorAll<HTMLImageElement>(`${rootSelector} img`).forEach((img) => {
            if (img.closest('a')) return;
            if (img.complete) {
                if (!isTiny(img)) enhance(img);
                return;
            }
            enhance(img);
            const handler = () => {
                if (isTiny(img)) unenhance(img);
            };
            img.addEventListener('load', handler, { once: true });
            loadListeners.push({ img, handler });
        });

        const onClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!(target instanceof HTMLImageElement)) return;
            if (target.dataset.lightboxBound === undefined) return;
            if (target.closest('a')) return;
            e.preventDefault();
            openLightbox(target);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const target = e.target as HTMLElement;
            if (!(target instanceof HTMLImageElement)) return;
            if (target.dataset.lightboxBound === undefined) return;
            e.preventDefault();
            openLightbox(target);
        };

        document.addEventListener('click', onClick);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('click', onClick);
            document.removeEventListener('keydown', onKeyDown);
            loadListeners.forEach(({ img, handler }) => img.removeEventListener('load', handler));
            document.body.style.overflow = '';
        };
    }, [rootSelector]);

    useEffect(() => {
        if (!open) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeButtonRef.current?.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeLightbox();
                return;
            }
            if (e.key === 'ArrowLeft') {
                paginate(-1);
                return;
            }
            if (e.key === 'ArrowRight') {
                paginate(1);
                return;
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, slides.length]);

    useEffect(() => {
        if (!open) return;
        resetZoom();
    }, [index, open]);

    if (!open || slides.length === 0) return null;

    const slide = slides[index];

    return (
        <div className="fixed inset-0 z-[2000]" role="dialog" aria-modal="true" aria-label="Image viewer">
            <div
                className="absolute inset-0 bg-black/80"
                onClick={closeLightbox}
            />

            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
                <div className="relative w-full h-full">
                    <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
                        <button
                            type="button"
                            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors flex items-center justify-center shadow-lg shadow-black/40 ring-1 ring-white/20"
                            onClick={() => adjustZoom(0.5)}
                            aria-label="Zoom in"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors flex items-center justify-center shadow-lg shadow-black/40 ring-1 ring-white/20"
                            onClick={() => adjustZoom(-0.5)}
                            aria-label="Zoom out"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors flex items-center justify-center shadow-lg shadow-black/40 ring-1 ring-white/20"
                            onClick={resetZoom}
                            aria-label="Reset zoom"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v6h6M20 20v-6h-6" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 14a7 7 0 0112-3l3 3M19 10a7 7 0 01-12 3l-3-3" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            ref={closeButtonRef}
                            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors flex items-center justify-center shadow-lg shadow-black/40 ring-1 ring-white/20"
                            onClick={closeLightbox}
                            aria-label="Close"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {slides.length > 1 && (
                        <>
                            <button
                                type="button"
                                className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors items-center justify-center z-10 shadow-lg shadow-black/40 ring-1 ring-white/20 flex [@media(pointer:coarse)]:hidden"
                                onClick={() => paginate(-1)}
                                aria-label="Previous image"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <button
                                type="button"
                                className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors items-center justify-center z-10 shadow-lg shadow-black/40 ring-1 ring-white/20 flex [@media(pointer:coarse)]:hidden"
                                onClick={() => paginate(1)}
                                aria-label="Next image"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </>
                    )}

                    <div
                        ref={zoomAreaRef}
                        className="w-full h-full flex items-center justify-center"
                        style={{ touchAction: 'none' }}
                        onWheel={(e) => {
                            e.preventDefault();
                            const delta = -e.deltaY * 0.001;
                            const nextScale = clamp(zoomScale * (1 + delta), 1, 4);
                            setZoomScale(nextScale);
                            setZoomOffset((o) => (nextScale === 1 ? { x: 0, y: 0 } : clampOffsetForScale(o, nextScale)));
                        }}
                        onPointerDown={(e) => {
                            try {
                                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                            } catch {
                                // stale/synthetic pointer id; tracking below still works
                            }
                            pointerMapRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

                            if (pointerMapRef.current.size === 1) {
                                panStartRef.current = {
                                    x: e.clientX,
                                    y: e.clientY,
                                    originX: zoomOffset.x,
                                    originY: zoomOffset.y,
                                };
                                pinchStartRef.current = null;
                                return;
                            }

                            if (pointerMapRef.current.size === 2) {
                                const pts = Array.from(pointerMapRef.current.values());
                                const dx = pts[0].x - pts[1].x;
                                const dy = pts[0].y - pts[1].y;
                                pinchStartRef.current = {
                                    distance: Math.sqrt(dx * dx + dy * dy),
                                    scale: zoomScale,
                                };
                                panStartRef.current = null;
                            }
                        }}
                        onPointerMove={(e) => {
                            if (!pointerMapRef.current.has(e.pointerId)) return;
                            pointerMapRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

                            if (pointerMapRef.current.size === 2 && pinchStartRef.current) {
                                const pts = Array.from(pointerMapRef.current.values());
                                const dx = pts[0].x - pts[1].x;
                                const dy = pts[0].y - pts[1].y;
                                const dist = Math.sqrt(dx * dx + dy * dy);
                                const nextScale = clamp((pinchStartRef.current.scale * dist) / pinchStartRef.current.distance, 1, 4);
                                setZoomScale(nextScale);
                                setZoomOffset((o) => (nextScale === 1 ? { x: 0, y: 0 } : clampOffsetForScale(o, nextScale)));
                                return;
                            }

                            if (pointerMapRef.current.size === 1 && panStartRef.current && zoomScale > 1) {
                                const dx = e.clientX - panStartRef.current.x;
                                const dy = e.clientY - panStartRef.current.y;
                                const next = {
                                    x: panStartRef.current.originX + dx,
                                    y: panStartRef.current.originY + dy,
                                };
                                setZoomOffset(clampOffsetForScale(next, zoomScale));
                            }
                        }}
                        onPointerUp={(e) => {
                            // Swipe navigation at rest zoom; pan handles movement when zoomed
                            const start = panStartRef.current;
                            if (
                                pointerMapRef.current.size === 1 &&
                                start &&
                                zoomScale === 1 &&
                                slides.length > 1
                            ) {
                                const dx = e.clientX - start.x;
                                const dy = e.clientY - start.y;
                                if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
                                    paginate(dx < 0 ? 1 : -1);
                                }
                            }
                            pointerMapRef.current.delete(e.pointerId);
                            panStartRef.current = null;
                            if (pointerMapRef.current.size < 2) pinchStartRef.current = null;
                        }}
                        onPointerCancel={(e) => {
                            pointerMapRef.current.delete(e.pointerId);
                            panStartRef.current = null;
                            if (pointerMapRef.current.size < 2) pinchStartRef.current = null;
                        }}
                        onDoubleClick={() => {
                            if (zoomScale === 1) {
                                const nextScale = 2;
                                setZoomScale(nextScale);
                                setZoomOffset(clampOffsetForScale(zoomOffset, nextScale));
                            } else {
                                resetZoom();
                            }
                        }}
                    >
                        <img
                            src={slide.fullSrc}
                            alt={slide.alt || `Image ${index + 1}`}
                            onError={(e) => {
                                if (e.currentTarget.src !== slide.src) e.currentTarget.src = slide.src;
                            }}
                            draggable={false}
                            className="max-w-full max-h-full object-contain select-none"
                            style={{
                                transform: `translate3d(${zoomOffset.x}px, ${zoomOffset.y}px, 0) scale(${zoomScale})`,
                                transformOrigin: 'center',
                                willChange: 'transform',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>

                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 max-w-[90%] text-center">
                        {slide.caption && (
                            <div className="text-white/90 text-sm px-4 py-1.5 rounded-full bg-black/40 backdrop-blur-md">
                                {slide.caption}
                            </div>
                        )}
                        {slides.length > 1 && (
                            <div className="text-white/70 text-sm">
                                {index + 1} / {slides.length}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
