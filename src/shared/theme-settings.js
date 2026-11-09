// Theme settings that both the renderer and the packaging audit have to agree
// on. Kept free of JSX and Electron imports so it can be required directly
// from Node-based checks as well as bundled into the app.
//
// This is the single source of truth for what a Flowr Store theme package is
// allowed to declare. The app validates incoming packages against the same
// tables the site audit validates published packages against, so the two can
// never drift into "the store publishes something the app silently drops".

const THEME_IDS = ['flow', 'graphite', 'aurora', 'linen'];
const ACCENT_PRESET_IDS = ['blue', 'purple', 'teal', 'green', 'rose', 'orange', 'slate'];
const BLUR_INTENSITIES = ['light', 'medium', 'heavy'];
const TAB_WIDTHS = ['compact', 'normal', 'wide'];
const TAB_FONT_SIZES = ['small', 'medium', 'large'];

const HEX_ACCENT = /^#[0-9a-f]{6}$/i;

// An accent is either a built-in preset id or a literal hex colour. Flowr Store
// packages ship hex; the in-app picker offers preset ids. Supporting only the
// latter is what silently dropped the accent of every published theme.
function resolveAccent(accentId) {
  const preset = ACCENT_PRESET_IDS.find(id => id === accentId);
  if (preset) return ACCENT_PRESETS[preset];
  const value = String(accentId == null ? '' : accentId);
  return HEX_ACCENT.test(value) ? value.toLowerCase() : null;
}

const ACCENT_PRESETS = {
  blue: '#3268e6',
  purple: '#7a5fe0',
  teal: '#0ea5a1',
  green: '#0e9d62',
  rose: '#e04670',
  orange: '#e67a32',
  slate: '#64748b'
};

// Validate the `settings` block of a theme package. Returns only the values
// the app is willing to apply; anything unknown, mistyped or out of range is
// dropped rather than written into the user's settings.
function sanitizeThemeSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  const enumValue = (value, allowed) => (typeof value === 'string' && allowed.includes(value) ? value : undefined);
  const boolValue = value => (typeof value === 'boolean' ? value : undefined);

  const theme = enumValue(raw.theme, THEME_IDS);
  if (theme !== undefined) out.theme = theme;

  const accent = resolveAccent(raw.accentColor);
  if (accent) out.accentColor = accent;

  const blur = enumValue(raw.blurIntensity, BLUR_INTENSITIES);
  if (blur !== undefined) out.blurIntensity = blur;

  const width = enumValue(raw.tabWidth, TAB_WIDTHS);
  if (width !== undefined) out.tabWidth = width;

  const fontSize = enumValue(raw.tabFontSize, TAB_FONT_SIZES);
  if (fontSize !== undefined) out.tabFontSize = fontSize;

  for (const key of ['glassToolbar', 'glassCards', 'glassSidebar']) {
    const value = boolValue(raw[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// Package ids become directory names on disk. Validate rather than sanitise:
// a character-class rewrite that keeps "." lets ".." escape its install folder.
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function isValidPackageId(id) {
  const value = String(id == null ? '' : id);
  return PACKAGE_ID.test(value) && !value.includes('..');
}

module.exports = {
  THEME_IDS,
  ACCENT_PRESET_IDS,
  ACCENT_PRESETS,
  BLUR_INTENSITIES,
  TAB_WIDTHS,
  TAB_FONT_SIZES,
  resolveAccent,
  sanitizeThemeSettings,
  isValidPackageId
};