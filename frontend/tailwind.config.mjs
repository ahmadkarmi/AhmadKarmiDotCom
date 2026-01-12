/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography';

export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Modern Light Theme - Swiss Style
                background: {
                    DEFAULT: 'hsl(var(--background))',
                    secondary: 'hsl(var(--background-secondary))',
                    tertiary: 'hsl(var(--background-tertiary))',
                },
                foreground: {
                    DEFAULT: 'hsl(var(--foreground))',
                    secondary: 'hsl(var(--foreground-secondary))',
                    muted: 'hsl(var(--foreground-muted))',
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))',
                    hover: 'hsl(var(--accent) / 0.9)',
                    subtle: 'hsl(var(--accent) / 0.1)',
                },
                border: {
                    DEFAULT: 'hsl(var(--border))',
                    secondary: 'hsl(var(--border-secondary))',
                },
            },
            fontFamily: {
                sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
                display: ['var(--font-display)', 'Playfair Display', 'serif'],
            },
            fontSize: {
                'display-xl': ['clamp(2.5rem, 5vw, 4.5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
                'display-lg': ['clamp(2rem, 4vw, 3.5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
                'display-md': ['clamp(1.75rem, 3vw, 2.75rem)', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
                'display-sm': ['clamp(1.25rem, 2vw, 2rem)', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
            },
            typography: (theme) => ({
                DEFAULT: {
                    css: {
                        maxWidth: '65ch',
                        color: theme('colors.foreground.secondary'),
                        h1: { fontFamily: theme('fontFamily.display'), color: theme('colors.foreground.DEFAULT') },
                        h2: { fontFamily: theme('fontFamily.display'), color: theme('colors.foreground.DEFAULT'), marginTop: '2em' },
                        h3: { fontFamily: theme('fontFamily.display'), color: theme('colors.foreground.DEFAULT') },
                        strong: { color: theme('colors.foreground.DEFAULT'), fontWeight: '600' },
                        a: { color: theme('colors.accent.DEFAULT'), '&:hover': { color: theme('colors.accent.hover') } },
                        blockquote: { borderLeftColor: theme('colors.accent.DEFAULT'), color: theme('colors.foreground.secondary') },
                    },
                },
                invert: {
                    css: {
                        color: theme('colors.foreground.secondary'), // Invert usually means dark mode, but we use 'invert' class manually?
                        // Actually, our theme is light mode default now. 'prose-invert' is for dark backgrounds.
                        // We are using 'prose-invert' in pages? Step 1040 shows 'prose-invert'.
                        // Wait, 'prose-invert' makes text WHITE.
                        // Our theme is LIGHT ('Warm Paper'). Text should be DARK.
                        // REMOVE 'prose-invert' from pages later if they are on light bg.
                        // But for now, lets define typography key.
                    },
                },
            }),
            animation: {
                'fade-in': 'fadeIn 0.5s ease-out forwards',
                'slide-up': 'slideUp 0.6s ease-out forwards',
                'scale-in': 'scaleIn 0.4s ease-out forwards',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(20px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                scaleIn: {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
            },
            backdropBlur: {
                xs: '2px',
            },
        },
    },
    plugins: [typography],
};
