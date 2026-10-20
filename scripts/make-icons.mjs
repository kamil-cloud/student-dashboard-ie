// Renders the app icon (SVG) to the PNG sizes used by the extension and the installable website.
// Run once: node scripts/make-icons.mjs  (icons are committed in static/icons)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'icons');
const cap = (stroke) => `
  <g fill="none" stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z" fill="#ffffff" fill-opacity="0.2"/>
    <path d="M22 10v6"/>
    <path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>
  </g>`;
const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa2f0"/><stop offset="1" stop-color="#2356b8"/></linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>`;

/** Rounded tile with a little margin (toolbar, favicon, "any" purpose). */
const tile = (size) => {
  const m = size <= 32 ? 0 : size * 0.06;
  const s = size - 2 * m;
  const stroke = size <= 16 ? 2.6 : size <= 32 ? 2.2 : 1.8;
  const glyph = s * 0.64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}
    <rect x="${m}" y="${m}" width="${s}" height="${s}" rx="${s * 0.23}" fill="url(#bg)"/>
    <rect x="${m}" y="${m}" width="${s}" height="${s}" rx="${s * 0.23}" fill="url(#shine)"/>
    <g transform="translate(${m + (s - glyph) / 2} ${m + (s - glyph) / 2 + s * 0.02}) scale(${glyph / 24})">${cap(stroke)}</g></svg>`;
};
/** Full-bleed square, glyph inside the 60 % safe zone (Android adaptive icons). */
const maskable = (size) => {
  const glyph = size * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}
    <rect width="${size}" height="${size}" fill="url(#bg)"/>
    <g transform="translate(${(size - glyph) / 2} ${(size - glyph) / 2 + size * 0.015}) scale(${glyph / 24})">${cap(1.8)}</g></svg>`;
};

const jobs = [
  ...[16, 32, 48, 128, 192, 512].map((s) => [`icon-${s}.png`, tile(s), s]),
  ['maskable-512.png', maskable(512), 512],
  ['apple-touch-icon.png', maskable(180), 180],
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, svg, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: path.join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
fs.writeFileSync(path.join(OUT, 'icon.svg'), tile(512));
await browser.close();
console.log('icons written to', OUT);
