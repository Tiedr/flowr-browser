import React from 'react';
import { Image } from 'react-native';
import { Shield, Settings, Bookmark, FileText, History, Download, Puzzle, Globe } from 'lucide-react';
import logo from '../../flowricondark.png';
import vaultLogo from '../../vaultmark.png';

const ipc = window.electron?.ipcRenderer;

const CHROME_H = 92;
const BANNER_H = 60;
const FIND_H = 48;
const APP_VERSION = '1.0.10';
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const T_BG = { transitionProperty: 'background-color, border-color, opacity', transitionDuration: '160ms', transitionTimingFunction: EASE };
const HOVER = { hoverable: '1' };

// Accent color presets — user can pick any of these (or the theme default).
const ACCENT_PRESETS = [
  { id: 'blue', label: 'Blue', color: '#3268e6' },
  { id: 'purple', label: 'Purple', color: '#7a5fe0' },
  { id: 'teal', label: 'Teal', color: '#0ea5a1' },
  { id: 'green', label: 'Green', color: '#0e9d62' },
  { id: 'rose', label: 'Rose', color: '#e04670' },
  { id: 'orange', label: 'Orange', color: '#e67a32' },
  { id: 'slate', label: 'Slate', color: '#64748b' },
];

// Start page background presets — built-in images the user can choose from.
const START_BGS = [
  { id: 'none', label: 'None', thumb: null },
  // Gradients
  { id: 'gradient-midnight', label: 'Midnight', thumb: null, css: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #312e81 100%)' },
  { id: 'gradient-ember', label: 'Ember', thumb: null, css: 'linear-gradient(135deg, #1c1917 0%, #44403c 40%, #78350f 100%)' },
  { id: 'gradient-ocean', label: 'Ocean', thumb: null, css: 'linear-gradient(135deg, #042f2e 0%, #0d9488 50%, #164e63 100%)' },
  { id: 'gradient-aurora', label: 'Aurora', thumb: null, css: 'linear-gradient(135deg, #0f172a 0%, #2563eb 40%, #7c3aed 80%, #ec4899 100%)' },
  { id: 'gradient-forest', label: 'Forest', thumb: null, css: 'linear-gradient(135deg, #052e16 0%, #166534 50%, #15803d 100%)' },
  { id: 'gradient-sunset', label: 'Sunset', thumb: null, css: 'linear-gradient(135deg, #1e1b4b 0%, #be185d 50%, #f97316 100%)' },
  { id: 'gradient-snow', label: 'Snow', thumb: null, css: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #cbd5e1 100%)' },
  { id: 'gradient-paper', label: 'Paper', thumb: null, css: 'linear-gradient(135deg, #faf8f5 0%, #f0ece4 50%, #e8e0d0 100%)' },
  // Photo backgrounds (Unsplash free images)
  { id: 'photo-mountain', label: 'Mountain', thumb: null, css: 'linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.5)), url(https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80) center/cover no-repeat' },
  { id: 'photo-aurora', label: 'Northern Lights', thumb: null, css: 'linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.4)), url(https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1920&q=80) center/cover no-repeat' },
  { id: 'photo-ocean', label: 'Deep Ocean', thumb: null, css: 'linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.45)), url(https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1920&q=80) center/cover no-repeat' },
  { id: 'photo-forest', label: 'Forest Path', thumb: null, css: 'linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.4)), url(https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&q=80) center/cover no-repeat' },
  { id: 'photo-desert', label: 'Desert Dunes', thumb: null, css: 'linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.4)), url(https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=1920&q=80) center/cover no-repeat' },
  { id: 'photo-night', label: 'Night Sky', thumb: null, css: 'linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.35)), url(https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80) center/cover no-repeat' },
];

// Resolve a theme: base theme + optional accent color override.
function resolveTheme(themeId, accentId) {
  const base = THEMES[themeId] || THEMES.flow || THEMES.aurora;
  const preset = ACCENT_PRESETS.find(a => a.id === accentId);
  if (!preset) return base;
  // Derive accentSoft from the accent color (10% opacity overlay).
  return { ...base, accent: preset.color, accentSoft: preset.color + '1a' };
}

const THEMES = {
  flow: { id: 'flow', name: 'Flow', desc: 'Signature black and white.', bg: '#0f0f0f', chrome: '#171717', glass: '#1a1a1a', strong: '#222222', panel: '#181818', soft: '#141414', text: '#ededed', muted: '#888888', faint: '#555555', border: '#2a2a2a', accent: '#e0e0e0', accentSoft: '#1a1a1a', success: '#34d399', danger: '#f87171' },
  graphite: { id: 'graphite', name: 'Graphite', desc: 'Quiet, near-black focus.', bg: '#0b0d11', chrome: '#0f1116', glass: '#15181f', strong: '#1a1e26', panel: '#111318', soft: '#0e1015', text: '#e7e9ec', muted: '#878d97', faint: '#565b64', border: '#1e222a', accent: '#5c8cff', accentSoft: '#151b28', success: '#43c98a', danger: '#f06a71' },
  aurora: { id: 'aurora', name: 'Aurora', desc: 'Clean, quiet light.', bg: '#f6f7f9', chrome: '#fbfbfc', glass: '#ffffff', strong: '#ffffff', panel: '#ffffff', soft: '#f0f1f4', text: '#1b1e24', muted: '#646a74', faint: '#9aa0aa', border: '#e7e9ed', accent: '#3268e6', accentSoft: '#eef2fd', success: '#0e9d62', danger: '#d94a45' },
  linen: { id: 'linen', name: 'Linen', desc: 'Warm reading light.', bg: '#f4f1ea', chrome: '#f8f6f0', glass: '#fffdf9', strong: '#fffdf9', panel: '#fbf9f3', soft: '#efece4', text: '#232019', muted: '#6c655a', faint: '#a39b8d', border: '#e4dfd4', accent: '#7a5fe0', accentSoft: '#f0ecfb', success: '#0f7a54', danger: '#c04a3f' }
};

const ENGINES = {
  google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  bing: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`
};

const PAGES = {
  vault: { title: 'Tieddr Vault', icon: Shield },
  settings: { title: 'Settings', icon: Settings },
  bookmarks: { title: 'Bookmarks', icon: Bookmark },
  notes: { title: 'Notes', icon: FileText },
  history: { title: 'History', icon: History },
  downloads: { title: 'Downloads', icon: Download },
  extensions: { title: 'Extensions', icon: Puzzle }
};

function urlOf(v, s) {
  const q = (v || '').trim();
  if (!q) return 'about:blank';
  if (/^(https?:\/\/|file:\/\/|about:)/i.test(q)) return q;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(q) && !q.includes(' ')) return `https://${q}`;
  return (ENGINES[s.searchEngine] || ENGINES.google)(q);
}

function host(u) {
  try { return !u || u === 'about:blank' ? 'New Tab' : new URL(u).hostname.replace(/^www\./, ''); }
  catch { return u || 'New Tab'; }
}

function when(d) { return d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }

function bytes(n) { if (!n) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`; }

function trunc(t, n = 32) { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }

function storeIdOf(u) {
  try {
    const { hostname, pathname } = new URL(u);
    const isStore = /(^|\.)chromewebstore\.google\.com$/.test(hostname) || (/(^|\.)chrome\.google\.com$/.test(hostname) && pathname.includes('/webstore/'));
    if (!isStore || !/\/detail\//.test(pathname)) return null;
    const m = pathname.match(/[a-p]{32}/);
    return m ? m[0] : null;
  } catch { return null; }
}

const Brand = ({ size = 26, radius = 8 }) => <Image source={{ uri: logo }} style={{ width: size, height: size, borderRadius: radius }} />;

const TieddrMark = ({ size = 19, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="-20 -15 410 545" fill="none" aria-hidden="true">
    <path
      d="M1730.72,968.378C1869.11,960.502 1856.58,1095.15 1951.01,1251.4C2033.07,1387.18 1885.97,1570.49 1747.35,1570.95C1650.45,1571.28 1491,1491.99 1507.21,1334.17C1513.2,1275.89 1552.65,1225.8 1586.42,1188.81C1653.94,1114.85 1630.87,974.059 1730.72,968.378ZM1767.95,873.523C1784.84,840.545 1808.18,844.893 1825.58,833.22C1833.85,827.671 1813.01,863.073 1795.52,896.799C1778.46,929.692 1754.36,935.63 1738.43,936.46C1728.49,936.979 1751,906.607 1767.95,873.523Z"
      fill={color}
      transform="matrix(0.6928184,0,0,0.6928184,-1043.4257,-576.8616)"
    />
  </svg>
);

// The actual Tieddr Vault logo (pear-in-a-padlock badge + "Vault." wordmark),
// used to brand the built-in vault surface. Aspect ratio 785x206.
const VaultMark = ({ height = 22, dark = false }) => <Image source={{ uri: vaultLogo }} style={{ height, width: height * (785 / 206), resizeMode: 'contain', filter: dark ? 'brightness(0) invert(1)' : undefined }} />;

const TIEDDR_APPS = [
  { name: 'Space', tagline: 'Bookmarks, notes, to-dos & clipboard.', url: 'https://space.tieddr.com', icon: 'https://account.tieddr.com/logos/space.png' },
  { name: 'Vault', tagline: 'Passwords, sensitive info, two-factor codes.', url: 'https://vault.tieddr.com', icon: 'https://account.tieddr.com/logos/vault.png' },
  { name: 'Mavis', tagline: 'Your private, helpful Tieddr assistant.', url: 'https://mavis.tieddr.com', icon: 'https://account.tieddr.com/logos/mavis.png' },
  { name: 'Pages', tagline: 'A bio link page for all your links.', url: 'https://pages.tieddr.com' },
  { name: 'Moments', tagline: 'Your photos and videos, all in one place.', url: 'https://moments.tieddr.com', icon: 'https://account.tieddr.com/logos/moments.png' },
  { name: 'Krafti', tagline: 'A drag-and-drop app builder.', url: 'https://krafti.tieddr.com' }
];

function SiteIcon({ url, favicon, theme, size = 18 }) {
  const [err, setErr] = React.useState(false);
  const h = host(url);
  const uri = favicon || (h && h !== 'New Tab' ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(h)}&sz=64` : null);
  if (err || !uri) return <Globe size={size - 2} color={theme.accent} />;
  return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 4 }} onError={() => setErr(true)} />;
}

// Glassmorphism style presets — spread as inline styles.
const GLASS_LIGHT = { backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)' };
const GLASS_MEDIUM = { backdropFilter: 'blur(24px) saturate(200%)', WebkitBackdropFilter: 'blur(24px) saturate(200%)' };
const GLASS_HEAVY = { backdropFilter: 'blur(32px) saturate(220%)', WebkitBackdropFilter: 'blur(32px) saturate(220%)' };

export {
  ipc, CHROME_H, BANNER_H, FIND_H, APP_VERSION, EASE, T_BG, HOVER,
  THEMES, ACCENT_PRESETS, START_BGS, ENGINES, PAGES, TIEDDR_APPS,
  resolveTheme, urlOf, host, when, bytes, trunc, storeIdOf,
  Brand, TieddrMark, VaultMark, SiteIcon, GLASS_LIGHT, GLASS_MEDIUM, GLASS_HEAVY
};
