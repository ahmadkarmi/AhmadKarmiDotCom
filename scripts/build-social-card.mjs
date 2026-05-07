// Render the default social-share card from a brand-aligned SVG to a 1200x630
// PNG. Run once (or whenever the design changes) — the output PNG ships as a
// static asset and is referenced by BaseLayout as the default og:image fallback.
//
// Usage:
//   node scripts/build-social-card.mjs
//
// Reuses the sharp install from frontend/node_modules so we don't add a root
// dependency just for a one-time render.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const FRONTEND_NM = path.join(REPO_ROOT, 'frontend', 'node_modules');

// Resolve sharp from the frontend's node_modules (Astro depends on it for
// image optimization, so it's already there).
const requireFromFrontend = createRequire(path.join(FRONTEND_NM, 'package.json'));
const sharp = requireFromFrontend('sharp');

const W = 1200;
const H = 630;

// Brand tokens (mirrored from frontend/src/styles/global.css :root)
//   --background       hsl(36 20% 98%)  -> warm paper
//   --foreground       hsl(220 20% 10%) -> nearly black
//   --foreground-secondary hsl(220 10% 40%)
//   --accent           hsl(221 83% 53%) -> royal blue
//   --border           hsl(36 10% 85%)

const BG = '#fbf9f3';
const FG = '#13151a';
const FG_SECONDARY = '#5b6471';
const ACCENT = '#2664ec';
const RULE = '#dcd8cf';

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="dots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="${FG}" fill-opacity="0.05"/>
    </pattern>
  </defs>

  <!-- Warm paper background with subtle dot grid -->
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>

  <!-- Top-left brand mark: K.AI badge + label -->
  <g transform="translate(80, 80)">
    <circle cx="22" cy="22" r="22" fill="${ACCENT}"/>
    <text x="22" y="30" font-family="Playfair Display, Georgia, serif" font-size="24" font-weight="700" fill="white" text-anchor="middle">K</text>
    <text x="60" y="22" font-family="Playfair Display, Georgia, serif" font-size="22" font-weight="600" fill="${FG}">K.AI</text>
    <text x="60" y="44" font-family="Inter, system-ui, sans-serif" font-size="13" fill="${FG_SECONDARY}">Ahmad Al-Karmi's AI Assistant</text>
  </g>

  <!-- Hero: name -->
  <text x="80" y="335" font-family="Playfair Display, Georgia, serif" font-size="92" font-weight="700" fill="${FG}" letter-spacing="-2">Ahmad Al-Karmi</text>

  <!-- Tagline -->
  <text x="82" y="395" font-family="Inter, system-ui, sans-serif" font-size="28" font-weight="500" fill="${FG}" fill-opacity="0.78">Senior Product Manager. AI-focused.</text>
  <text x="82" y="432" font-family="Inter, system-ui, sans-serif" font-size="28" font-weight="500" fill="${FG}" fill-opacity="0.78">Loyalty and Growth at Al Jazeera.</text>

  <!-- Bottom: accent rule + URL -->
  <line x1="80" y1="538" x2="220" y2="538" stroke="${ACCENT}" stroke-width="3" stroke-linecap="round"/>
  <text x="80" y="578" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="600" fill="${FG}" letter-spacing="0.5">ahmadkarmi.com</text>

  <!-- Top-right: subtle decorative mark echoing the site's editorial feel -->
  <g transform="translate(${W - 130}, 80)">
    <line x1="0" y1="0" x2="50" y2="0" stroke="${RULE}" stroke-width="2"/>
    <line x1="0" y1="14" x2="50" y2="14" stroke="${RULE}" stroke-width="2"/>
    <line x1="0" y1="28" x2="32" y2="28" stroke="${ACCENT}" stroke-width="2"/>
  </g>
</svg>`;

const outDir = path.join(REPO_ROOT, 'frontend', 'public', 'brand');
await mkdir(outDir, { recursive: true });

// Save the SVG too (debug + alt asset).
await writeFile(path.join(outDir, 'social-card.svg'), svg, 'utf8');

await sharp(Buffer.from(svg))
  .resize(W, H, { fit: 'fill' })
  .png({ compressionLevel: 9, quality: 92 })
  .toFile(path.join(outDir, 'social-card.png'));

console.log(`Wrote ${path.join(outDir, 'social-card.png')} (${W}x${H})`);
console.log(`Wrote ${path.join(outDir, 'social-card.svg')}`);
