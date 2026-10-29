// Cor dos papéis (spec 7 de docs/design/fluxo.md). Único lugar com valores de cor de papel. Módulo puro.
// A ordem e o tamanho da paleta fazem parte do contrato: mudar qualquer um muda a cor de todos os papéis.

const P = (cor, tint, rgb) => Object.freeze({ cor, tint, rgb });
export const PALETTE = Object.freeze([
  P('#6D28D9', '#EDE9FE', '109 40 217'), // 0 violeta
  P('#3F6212', '#ECFCCB', '63 98 18'), // 1 oliva
  P('#BE185D', '#FCE7F3', '190 24 93'), // 2 rosa
  P('#0369A1', '#E0F2FE', '3 105 161'), // 3 celeste
  P('#4338CA', '#E0E7FF', '67 56 202'), // 4 índigo
  P('#0F766E', '#CCFBF1', '15 118 110'), // 5 verde-azulado
  P('#A21CAF', '#FAE8FF', '162 28 175'), // 6 fúcsia
  P('#1E3A8A', '#BFDBFE', '30 58 138'), // 7 marinho
  P('#1D4ED8', '#DBEAFE', '29 78 216'), // 8 azul
  P('#701A75', '#F5D0FE', '112 26 117'), // 9 ameixa
  P('#155E75', '#CFFAFE', '21 94 117'), // 10 petróleo
  P('#7E22CE', '#F3E8FF', '126 34 206'), // 11 roxo
]);

export const MIN_CONTRAST = 4.5;

/** FNV-1a de 32 bits sobre os bytes UTF-8 de `str`; resultado sem sinal. */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(String(str))) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Índice na paleta: hash de `name.trim().toLowerCase()` (nunca do `nome` ou da `sigla`). */
export function paletteIndex(name) {
  return fnv1a32(String(name).trim().toLowerCase()) % PALETTE.length;
}

/** Cor do papel pelo hash do nome. */
export function colorFor(name) {
  const { cor, tint, rgb } = PALETTE[paletteIndex(name)];
  return { cor, tint, rgb };
}

const toHex = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();

/** '#RGB' ou '#RRGGBB' -> [r,g,b], ou null. */
function parseHex(cor) {
  if (typeof cor !== 'string') return null;
  let m = /^#([0-9A-Fa-f]{6})$/.exec(cor);
  if (!m) {
    m = /^#([0-9A-Fa-f]{3})$/.exec(cor);
    if (!m) return null;
    m = [null, [...m[1]].map((c) => c + c).join('')];
  }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** Razão de contraste WCAG entre duas cores [r,g,b]. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Tint: o da paleta se a cor for da paleta; senão 12% da cor misturados com branco (spec 7.6). */
function tintOf(rgb) {
  const hex = toHex(rgb);
  const hit = PALETTE.find((p) => p.cor === hex);
  if (hit) return hit.tint;
  return toHex(rgb.map((c) => Math.round(255 - (255 - c) * 0.12)));
}

const WHITE = [255, 255, 255];
const minContrast = (rgb) => {
  const tint = parseHex(tintOf(rgb));
  return Math.min(contrast(rgb, WHITE), contrast(rgb, tint));
};

/**
 * Cor vinda da config. Aceita #RGB/#RRGGBB. Se não alcançar 4,5:1 sobre branco e sobre o próprio tint, escurece
 * em passos de 5% até alcançar. Retorna {cor, tint, rgb, ajuste}; `ajuste` é null ou {de, ratio, para}
 * (ratio = contraste da cor original que reprovou, truncado em 1 casa). Retorna null se a cor for inválida.
 */
export function fromHex(cor) {
  const orig = parseHex(cor);
  if (!orig) return null;
  let rgb = orig;
  let ajuste = null;
  if (minContrast(orig) < MIN_CONTRAST) {
    // O contraste informado é o sobre branco; se ele passar, o sobre o tint (spec 7.6: "#F59E0B (2,1:1)").
    const sobreBranco = contrast(orig, WHITE);
    const ratio = sobreBranco < MIN_CONTRAST ? sobreBranco : contrast(orig, parseHex(tintOf(orig)));
    for (let k = 1; k <= 20; k++) {
      rgb = orig.map((c) => Math.round(c * (1 - 0.05 * k)));
      if (minContrast(rgb) >= MIN_CONTRAST) break;
    }
    ajuste = { de: toHex(orig), ratio: Math.floor(ratio * 10) / 10, para: toHex(rgb) };
  }
  return { cor: toHex(rgb), tint: tintOf(rgb), rgb: rgb.join(' '), ajuste };
}
