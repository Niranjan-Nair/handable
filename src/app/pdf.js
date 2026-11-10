/*
 * Minimal PDF export for handwrite (browser only, no dependencies).
 *
 * Each page SVG is rendered to a canvas at print resolution (so pencil grain,
 * paper texture and ink effects come out exactly as on screen), encoded as JPEG
 * and embedded as a full-page image in a hand-written PDF 1.4 file.
 */
const enc = new TextEncoder();

async function rasterize(svg, pxW, pxH, scale) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.round(pxW * scale);
    c.height = Math.round(pxH * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// images: [{ bytes (JPEG), w, h }], page size in PDF points (1/72 in)
export function buildPDF(images, ptW, ptH) {
  const chunks = [];
  const offsets = [];
  let len = 0;
  const push = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(b);
    len += b.length;
  };
  const obj = (id, write) => {
    offsets[id] = len;
    push(`${id} 0 obj\n`);
    write();
    push('\nendobj\n');
  };
  const W = ptW.toFixed(2);
  const H = ptH.toFixed(2);
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`));
  images.forEach((im, i) => {
    const pid = 3 + i * 3;
    const cid = pid + 1;
    const iid = pid + 2;
    obj(pid, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${iid} 0 R >> >> /Contents ${cid} 0 R >>`,
      ),
    );
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(cid, () => {
      push(`<< /Length ${content.length} >>\nstream\n`);
      push(content);
      push('\nendstream');
    });
    obj(iid, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`,
      );
      push(im.bytes);
      push('\nendstream');
    });
  });
  const count = 3 + images.length * 3;
  const xref = len;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

/**
 * pages: SVG strings, all pxW × pxH. ptW/ptH: PDF page size in points.
 * scale: canvas pixels per SVG pixel. onProgress(done, total).
 */
export async function svgPagesToPDF(pages, { pxW, pxH, ptW, ptH, scale = 1.25, onProgress } = {}) {
  const images = [];
  for (let i = 0; i < pages.length; i++) {
    images.push(await rasterize(pages[i], pxW, pxH, scale));
    if (onProgress) onProgress(i + 1, pages.length);
  }
  return buildPDF(images, ptW, ptH);
}
