// A real, scannable QR code as inline SVG (the design's checkerboard was a
// placeholder). Error correction M survives a projector's blur and glare.
import qrcode from './vendor/qrcode.mjs';

export function qrSvg(text, { dark = '#2D3142', light = '#FFFFFF', margin = 0 } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${text.replace(/[<>&"]/g, '')}">`
    + `<rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}

// "cgcmultimedia.com/live", the way people read it aloud.
export const shortUrl = url => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
