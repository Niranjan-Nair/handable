import { PAGE_PPI } from '../options.js';
import { fmt, splineSegments } from './paths.js';
import { makeRng } from '../util.js';

// A sheet of paper: fine tooth lit from the top left, faint fibers and slightly
// uneven tone, with printed rules that pick up the same texture.
export function paperSVG(o) {
    const id = 'hw' + (o.idSuffix || '0') + 'paper';
    const W = o.width;
    const H = o.height;
    const seed = (o.grainSeed || 1) + 101;
    const out = [paperDefs(id, W, H, seed, o.scan)];

    out.push(
        o.scan
            ? `<g filter="url(#${id})"><rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="#fdfdfb"/>`
            : `<g filter="url(#${id})"><rect width="${W}" height="${H}" fill="#fcfaf3"/>`,
    );

    if (o.paper === 'lined' && o.page) out.push(o.scan ? scannedRules(id, o, seed) : printedRules(o));
    out.push(o.scan ? '</g>' : `</g><rect width="${W}" height="${H}" fill="url(#${id}v)"/>`);

    return out.join('');
}

// the paper's texture filter, and the vignette of an unscanned sheet
function paperDefs(id, W, H, seed, scan) {
    const lin = (r, g, b, k) =>
        `<feFuncR type="linear" slope="${k}" intercept="${r}"/><feFuncG type="linear" slope="${k}" intercept="${g}"/><feFuncB type="linear" slope="${k}" intercept="${b}"/>`;

    return (
        `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="-60" y="-60" width="${W + 120}" height="${H + 120}" color-interpolation-filters="sRGB">` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="${seed}" result="tooth"/>` +
        `<feDiffuseLighting in="tooth" surfaceScale="1.5" diffuseConstant="1" lighting-color="#ffffff" result="lit"><feDistantLight azimuth="235" elevation="60"/></feDiffuseLighting>` +
        `<feComponentTransfer in="lit" result="litc">${scan ? lin(0.91, 0.91, 0.905, 0.1) : lin(0.8, 0.8, 0.79, 0.25)}</feComponentTransfer>` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.012 0.16" numOctaves="2" seed="${seed + 1}" result="fib"/>` +
        `<feComponentTransfer in="fib" result="fibc">${scan ? lin(0.98, 0.98, 0.978, 0.035) : lin(0.965, 0.965, 0.96, 0.07)}</feComponentTransfer>` +
        `<feTurbulence type="fractalNoise" baseFrequency="0.0022" numOctaves="3" seed="${seed + 2}" result="mot"/>` +
        `<feComponentTransfer in="mot" result="motc">${lin(0.955, 0.95, 0.925, 0.1)}</feComponentTransfer>` +
        `<feBlend in="SourceGraphic" in2="litc" mode="multiply" result="a"/>` +
        `<feBlend in="a" in2="fibc" mode="multiply" result="b"/>` +
        `<feBlend in="b" in2="motc" mode="multiply" result="c"/>` +
        `<feComposite in="c" in2="SourceAlpha" operator="in"/>` +
        `</filter>` +
        `<radialGradient id="${id}v" cx="50%" cy="45%" r="75%"><stop offset="0.6" stop-color="#6b5a3a" stop-opacity="0"/><stop offset="1" stop-color="#6b5a3a" stop-opacity="0.07"/></radialGradient>` +
        `</defs>`
    );
}

const ruleWidth = () => Math.max(1, PAGE_PPI / 115); // ~0.22 mm, like printed ruling

// the y of every rule on a lined page
function ruleYs(o) {
    const ys = [];
    for (let y = o.page.top; y < o.height - o.page.bottom * 0.3; y += o.lineHeight * o.size) ys.push(y);

    return ys;
}

// clean, straight rules and margin line
function printedRules(o) {
    const lw = ruleWidth();
    const { width: W, height: H, page } = o;

    return (
        `<g stroke="#8cb0d8" stroke-width="${fmt(lw)}" opacity="0.8">` +
        ruleYs(o)
            .map((y) => `<line x1="0" y1="${fmt(y)}" x2="${W}" y2="${fmt(y)}"/>`)
            .join('') +
        '</g>' +
        `<line x1="${fmt(page.marginLine)}" y1="0" x2="${fmt(page.marginLine)}" y2="${H}" stroke="#e2928f" stroke-width="${fmt(lw)}" opacity="0.85"/>`
    );
}

