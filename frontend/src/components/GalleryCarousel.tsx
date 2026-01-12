import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';

interface GalleryCarouselProps {
    images: { url: string; alt?: string }[];
    className?: string;
}

export default function GalleryCarousel({ images, className = '' }: GalleryCarouselProps) {
    if (!Array.isArray(images) || images.length === 0) return null;

    const [currentIndex, setCurrentIndex] = useState(0);
    const [direction, setDirection] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const lastDragAtRef = useRef<number>(0);

    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const [zoomScale, setZoomScale] = useState(1);
    const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
    const zoomAreaRef = useRef<HTMLDivElement>(null);
    const pointerMapRef = useRef<Map<number, { x: number; y: number }>>(new Map());
    const panStartRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
    const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);

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

    function openLightbox(index: number) {
        setLightboxIndex(index);
        setLightboxOpen(true);
    }

    function closeLightbox() {
        setLightboxOpen(false);
    }

    function paginateLightbox(newDirection: number) {
        setLightboxIndex((prev) => {
            let next = prev + newDirection;
            if (next < 0) next = images.length - 1;
            if (next >= images.length) next = 0;
            return next;
        });
    }

    useEffect(() => {
        if (!lightboxOpen) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeLightbox();
                return;
            }
            if (e.key === 'ArrowLeft') {
                paginateLightbox(-1);
                return;
            }
            if (e.key === 'ArrowRight') {
                paginateLightbox(1);
                return;
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [lightboxOpen, images.length]);

    useEffect(() => {
        if (!lightboxOpen) return;
        resetZoom();
    }, [lightboxIndex, lightboxOpen]);

    const slideVariants = {
        enter: (direction: number) => ({
            x: direction > 0 ? 1000 : -1000,
            opacity: 0,
            scale: 0.95
        }),
        center: {
            zIndex: 1,
            x: 0,
            opacity: 1,
            scale: 1
        },
        exit: (direction: number) => ({
            zIndex: 0,
            x: direction < 0 ? 1000 : -1000,
            opacity: 0,
            scale: 0.95
        })
    };

    const swipeConfidenceThreshold = 1000;
    const swipePower = (offset: number, velocity: number) => {
        return Math.abs(offset) * velocity;
    };

    const paginate = (newDirection: number) => {
        setDirection(newDirection);
        let nextIndex = currentIndex + newDirection;
        if (nextIndex < 0) nextIndex = images.length - 1;
        if (nextIndex >= images.length) nextIndex = 0;
        setCurrentIndex(nextIndex);
    };

    return (
        <div className={`relative group ${className}`} ref={containerRef}>
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-background-secondary">
                <AnimatePresence initial={false} custom={direction}>
                    <motion.div
                        key={currentIndex}
                        custom={direction}
                        variants={slideVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        transition={{
                            x: { type: "spring", stiffness: 300, damping: 30 },
                            opacity: { duration: 0.2 }
                        }}
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={1}
                        onDragStart={() => {
                            lastDragAtRef.current = Date.now();
                        }}
                        onDragEnd={(e, { offset, velocity }) => {
                            const swipe = swipePower(offset.x, velocity.x);

                            if (swipe < -swipeConfidenceThreshold) {
                                paginate(1);
                            } else if (swipe > swipeConfidenceThreshold) {
                                paginate(-1);
                            }

                            lastDragAtRef.current = Date.now();
                        }}
                        onClick={() => {
                            const now = Date.now();
                            if (now - lastDragAtRef.current < 250) return;
                            openLightbox(currentIndex);
                        }}
                        className="absolute inset-0 w-full h-full"
                    >
                        <img
                            src={images[currentIndex].url}
                            alt={images[currentIndex].alt || `Gallery image ${currentIndex + 1}`}
                            className="w-full h-full object-cover pointer-events-none"
                            loading="lazy"
                        />
                    </motion.div>
                </AnimatePresence>

                {/* Navigation Arrows */}
                <button
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm shadow-sm flex items-center justify-center text-foreground hover:bg-white transition-all opacity-0 group-hover:opacity-100 z-10"
                    onClick={() => paginate(-1)}
                    aria-label="Previous image"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm shadow-sm flex items-center justify-center text-foreground hover:bg-white transition-all opacity-0 group-hover:opacity-100 z-10"
                    onClick={() => paginate(1)}
                    aria-label="Next image"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                </button>

                {/* Dots */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                    {images.map((_, index) => (
                        <button
                            key={index}
                            onClick={() => {
                                setDirection(index > currentIndex ? 1 : -1);
                                setCurrentIndex(index);
                            }}
                            className={`w-2 h-2 rounded-full transition-all ${index === currentIndex
                                    ? 'bg-white w-4'
                                    : 'bg-white/50 hover:bg-white/75'
                                }`}
                            aria-label={`Go to image ${index + 1}`}
                        />
                    ))}
                </div>
            </div>

            <AnimatePresence>
                {lightboxOpen && (
                    <motion.div
                        className="fixed inset-0 z-[2000]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
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
                                        onClick={() => {
                                            setZoomScale((s) => {
                                                const next = clamp(s + 0.5, 1, 4);
                                                if (next === 1) setZoomOffset({ x: 0, y: 0 });
                                                else setZoomOffset((o) => clampOffsetForScale(o, next));
                                                return next;
                                            });
                                        }}
                                        aria-label="Zoom in"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors flex items-center justify-center shadow-lg shadow-black/40 ring-1 ring-white/20"
                                        onClick={() => {
                                            setZoomScale((s) => {
                                                const next = clamp(s - 0.5, 1, 4);
                                                if (next === 1) setZoomOffset({ x: 0, y: 0 });
                                                else setZoomOffset((o) => clampOffsetForScale(o, next));
                                                return next;
                                            });
                                        }}
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
                                        className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors flex items-center justify-center shadow-lg shadow-black/40 ring-1 ring-white/20"
                                        onClick={closeLightbox}
                                        aria-label="Close"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>

                                {images.length > 1 && (
                                    <>
                                        <button
                                            type="button"
                                            className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors flex items-center justify-center z-10 shadow-lg shadow-black/40 ring-1 ring-white/20"
                                            onClick={() => paginateLightbox(-1)}
                                            aria-label="Previous image"
                                        >
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/55 transition-colors flex items-center justify-center z-10 shadow-lg shadow-black/40 ring-1 ring-white/20"
                                            onClick={() => paginateLightbox(1)}
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
                                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
                                        src={images[lightboxIndex].url}
                                        alt={images[lightboxIndex].alt || `Gallery image ${lightboxIndex + 1}`}
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

                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
                                    {lightboxIndex + 1} / {images.length}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
