#!/usr/bin/env node
// tools/make-store-images.js — build the Chrome Web Store asset set from the repo's own
// captures, with no new dependencies (HTML + the Chrome already on this machine).
//
//   node tools/make-store-images.js
//
// Why this exists: the store has exact requirements the repo's screenshots do not meet.
//   - screenshots: 1280x800 or 640x400, square corners, full bleed (1-5 of them)
//   - small promo tile: 440x280 — REQUIRED
//   - marquee promo tile: 1400x560 — optional
//   - icon art: 96x96 inside a 128x128 PNG, with 16px of transparent padding per side
// Hand-cropping those once is how they silently go stale the next time the UI changes.
// Re-run this after any UI change and the whole set is current again.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(ROOT, 'docs/img');
const OUT = path.join(SHOTS, 'store');

// Palette shared with the owner's portfolio so the assets read as one brand.
const INK = '#12141a';
const PAPER = '#f7f4ef';
const BRONZE = '#c99a4e';
const GOLD = '#c99a4e';

fs.mkdirSync(OUT, { recursive: true });

// --- helpers -------------------------------------------------------------------------
// The frame is written INSIDE the repo so its relative image paths resolve.
function shoot(html, w, h, out, { transparent = false, frame = '.store-frame.html' } = {}) {
  const src = path.join(ROOT, frame);
  fs.writeFileSync(src, html, 'utf8');
  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, '--virtual-time-budget=5000',
  ];
  if (transparent) args.push('--default-background-color=00000000');
  args.push(`--screenshot=${out.replace(/\\/g, '/')}`, `file:///${src.replace(/\\/g, '/')}`);
  const r = spawnSync(CHROME, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  fs.rmSync(src, { force: true });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error(`screenshot failed: ${out}`);
  console.log(`  ${path.relative(ROOT, out).replace(/\\/g, '/')}  ${w}x${h}  ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
}

function frameHtml({ head, body, w, h, font = PAPER }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${w}px;height:${h}px;overflow:hidden;background:${INK};color:${font};
    font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
  </style></head><body>${head}${body}</body></html>`;
}

// --- 1. icons ------------------------------------------------------------------------
// A three-bar mark tapering downward: a list narrowing to what matters. At 16px three
// hairlines turn to mush, so that size drops to two thicker bars.
function iconHtml(canvas, art, bars) {
  const pad = (canvas - art) / 2;
  const rows = bars.map((b) => {
    const x = pad + (art - b.w) / 2;
    return `<rect x="${x}" y="${pad + b.y}" width="${b.w}" height="${b.h}" rx="${b.h / 2}" fill="${b.fill}"/>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;width:${canvas}px;height:${canvas}px;overflow:hidden}
  svg{display:block}</style></head><body>
  <svg width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${pad}" y="${pad}" width="${art}" height="${art}" rx="${art * 0.23}" fill="${INK}"/>
    ${rows}
  </svg></body></html>`;
}

console.log('icons (96x96 art in a 128x128 canvas, 16px transparent padding):');
shoot(iconHtml(128, 96, [
  { y: 27, h: 9, w: 56, fill: PAPER },
  { y: 44, h: 9, w: 37, fill: PAPER },
  { y: 61, h: 9, w: 19, fill: BRONZE },
]), 128, 128, path.join(ROOT, 'icons/128.png'), { transparent: true });
shoot(iconHtml(48, 36, [
  { y: 10, h: 3.4, w: 21, fill: PAPER },
  { y: 16.5, h: 3.4, w: 14, fill: PAPER },
  { y: 23, h: 3.4, w: 7, fill: BRONZE },
]), 48, 48, path.join(ROOT, 'icons/48.png'), { transparent: true });
shoot(iconHtml(16, 12, [
  { y: 3.4, h: 2, w: 8, fill: PAPER },
  { y: 6.6, h: 2, w: 4.5, fill: BRONZE },
]), 16, 16, path.join(ROOT, 'icons/16.png'), { transparent: true });

// --- 2. store screenshots (1280x800, full bleed) -------------------------------------
// Each job carries its complete filter chain, because the three shots need different
// treatment: the viewport captures are already 1280x800 and only need a normalising scale,
// while the single card is 2.75:1 and must be letterboxed onto the canvas instead of
// cover-cropped (cropping it slices the description off mid-sentence).
// No padding and no rounded corners appear in the final files — the letterbox IS the canvas.
console.log('\nstore screenshots (1280x800):');
const FIT = () => 'scale=1280:-2,pad=1280:800:0:(800-ih)/2:0x101010';
const SHOT_JOBS = [
  ['list-chip.png', 'scale=1280:800:force_original_aspect_ratio=increase,crop=1280:800', '01-list-1280x800.png'],
  ['panel-in-page.png', 'scale=1280:800:force_original_aspect_ratio=increase,crop=1280:800', '02-settings-1280x800.png'],
  ['card-detail.png', FIT(), '03-card-1280x800.png'],
];
for (const [src, chain, dst] of SHOT_JOBS) {
  ffmpeg(['-i', path.join(SHOTS, src), '-vf', chain, '-frames:v', '1', path.join(OUT, dst)]);
  console.log(`  docs/img/store/${dst}  1280x800  ${(fs.statSync(path.join(OUT, dst)).size / 1024).toFixed(1)} KB`);
}

// --- 3. small promo tile (440x280, required) -----------------------------------------
// Full-bleed screenshot with a dark gradient, so the tile stays legible at thumbnail size
// instead of cramming a headline beside a picture.
console.log('\npromo tiles:');
const eyebrow = `font-size:9px;font-weight:700;letter-spacing:.19em;text-transform:uppercase;color:${GOLD}`;
shoot(frameHtml({
  w: 440, h: 280,
  head: `<style>body{background:${INK}}</style>`,
  body: `
  <div style="position:absolute;inset:0;background:url('docs/img/list-chip.png') center/cover no-repeat"></div>
  <div style="position:absolute;inset:0;background:linear-gradient(100deg,rgba(13,15,20,.97) 0%,rgba(13,15,20,.90) 48%,rgba(13,15,20,.34) 100%)"></div>
  <div style="position:absolute;left:30px;top:54px;width:250px">
    <div style="${eyebrow}">OJ.ph Cleaner</div>
    <div style="margin-top:13px;font-family:Georgia,'Times New Roman',serif;font-size:31px;line-height:1.06;letter-spacing:-.02em">
      Stop reading<br>dead listings.
    </div>
    <div style="margin-top:15px;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.76)">
      Hides the stale, the unpaid and the keywords you hate. Highlights the ones worth your time.
    </div>
  </div>`,
}), 440, 280, path.join(OUT, 'promo-440x280.png'));

// --- 4. marquee promo tile (1400x560, optional) --------------------------------------
shoot(frameHtml({
  w: 1400, h: 560,
  head: `<style>body{background:${INK}}</style>`,
  body: `
  <div style="position:absolute;inset:0;background:radial-gradient(120% 140% at 88% 12%,rgba(201,154,78,.20),transparent 58%),radial-gradient(90% 120% at 6% 96%,rgba(48,92,140,.20),transparent 62%)"></div>
  <div style="position:absolute;left:76px;top:118px;width:560px">
    <div style="${eyebrow}">OJ.ph Cleaner</div>
    <div style="margin-top:20px;font-family:Georgia,'Times New Roman',serif;font-size:58px;line-height:1.04;letter-spacing:-.025em">
      Stop reading<br>dead listings.
    </div>
    <div style="margin-top:24px;font-size:17px;line-height:1.6;color:rgba(255,255,255,.74);max-width:520px">
      Hides the stale, the unpaid and the keywords you hate. Highlights the ones worth your time. Re-reads every listing in full when you ask it to.
    </div>
  </div>
  <div style="position:absolute;left:700px;top:64px;width:640px;height:432px;
    border:1px solid rgba(255,255,255,.16);border-radius:14px;overflow:hidden;
    box-shadow:0 40px 90px -30px rgba(0,0,0,.9)">
    <img src="docs/img/list-chip.png" style="width:100%;display:block">
  </div>`,
}), 1400, 560, path.join(OUT, 'marquee-1400x560.png'));

console.log('\ndone.');
