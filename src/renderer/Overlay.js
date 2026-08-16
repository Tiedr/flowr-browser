import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';

// Inline overlay — rendered directly in the app's DOM tree so it sits above the
// <webview> elements as normal siblings. Plain DOM + inline styles so
// backdrop-filter (real glassmorphism) works reliably. Driven entirely by the
// `overlay` prop set by App.
const ipc = window.electron?.ipcRenderer;

function hexA(hex, a) {
  if (!hex) return `rgba(20,24,34,${a})`;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const Ico = ({ name, size = 16, color }) => {
  const C = (name && Icons[name]) || Icons.Circle;
  return <C size={size} color={color} strokeWidth={1.75} />;
};

const REDUCE = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// A single tuned ease-out-expo drives every entrance so the whole app moves as one.
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const KEYFRAMES = `
@keyframes flowMenu { from { opacity: 0; transform: translateY(-10px) scale(0.965); } to { opacity: 1; transform: none; } }
@keyframes flowCtx  { from { opacity: 0; transform: translateY(-6px) scale(0.955); } to { opacity: 1; transform: none; } }
@keyframes flowDlg  { from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)) scale(0.965); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes flowFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes flowMenuOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-6px) scale(0.97); } }
@keyframes flowCtxOut  { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-4px) scale(0.97); } }
@keyframes flowDlgOut  { from { opacity: 1; transform: translate(-50%, -50%) scale(1); } to { opacity: 0; transform: translate(-50%, calc(-50% + 8px)) scale(0.97); } }
@keyframes flowFadeOut { from { opacity: 1; } to { opacity: 0; } }`;
const EXIT_MS = 150;
const anim = (name, dur = 220, fill = 'both') => REDUCE ? {} : { animation: `${name} ${dur}ms ${EASE} ${fill}` };
const keyStyle = { background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: 3, fontFamily: 'monospace' };

export default function Overlay({ overlay: s, onAction, onClose, onZoom, zoom }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  // Play the exit animation, fire the action, then clear once finished.
  const close = useCallback((fn) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    fn && fn();
    setTimeout(() => { onClose && onClose(); }, EXIT_MS + 30);
  }, [onClose]);
  const dismiss = useCallback(() => close(), [close]);

  useEffect(() => {
    if (document.getElementById('flow-kf')) return;
    const el = document.createElement('style');
    el.id = 'flow-kf';
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
  }, []);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // Reset closing state whenever a new overlay is shown.
  useEffect(() => { closingRef.current = false; setClosing(false); }, [s]);

  if (!s) return null;
  const t = s.theme || {};
  const dark = isDark(t.panel);
  const isDropdown = s.kind === 'dropdown';

  const fire = (item) => {
    if (item.disabled || item.type) return;
    close(() => onAction && onAction(item.action));
  };

  const glass = isDropdown ? {
    background: hexA(t.panel, dark ? 0.82 : 0.88),
    backdropFilter: REDUCE ? undefined : 'blur(30px) saturate(1.5)',
    WebkitBackdropFilter: REDUCE ? undefined : 'blur(30px) saturate(1.5)',
    border: `1px solid ${hexA(dark ? '#ffffff' : '#0b0e14', dark ? 0.12 : 0.1)}`,
    boxShadow: dark
      ? '0 16px 48px rgba(0,0,0,0.55), 0 2px 10px rgba(0,0,0,0.4)'
      : '0 16px 48px rgba(15,20,30,0.18), 0 2px 8px rgba(15,20,30,0.1)',
    borderRadius: 12
  } : {
    background: hexA(t.panel, dark ? 0.86 : 0.9),
    backdropFilter: REDUCE ? undefined : 'blur(30px) saturate(1.5)',
    WebkitBackdropFilter: REDUCE ? undefined : 'blur(30px) saturate(1.5)',
    border: `1px solid ${hexA(dark ? '#ffffff' : '#0b0e14', dark ? 0.09 : 0.08)}`,
    boxShadow: dark ? '0 14px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.32)' : '0 14px 40px rgba(15,20,30,0.15), 0 2px 6px rgba(15,20,30,0.08)',
    borderRadius: 12
  };

  const Item = (item, i) => {
    if (item.type === 'sep') return <div key={'s' + i} style={{ height: 1, margin: '6px 12px', background: hexA(t.border, dark ? 0.5 : 0.8) }} />;
    if (item.type === 'zoom') {
      const zb = { width: 34, height: 30, borderRadius: 9, border: `1px solid ${hexA(t.border, 0.8)}`, background: hexA(t.strong, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: t.text };
      const z = (dir) => { onZoom && onZoom(dir); };
      return (
        <div key={'z' + i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', height: 44 }}>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 650, color: t.text }}>Zoom</span>
          <div style={zb} onClick={() => z('out')}><Ico name="ZoomOut" size={15} color={t.text} /></div>
          <div style={{ minWidth: 46, textAlign: 'center', fontSize: 13, fontWeight: 750, color: t.text, cursor: 'pointer' }} onClick={() => z('reset')}>{Math.round((typeof zoom === 'number' ? zoom : 1) * 100)}%</div>
          <div style={zb} onClick={() => z('in')}><Ico name="ZoomIn" size={15} color={t.text} /></div>
        </div>
      );
    }
    return (
      <div key={item.label + i} onClick={() => fire(item)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, height: 37, padding: '0 12px', cursor: item.disabled ? 'default' : 'pointer', opacity: item.disabled ? 0.4 : 1, borderRadius: 7, margin: '0 6px', transition: 'background .12s' }}
        onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = hexA(dark ? '#ffffff' : t.accent, dark ? 0.07 : 0.09); }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
        {item.iconUrl
          ? <img src={item.iconUrl} width={18} height={18} style={{ borderRadius: 4 }} onError={e => { e.currentTarget.style.display = 'none'; }} />
          : <Ico name={item.icon} size={17} color={item.danger ? t.danger : t.muted} />}
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: item.danger ? t.danger : t.text }}>{item.label}</span>
        {item.hint ? <span style={{ fontSize: 11, color: t.faint, letterSpacing: 0.3 }}>{item.hint}</span> : null}
      </div>
    );
  };

  if (s.kind === 'dialog') {
    return (
      <div style={{ ...fill(hexA('#050912', 0.42), closing), backdropFilter: REDUCE ? undefined : 'blur(3px)', WebkitBackdropFilter: REDUCE ? undefined : 'blur(3px)' }} onMouseDown={dismiss}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 460, maxWidth: '90%', padding: 24, ...glass, borderRadius: 18, ...anim(closing ? 'flowDlgOut' : 'flowDlg', closing ? EXIT_MS : 260, closing ? 'forwards' : 'both') }} onMouseDown={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: t.text, letterSpacing: -0.2 }}>{s.title}</span>
            <div onClick={dismiss} style={{ cursor: 'pointer', padding: 5, borderRadius: 8, marginRight: -4, marginTop: -2, transition: 'background .14s' }}
              onMouseEnter={e => e.currentTarget.style.background = hexA(t.text, 0.08)} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><Ico name="X" size={17} color={t.muted} /></div>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: t.muted, maxWidth: '62ch' }}>{s.message}</div>
          {s.actions ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              {s.actions.map(a => (
                <div key={a.label} onClick={() => close(() => onAction && onAction(a.action))}
                  style={{ height: 40, padding: '0 18px', display: 'flex', alignItems: 'center', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: a.primary ? '#fff' : t.text, background: a.primary ? t.accent : hexA(t.strong, 0.6), border: a.primary ? 'none' : `1px solid ${hexA(t.border, 0.8)}`, transition: 'filter .14s' }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.08)'} onMouseLeave={e => e.currentTarget.style.filter = 'none'}>{a.label}</div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // Dropdowns (suggestions / extensions) render fixed at the address bar.
  if (isDropdown) {
    const pos = s.position || { x: 12, y: 84, width: 300 };
    const style = { position: 'absolute', left: pos.x, top: pos.y, width: pos.width, maxHeight: '70vh', overflowY: 'auto', borderRadius: 12, borderWidth: 0, overflow: 'hidden', ...glass, ...anim(closing ? 'flowMenuOut' : 'flowMenu', closing ? EXIT_MS : 210, closing ? 'forwards' : 'both') };

    if (s.type === 'suggestions') {
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'transparent' }} onMouseDown={e => { e.preventDefault(); dismiss(); }}>
          <div style={style} onMouseDown={e => e.stopPropagation()}>
            {s.items.map((item, i) => (
              <div key={item.url + i}
                onClick={() => { close(() => onAction && onAction({ kind: 'dd-click', url: item.url, type: item.type })); }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', borderBottom: `1px solid ${hexA(t.border, 0.3)}`, background: i === (s.selectedIdx || -1) ? hexA(t.accent, 0.14) : 'transparent', transition: 'background-color .1s' }}
                onMouseEnter={e => { if (i !== (s.selectedIdx || -1)) e.currentTarget.style.background = hexA(dark ? '#ffffff' : t.accent, dark ? 0.07 : 0.09); }}
                onMouseLeave={e => { if (i !== (s.selectedIdx || -1)) e.currentTarget.style.background = 'transparent'; }}
              >
                {item.favicon
                  ? <img src={item.favicon} width={16} height={16} style={{ borderRadius: 3, flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                  : item.type === 'bookmark' ? <Ico name="Star" size={14} color={t.accent} />
                  : item.type === 'search' ? <Ico name="Search" size={14} color={t.muted} />
                  : <Ico name="Globe" size={14} color={t.muted} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: t.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.displayUrl || ''}</div>
                </div>
                <div style={{ fontSize: 10, color: t.faint, flexShrink: 0 }}>{item.type === 'bookmark' ? 'Bookmark' : item.type === 'search' ? 'Search' : 'History'}</div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 12, padding: '8px 16px', borderTop: `1px solid ${hexA(t.border, 0.4)}`, fontSize: 11, color: t.muted }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={keyStyle}>↑↓</span><span>navigate</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={keyStyle}>↵</span><span>select</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={keyStyle}>Esc</span><span>close</span></div>
            </div>
          </div>
        </div>
      );
    }

    if (s.type === 'extensions') {
      return (
        <div style={{ position: 'fixed', inset: 0, background: 'transparent' }} onMouseDown={e => { e.preventDefault(); dismiss(); }}>
          <div style={style} onMouseDown={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${hexA(t.border, 0.5)}` }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Extensions</span>
              <div onClick={() => { close(() => onAction && onAction({ kind: 'dd-ext-settings' })); }}
                style={{ cursor: 'pointer', padding: 4, borderRadius: 6, transition: 'background .12s' }}
                onMouseEnter={e => e.currentTarget.style.background = hexA(t.text, 0.08)} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <Ico name="Settings" size={16} color={t.muted} />
              </div>
            </div>
            {(!s.items || s.items.length === 0) ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 14px' }}>
                <Ico name="Puzzle" size={24} color={t.faint} />
                <span style={{ color: t.muted, fontSize: 13 }}>No extensions installed</span>
              </div>
            ) : s.items.map(ext => (
              <div key={ext.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', transition: 'background-color .1s' }}
                onMouseEnter={e => e.currentTarget.style.background = hexA(dark ? '#ffffff' : t.accent, dark ? 0.05 : 0.06)}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'pointer' }}
                  onClick={() => { close(() => onAction && onAction({ kind: 'dd-ext-click', id: ext.id })); }}>
                  {ext.iconUrl
                    ? <img src={ext.iconUrl} width={28} height={28} style={{ borderRadius: 6, flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                    : <div style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hexA(t.accent, 0.15), flexShrink: 0 }}><Ico name="Puzzle" size={14} color={t.accent} /></div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ext.name}</div>
                    <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>{ext.sidePanel ? 'Side panel' : ext.popup ? 'Popup' : 'Options'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div onClick={() => onAction && onAction({ kind: 'dd-ext-toggle', id: ext.id, enabled: !ext.enabled })}
                    style={{ width: 28, height: 16, borderRadius: 8, position: 'relative', cursor: 'pointer', background: ext.enabled ? hexA(t.accent, 0.3) : hexA(t.strong, 0.5) }}>
                    <div style={{ width: 12, height: 12, borderRadius: 6, position: 'absolute', top: 2, left: 2, background: ext.enabled ? t.accent : t.muted, transform: `translateX(${ext.enabled ? 12 : 0}px)`, transition: 'transform .15s ease, background .15s ease' }} />
                  </div>
                  <div onClick={() => onAction && onAction({ kind: 'dd-ext-pin', id: ext.id, pinned: !ext.pinned })}
                    style={{ padding: 4, cursor: 'pointer' }}>
                    <Ico name="Pin" size={14} color={ext.pinned ? t.accent : t.muted} />
                  </div>
                </div>
              </div>
            ))}
            <div style={{ padding: '10px 14px', borderTop: `1px solid ${hexA(t.border, 0.5)}` }}>
              <div onClick={() => { close(() => onAction && onAction({ kind: 'dd-ext-manage' })); }}
                style={{ cursor: 'pointer', fontSize: 13, color: t.accent, transition: 'opacity .12s' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.8'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                Manage extensions
              </div>
            </div>
          </div>
        </div>
      );
    }
  }

  const W = s.width || 272;
  let pos, origin, kf;
  if (s.kind === 'context') {
    const vw = window.innerWidth, vh = window.innerHeight;
    const est = s.items.filter(i => i.type !== 'sep').length * 40 + s.items.filter(i => i.type === 'sep').length * 13 + 14;
    const flipX = s.x > vw - W - 10, flipY = s.y > vh - est - 10;
    pos = { left: Math.min(s.x, vw - W - 10), top: Math.min(s.y, vh - est - 10), width: W };
    origin = `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`;
    kf = 'flowCtx';
  } else {
    pos = { top: 84, right: 12, width: W };
    origin = 'top right';
    kf = 'flowMenu';
  }
  const outKf = s.kind === 'context' ? 'flowCtxOut' : 'flowMenuOut';
  const ctxGlass = s.kind === 'context' ? { ...glass, backdropFilter: 'none', WebkitBackdropFilter: 'none', background: hexA(t.panel, 0.96) } : glass;
  return (
    <div style={fill('transparent')} onMouseDown={dismiss}>
      <div style={{ position: 'absolute', ...pos, padding: '6px 0', maxHeight: '88vh', overflowY: 'auto', transformOrigin: origin, ...ctxGlass, ...anim(closing ? outKf : kf, closing ? EXIT_MS : 210, closing ? 'forwards' : 'both') }} onMouseDown={e => e.stopPropagation()}>
        {s.items.map(Item)}
      </div>
    </div>
  );
}

function fill(bg, closing) {
  return { position: 'fixed', inset: 0, background: bg, zIndex: 1400, ...(REDUCE ? {} : { animation: closing ? `flowFadeOut ${EXIT_MS}ms ${EASE} forwards` : `flowFade 160ms ${EASE} both` }) };
}
function isDark(hex) {
  if (!hex) return true;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum < 140;
}