// Printed ruling is never perfect: each rule sits a hair off, tilts and waves a
// little, and the ink is laid down unevenly (lighter and darker stretches,
// slightly thicker and thinner).
function scannedRules(id, o, seed) {
    const lw = ruleWidth();
    const { width: W, height: H, page } = o;
    const rng = makeRng(seed * 31 + 5);

    const wave = (amp) => {
        const k = 2 + Math.floor(rng() * 3);
        const ph = rng() * 6.28;
        const a = amp * (0.4 + rng() * 0.6);

        return (t) => a * Math.sin(ph + t * k * Math.PI) + a * 0.5 * Math.sin(ph * 1.7 + t * (k + 3) * Math.PI);
    };

    const rule = (x0, y0, x1, y1) => {
        const n = 16;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const f = wave(0.35);
        const tilt = (rng() - 0.5) * 2.2;
        const P = [];

        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const off = f(t) + tilt * (t - 0.5);
            P.push({ x: x0 + dx * t - (dy / len) * off, y: y0 + dy * t + (dx / len) * off });
        }

        return `M${fmt(P[0].x)} ${fmt(P[0].y)}` + splineSegments(P);
    };

    const out = [
        `<filter id="${id}r" filterUnits="userSpaceOnUse" x="-20" y="-20" width="${W + 40}" height="${H + 40}" color-interpolation-filters="sRGB">` +
            `<feTurbulence type="fractalNoise" baseFrequency="0.006 0.09" numOctaves="2" seed="${seed + 5}" result="n"/>` +
            `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0 0 0 0.5" result="d"/>` +
            `<feTurbulence type="fractalNoise" baseFrequency="0.03 0.2" numOctaves="1" seed="${seed + 6}" result="w"/>` +
            `<feDisplacementMap in="SourceGraphic" in2="w" scale="${fmt(lw * 1.1)}" xChannelSelector="R" yChannelSelector="G" result="s"/>` +
            `<feComposite in="s" in2="d" operator="in"/>` +
            `</filter>`,
        `<g filter="url(#${id}r)" fill="none"><g stroke="#8aa8d2" stroke-width="${fmt(lw * 1.5)}" opacity="0.8">`,
    ];

    for (const y of ruleYs(o)) {
        const yy = y + (rng() - 0.5) * 0.8;
        out.push(`<path d="${rule(-10, yy, W + 10, yy)}"/>`);
    }

    out.push('</g>');
    const mx = page.marginLine + (rng() - 0.5) * 2;
    const md = rule(mx, -10, mx, H + 10);

    out.push(
        `<path d="${md}" stroke="#f0c4c7" stroke-width="${fmt(lw * 3.6)}" opacity="0.7"/><path d="${md}" stroke="#de9aa0" stroke-width="${fmt(lw * 1.5)}" opacity="0.75"/></g>`,
    );

    return out.join('');
}

// the scan's effects on the writing alone (the same bend, softening and tone as
// scanOpen; its noise and shading belong to the paper underneath)
export function scanInkOpen(o, R) {
    const id = 'hw' + (o.idSuffix || '0') + 'scan';
    const W = o.width;
    const H = o.height;
    const seed = (o.grainSeed || 1) + 211;
    const px = PAGE_PPI / 192;
    const skew = scanSkew(o.grainSeed);

    return (
        `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="${R.x}" y="${R.y}" width="${R.w}" height="${R.h}" color-interpolation-filters="sRGB">` +
        `<feTurbulence type="fractalNoise" baseFrequency="${fmt(1.1 / W, 5)} ${fmt(0.8 / H, 5)}" numOctaves="2" seed="${seed}" result="bend"/>` +
        `<feDisplacementMap in="SourceGraphic" in2="bend" scale="${fmt(W * 0.008)}" xChannelSelector="R" yChannelSelector="G" result="bent"/>` +
        `<feGaussianBlur in="bent" stdDeviation="${fmt(0.85 * px)}" result="soft"/>` +
        `<feColorMatrix in="soft" type="matrix" values="0.9 0.08 0.02 0 0  0.04 0.94 0.02 0 0  0.04 0.06 0.92 0 0.012  0 0 0 1 0" result="c"/>` +
        `<feComponentTransfer in="c"><feFuncR type="table" tableValues="0 0.025 0.076 0.146 0.231 0.33 0.441 0.565 0.7 0.86 1"/><feFuncG type="table" tableValues="0 0.025 0.076 0.146 0.231 0.33 0.441 0.565 0.7 0.86 1"/><feFuncB type="table" tableValues="0 0.025 0.076 0.146 0.231 0.33 0.441 0.565 0.7 0.86 1"/></feComponentTransfer>` +
        `</filter></defs><g filter="url(#${id})"><g transform="rotate(${fmt(skew, 3)} ${fmt(W / 2)} ${fmt(H / 2)})">`
    );
}

