import { motion, useInView, animate } from 'framer-motion';
import { useEffect, useRef } from 'react';

interface MetricProps {
    value: string;
    label: string;
    context: string;
    delay?: number;
}

const Counter = ({ value }: { value: string }) => {
    const nodeRef = useRef<HTMLSpanElement>(null);
    const isInView = useInView(nodeRef, { once: true, margin: "-10px" });

    // Extract number and suffix (e.g., "90" and "%+")
    const numberMatch = value.match(/[\d.]+/);
    const number = numberMatch ? parseFloat(numberMatch[0]) : 0;
    const suffix = value.replace(/[\d.]+/, '');

    useEffect(() => {
        if (!isInView || !nodeRef.current) return;

        const node = nodeRef.current;

        // Animate from 0 to the target number
        const controls = animate(0, number, {
            duration: 2,
            ease: "easeOut",
            onUpdate: (latest) => {
                // Format based on decimal places in original string
                const isDecimal = value.includes('.');
                node.textContent = isDecimal
                    ? latest.toFixed(1) + suffix
                    : Math.round(latest) + suffix;
            }
        });

        return () => controls.stop();
    }, [isInView, number, suffix, value]);

    return <span ref={nodeRef} className="tabular-nums">{0}</span>;
};

export default function MetricBento() {
    const metrics = [
        {
            value: '23%',
            label: 'Daily Revenue Increase',
            context: 'AI-driven personalization',
            chart: (
                <svg viewBox="0 0 100 40" className="w-full h-full text-accent/20" preserveAspectRatio="none">
                    <path d="M0 35 C 20 35, 20 10, 40 10 S 60 25, 80 5 L 100 0 L 100 40 L 0 40 Z" fill="currentColor" />
                    <path d="M0 35 C 20 35, 20 10, 40 10 S 60 25, 80 5 L 100 0" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" />
                </svg>
            )
        },
        {
            value: '90%+',
            label: 'Search Conversion Rate',
            context: 'Optimized discovery flows',
            chart: (
                <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
                    <rect x="10" y="20" width="15" height="20" className="fill-accent/20" rx="2" />
                    <rect x="35" y="10" width="15" height="30" className="fill-accent/40" rx="2" />
                    <rect x="60" y="15" width="15" height="25" className="fill-accent/60" rx="2" />
                    <rect x="85" y="5" width="15" height="35" className="fill-accent" rx="2" />
                </svg>
            )
        },
        {
            value: '70%',
            label: 'Engagement Boost',
            context: 'Gamification strategies',
            chart: (
                <svg viewBox="0 0 100 40" className="w-full h-full text-accent/20">
                    <circle cx="20" cy="20" r="2" className="fill-accent animate-pulse" />
                    <circle cx="50" cy="10" r="2" className="fill-accent animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <circle cx="80" cy="30" r="2" className="fill-accent animate-pulse" style={{ animationDelay: '0.4s' }} />
                    <path d="M20 20 L 50 10 L 80 30" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" className="text-accent/50" />
                    <circle cx="50" cy="20" r="15" className="fill-accent/5" />
                </svg>
            )
        },
        {
            value: '36.1%',
            label: 'Event Conversion',
            context: 'AI-driven campaigns',
            chart: (
                <svg viewBox="0 0 100 40" className="w-full h-full text-accent/10" preserveAspectRatio="none">
                    <path d="M0 40 L 20 30 L 40 35 L 60 15 L 80 20 L 100 5 L 100 40 Z" fill="currentColor" />
                    <path d="M0 40 L 20 30 L 40 35 L 60 15 L 80 20 L 100 5" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" />
                </svg>
            )
        },
    ];

    return (
        <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-8 -mx-4 px-4 md:grid md:grid-cols-2 lg:grid-cols-4 md:gap-6 md:pb-0 md:mx-0 md:px-0 no-scrollbar" data-drag-scroll="true">
            {metrics.map((metric, index) => (
                <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    viewport={{ once: true }}
                    className="relative group overflow-hidden rounded-2xl bg-white border border-border p-6 hover:shadow-xl hover:shadow-accent/5 transition-all duration-500 min-w-[70vw] md:min-w-0 snap-center flex flex-col justify-between h-[280px]"
                >
                    <div className="relative z-10">
                        <div className="text-4xl lg:text-5xl font-display font-bold text-accent mb-2 tracking-tight">
                            <Counter value={metric.value} />
                        </div>
                        <h3 className="text-lg font-medium text-foreground mb-2 leading-tight">
                            {metric.label}
                        </h3>
                        <p className="text-sm text-foreground-secondary group-hover:text-accent transition-colors duration-300">
                            {metric.context}
                        </p>
                    </div>

                    {/* Data Viz Graphic */}
                    <div className="mt-auto h-16 w-full opacity-60 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500">
                        {metric.chart}
                    </div>

                    {/* Hover Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-background-secondary/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                </motion.div>
            ))}
        </div>
    );
}