// A scanned page. The sheet never lies quite flat on the glass, so the whole page
// (rules and writing together) is bent very slightly and shaded where it lifts
// away, and it's never laid down perfectly square. The scanner then softens
// everything (fine paper tooth and graphite grain are lost), adds a little noise
// of its own, and darkens the mid tones slightly.
// nobody lays a sheet on the glass perfectly square: a small tilt, a quarter to half a degree
export function scanSkew(grainSeed) {
    const r0 = makeRng(((grainSeed || 1) + 211) * 13 + 1)();

    return (r0 < 0.5 ? -1 : 1) * (0.2 + 0.3 * ((r0 * 2) % 1));
}
export function scanOpen(o) {
    const id = 'hw' + (o.idSuffix || '0') + 'scan';
    const W = o.width;
    const H = o.height;
    const seed = (o.grainSeed || 1) + 211;
    const px = PAGE_PPI / 192; // the page's own resolution, relative to the default
    const skew = scanSkew(o.grainSeed);

    return (
        `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">` +
        // a gentle bend: one or two slow waves across the page
        `<feTurbulence type="fractalNoise" baseFrequency="${fmt(1.1 / W, 5)} ${fmt(0.8 / H, 5)}" numOctaves="2" seed="${seed}" result="bend"/>` +
        `<feDisplacementMap in="SourceGraphic" in2="bend" scale="${fmt(W * 0.008)}" xChannelSelector="R" yChannelSelector="G" result="bent"/>` +
        `<feGaussianBlur in="bent" stdDeviation="${fmt(0.85 * px)}" result="soft"/>` +
        // scanner noise: soft blotches and a fine speckle, both faint
        `<feTurbulence type="fractalNoise" baseFrequency="${fmt(0.06 / px, 4)}" numOctaves="3" seed="${seed + 1}" result="m"/>` +
        `<feColorMatrix in="m" type="matrix" values="0.03 0 0 0 0.975  0.03 0 0 0 0.975  0.03 0 0 0 0.975  0 0 0 0 1" result="mc"/>` +
        `<feTurbulence type="fractalNoise" baseFrequency="${fmt(0.5 / px, 4)}" numOctaves="1" seed="${seed + 2}" result="f"/>` +
        `<feColorMatrix in="f" type="matrix" values="0.025 0 0 0 0.985  0.025 0 0 0 0.985  0.025 0 0 0 0.985  0 0 0 0 1" result="fc"/>` +
        `<feBlend in="soft" in2="mc" mode="multiply" result="a"/>` +
        `<feBlend in="a" in2="fc" mode="multiply" result="b"/>` +
        // scanner tone: a little cooler and less saturated; paper stays white while
        // mid tones (pencil, light ink) come out darker and bolder
        `<feColorMatrix in="b" type="matrix" values="0.9 0.08 0.02 0 0  0.04 0.94 0.02 0 0  0.04 0.06 0.92 0 0.012  0 0 0 1 0" result="c"/>` +
        `<feComponentTransfer in="c"><feFuncR type="table" tableValues="0 0.025 0.076 0.146 0.231 0.33 0.441 0.565 0.7 0.86 1"/><feFuncG type="table" tableValues="0 0.025 0.076 0.146 0.231 0.33 0.441 0.565 0.7 0.86 1"/><feFuncB type="table" tableValues="0 0.025 0.076 0.146 0.231 0.33 0.441 0.565 0.7 0.86 1"/></feComponentTransfer>` +
        `</filter></defs><g filter="url(#${id})"><g transform="rotate(${fmt(skew, 3)} ${fmt(W / 2)} ${fmt(H / 2)})">`
    );
}
export function scanClose(o) {
    const id = 'hw' + (o.idSuffix || '0') + 'scan';
    const W = o.width;
    const H = o.height;
    const rng = makeRng(((o.grainSeed || 1) + 223) * 97);
    // where the page lifts off the glass it's a little darker: along one side, and a
    // soft fall-off at the edges
    const side = Math.floor(rng() * 4);
    const dark = 0.03 + rng() * 0.03;

    const dir = [
        ['0', '0', '1', '0'],
        ['1', '0', '0', '0'],
        ['0', '0', '0', '1'],
        ['0', '1', '0', '0'],
    ][side];

    return (
        `</g></g><defs><linearGradient id="${id}l" x1="${dir[0]}" y1="${dir[1]}" x2="${dir[2]}" y2="${dir[3]}">` +
        `<stop offset="0" stop-color="#3c4250" stop-opacity="${fmt(dark, 3)}"/><stop offset="0.18" stop-color="#3c4250" stop-opacity="${fmt(dark * 0.25, 3)}"/><stop offset="0.5" stop-color="#3c4250" stop-opacity="0"/></linearGradient>` +
        `<radialGradient id="${id}e" cx="50%" cy="50%" r="72%"><stop offset="0.7" stop-color="#4a4d55" stop-opacity="0"/><stop offset="1" stop-color="#4a4d55" stop-opacity="0.035"/></radialGradient></defs>` +
        `<g style="mix-blend-mode:multiply"><rect width="${W}" height="${H}" fill="url(#${id}l)"/><rect width="${W}" height="${H}" fill="url(#${id}e)"/></g>`
    );
}
