import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Image } from 'react-native';
import Overlay from './Overlay';
import {
  Accessibility, AlertCircle, ArrowLeft, ArrowRight, Ban, Bookmark, CheckCircle, ChevronRight, Clock, Cloud, Copy, CreditCard, Cpu,
  Download, ExternalLink, Eye, EyeOff, Folder, FolderInput, FolderOpen, FolderPlus, Gauge, Github, Globe, History, Home, Info, KeyRound, Languages, LayoutGrid, Lock,
  LogIn, LogOut, Menu, Minus, MoreHorizontal, Palette, Pause, Pin, Play, Plus, Puzzle, RotateCcw, Search, Settings, SlidersHorizontal,
  Shield, ShieldCheck, Sparkles, Square, Star, Trash2, User, UserCheck, Wallet, FileText, X, Youtube, RefreshCw,
  Camera, Mic, Bell, MapPin, Clipboard, MousePointer, BellOff, Cookie, Type, Film, Link2,
  Wifi, Globe2, Server, Monitor, Keyboard, HardDrive, Code2, Rocket, Zap,
  Mouse, PanelTop, PanelTopOpen, Maximize2, Minimize2, Layers, BookOpen, ZapOff,
  Fingerprint, Scan, Webhook, Database, Upload, GitBranch, Terminal,
  FileCode, GlobeLock, Hand, MessageSquare, Focus, Volume2,
  MonitorSpeaker, Network, Radar, Timer, ArrowUpCircle
} from 'lucide-react';

import { ipc, CHROME_H, BANNER_H, FIND_H, APP_VERSION, EASE, T_BG, HOVER, THEMES, ACCENT_PRESETS, START_BGS, ENGINES, PAGES, TIEDDR_APPS, resolveTheme, urlOf, host, when, bytes, trunc, storeIdOf, Brand, TieddrMark, VaultMark, SiteIcon, GLASS_LIGHT, GLASS_MEDIUM, GLASS_HEAVY } from './utils';

// Extension dropdown component (inline, absolute-positioned above webview)
function ExtensionDropdown({ position, items, theme, onClose, onExt, onSettings, onToggle, onPin }) {
  const [hoveredExt, setHoveredExt] = useState(null);
  const insideRef = useRef(false);
  
  useEffect(() => {
    const handler = () => {
      if (!insideRef.current) {
        onClose();
      }
      insideRef.current = false;
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  
  const style = position ? { position: 'absolute', left: position.x, top: position.y, width: position.width, zIndex: 1000 } : s.extDropdown;
  
  return (
    <View style={[style, { backgroundColor: theme.chrome, borderColor: theme.border }]} {...GLASS_HEAVY} onMouseDown={() => { insideRef.current = true; }}>
      <View style={[s.extDropdownHeader, { borderBottomColor: theme.border }]}>
        <Text style={[s.extDropdownTitle, { color: theme.text }]}>Extensions</Text>
        <TouchableOpacity onPress={onSettings}>
          <Settings size={16} color={theme.muted} />
        </TouchableOpacity>
      </View>
      
      <View style={{ maxHeight: 300 }}>
        {items.length === 0 ? (
          <View style={[s.extDropdownEmpty, { borderBottomColor: theme.border }]}>
            <Puzzle size={24} color={theme.faint} />
            <Text style={{ color: theme.muted, fontSize: 13 }}>No extensions installed</Text>
          </View>
        ) : (
          items.map(ext => (
            <View 
              key={ext.id}
              style={[s.extDropdownItem, hoveredExt === ext.id && { backgroundColor: theme.soft + '20' }]}
              onMouseEnter={() => setHoveredExt(ext.id)}
              onMouseLeave={() => setHoveredExt(null)}
            >
              <TouchableOpacity 
                style={s.extDropdownItemMain}
                onPress={() => { onExt(ext); onClose(); }}
              >
                {ext.iconUrl ? (
                  <Image source={{ uri: ext.iconUrl }} style={s.extDropdownIcon} />
                ) : (
                  <View style={[s.extDropdownIcon, { backgroundColor: theme.accentSoft }]}>
                    <Puzzle size={14} color={theme.accent} />
                  </View>
                )}
                <View style={s.extDropdownItemInfo}>
                  <Text style={[s.extDropdownItemName, { color: theme.text }]} numberOfLines={1}>
                    {ext.name}
                  </Text>
                  <Text style={[s.extDropdownItemDesc, { color: theme.muted }]} numberOfLines={1}>
                    {ext.sidePanel ? 'Side panel' : ext.popup ? 'Popup' : 'Options'}
                  </Text>
                </View>
              </TouchableOpacity>
              
              <View style={s.extDropdownActions}>
                <TouchableOpacity 
                  onPress={() => onToggle(ext.id, !ext.enabled)}
                  style={[s.extDropdownToggle, { backgroundColor: ext.enabled ? theme.accent + '30' : theme.strong }]}
                >
                  <View style={[s.extDropdownToggleDot, { 
                    backgroundColor: ext.enabled ? theme.accent : theme.muted,
                    transform: [{ translateX: ext.enabled ? 12 : 0 }]
                  }]} />
                </TouchableOpacity>
                
                <TouchableOpacity 
                  onPress={() => onPin(ext.id, !ext.pinned)}
                  style={s.extDropdownAction}
                >
                  <Pin size={14} color={ext.pinned ? theme.accent : theme.muted} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
      
      <View style={[s.extDropdownFooter, { borderTopColor: theme.border }]}>
        <TouchableOpacity onPress={onSettings} style={s.extDropdownFooterLink}>
          <Text style={{ color: theme.accent, fontSize: 13 }}>Manage extensions</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const I = ({ icon: Icon, label, onPress, theme, solid, disabled }) => (
  <TouchableOpacity title={label} accessibilityLabel={label} disabled={disabled} onPress={onPress} dataSet={disabled ? undefined : HOVER}
    style={[s.ib, T_BG, solid && { backgroundColor: theme.accentSoft }, disabled && { opacity: 0.3 }]}>
    <Icon size={16} strokeWidth={1.75} color={solid ? theme.accent : theme.muted} />
  </TouchableOpacity>
);

const Empty = ({ icon: Icon, title, detail, theme }) => (
  <View style={[s.empty, { backgroundColor: theme.soft, borderColor: theme.border }]}>
    <View style={[s.ei, { backgroundColor: theme.accentSoft }]}><Icon size={24} color={theme.accent} /></View>
    <Text style={[s.et, { color: theme.text }]}>{title}</Text>
    <Text style={[s.ed, { color: theme.muted }]}>{detail}</Text>
  </View>
);

const Head = ({ title, detail, theme }) => (
  <View style={s.head}>
    <Text style={[s.h1, { color: theme.text }]}>{title}</Text>
    {detail ? <Text style={[s.hd, { color: theme.muted }]}>{detail}</Text> : null}
  </View>
);

// Indeterminate loading sweep shown at the top of the page while a tab loads.
const LoadingBar = ({ theme }) => (
  <View style={s.loadbar} pointerEvents="none">
    <View dataSet={{ load: '1' }} style={[s.loadbarInner, { backgroundColor: theme.accent }]} />
  </View>
);

function FindBar({ text, setText, count, onNext, onPrev, onClose, theme }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus?.(); }, []);
  return (
    <View style={[s.find, { backgroundColor: theme.chrome + 'cc', borderBottomColor: theme.border + '60' }]} {...GLASS_MEDIUM}>
      <Search size={15} color={theme.faint} />
      <TextInput ref={ref} style={[s.findInput, { color: theme.text }]} value={text} onChangeText={setText}
        onSubmitEditing={onNext} placeholder="Find in page" placeholderTextColor={theme.faint} autoCapitalize="none" />
      <Text style={[s.findCount, { color: theme.muted }]}>{count.matches ? `${count.active}/${count.matches}` : (text ? '0/0' : '')}</Text>
      <I icon={ArrowLeft} label="Previous" onPress={onPrev} theme={theme} />
      <I icon={ArrowRight} label="Next" onPress={onNext} theme={theme} />
      <I icon={X} label="Close" onPress={onClose} theme={theme} />
    </View>
  );
}

const DEFAULT_DIALS = [
  { url: 'https://google.com', host: 'Google' }, { url: 'https://youtube.com', host: 'YouTube' },
  { url: 'https://github.com', host: 'GitHub' }, { url: 'https://mail.google.com', host: 'Gmail' },
  { url: 'https://x.com', host: 'X' }, { url: 'https://reddit.com', host: 'Reddit' }
];

function Start({ go, open, bookmarks, history, account, settings, theme }) {
  const [q, setQ] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(id); }, []);
  const hour = now.getHours();
  const greet = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = account && account.name ? account.name.split(' ')[0] : '';

  // Most-visited sites, ranked by frequency and deduped by host.
  const dials = useMemo(() => {
    const map = {}; const order = [];
    for (const h of history) {
      try {
        const u = new URL(h.url); const key = u.hostname.replace(/^www\./, '');
        if (!key) continue;
        if (!map[key]) { map[key] = { url: `${u.protocol}//${u.hostname}`, host: key, favicon: h.favicon, n: 0 }; order.push(key); }
        map[key].n++; if (h.favicon) map[key].favicon = h.favicon;
      } catch { /* skip */ }
    }
    const top = order.map(k => map[k]).sort((a, b) => b.n - a.n).slice(0, 8);
    return top.length >= 4 ? top : DEFAULT_DIALS;
  }, [history]);

  // Resolve the start page background.
  const bgPreset = START_BGS.find(b => b.id === (settings.startBackground || 'none'));
  const bgStyle = bgPreset && bgPreset.css
    ? { background: bgPreset.css }
    : { background: theme.id === 'aurora' || theme.id === 'linen'
      ? 'radial-gradient(circle at 50% 18%, rgba(122,165,31,0.14), transparent 34%), linear-gradient(145deg, #fafbf8 0%, #f1f3ed 48%, #e7ebe1 100%)'
      : 'radial-gradient(circle at 50% 16%, rgba(135,185,40,0.16), transparent 32%), linear-gradient(145deg, #171b18 0%, #0f1110 52%, #090b0a 100%)' };

  // Determine if the background is light or dark for contrast.
  const isLightBg = !bgPreset || bgPreset.id === 'none' ? (theme.id === 'aurora' || theme.id === 'linen')
    : ['gradient-snow', 'gradient-paper'].includes(bgPreset.id);

  return (
    <ScrollView style={[s.start, { backgroundColor: theme.bg }]} contentContainerStyle={s.startIn}>
      {/* Background layer */}
      <View style={[s.startBg, bgStyle]} pointerEvents="none" />

      {/* Profile card — shown when signed in */}
      {account ? (
        <View style={[s.startProfile, { backgroundColor: isLightBg ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)', borderColor: isLightBg ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)' }]} {...GLASS_LIGHT}>
          <View style={[s.startAvatar, { backgroundColor: isLightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)' }]}>
            {account.avatar ? <Image source={{ uri: account.avatar }} style={{ width: 36, height: 36, borderRadius: 18 }} /> : <User size={18} color={isLightBg ? '#666' : '#aaa'} />}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.startProfileName, { color: isLightBg ? '#1a1a1a' : '#eee' }]} numberOfLines={1}>{account.name || account.email || 'Tieddr Account'}</Text>
            <Text style={[s.startProfileSub, { color: isLightBg ? '#666' : '#888' }]} numberOfLines={1}>{account.email || 'Signed in'}</Text>
          </View>
          <TouchableOpacity onPress={() => open('vault')} style={[s.startProfileBtn, { backgroundColor: isLightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }]} dataSet={HOVER}>
            <Shield size={14} color={isLightBg ? '#555' : '#aaa'} />
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: isLightBg ? '#555' : '#aaa' }}>Vault</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Clock */}
      <View style={s.clockWrap}>
        <Text style={[s.clock, { color: isLightBg ? '#1a1a1a' : '#eee' }]}>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
        <Text style={[s.greet, { color: isLightBg ? '#555' : '#999' }]}>{greet}{first ? `, ${first}` : ''}</Text>
        <Text style={[s.startDate, { color: isLightBg ? '#777' : '#666' }]}>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
      </View>

      {/* Search bar — glass effect */}
      <View style={[s.startSearch, { backgroundColor: isLightBg ? 'rgba(255,255,255,0.85)' : 'rgba(30,30,30,0.8)', borderColor: isLightBg ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)', backdropFilter: 'blur(20px)' }]}>
        <Search size={18} color={isLightBg ? '#999' : '#666'} />
        <TextInput style={[s.startSearchInput, { color: isLightBg ? '#1a1a1a' : '#eee' }]} placeholder="Search the web or enter an address" placeholderTextColor={isLightBg ? '#999' : '#666'} value={q} onChangeText={setQ} onSubmitEditing={() => go(q)} autoCapitalize="none" />
        {q ? <TouchableOpacity onPress={() => { go(q); setQ(''); }}><ArrowRight size={16} color={isLightBg ? '#555' : '#aaa'} /></TouchableOpacity> : null}
      </View>

      {/* Speed dials */}
      <View style={s.startDials}>
        {dials.map(d => (
          <TouchableOpacity key={d.url} dataSet={HOVER} style={[s.startDial, { backgroundColor: isLightBg ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)', borderColor: isLightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }]} onPress={() => go(d.url)}>
            <View style={[s.startDialIcon, { backgroundColor: isLightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)' }]}><SiteIcon url={d.url} favicon={d.favicon} theme={theme} size={20} /></View>
            <Text style={[s.startDialLabel, { color: isLightBg ? '#555' : '#999' }]} numberOfLines={1}>{d.host}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Quick actions row */}
      <View style={s.startQuickRow}>
        {[
          { icon: Star, label: 'Bookmarks', page: 'bookmarks' },
          { icon: Clock, label: 'History', page: 'history' },
          { icon: Shield, label: 'Vault', page: 'vault' },
          { icon: Settings, label: 'Settings', page: 'settings' },
        ].map(a => (
          <TouchableOpacity key={a.page} dataSet={HOVER} style={[s.startQuick, { backgroundColor: isLightBg ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)', borderColor: isLightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }]} {...GLASS_LIGHT} onPress={() => open(a.page)}>
            <a.icon size={16} color={isLightBg ? '#555' : '#999'} />
            <Text style={[s.startQuickLabel, { color: isLightBg ? '#555' : '#999' }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bottom sections */}
      <View style={s.startCols}>
        <StartMini title="Bookmarks" action="View all" onAction={() => open('bookmarks')} rows={bookmarks.slice(0, 4)} icon={Star} empty="Star pages to keep them close." go={go} isLightBg={isLightBg} />
        <StartMini title="Recent" action="Open history" onAction={() => open('history')} rows={history.slice(0, 4)} icon={Clock} empty="Visited pages will appear here." go={go} isLightBg={isLightBg} />
      </View>

      {/* Flow branding */}
      <View style={s.startBranding}>
        <Brand size={18} radius={5} />
        <Text style={[s.startBrandText, { color: isLightBg ? '#ccc' : '#444' }]}>Flow Browser</Text>
      </View>
    </ScrollView>
  );
}

function StartMini({ title, action, onAction, rows, icon: Icon, empty, go, isLightBg }) {
  return (
    <View style={[s.startMini, { backgroundColor: isLightBg ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)', borderColor: isLightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }]} {...GLASS_LIGHT}>
      <View style={s.rowBetween}>
        <Text style={[s.startMiniTitle, { color: isLightBg ? '#333' : '#ccc' }]}>{title}</Text>
        <TouchableOpacity onPress={onAction}><Text style={[s.startMiniAction, { color: isLightBg ? '#555' : '#888' }]}>{action}</Text></TouchableOpacity>
      </View>
      {rows.length ? rows.map(x => (
        <TouchableOpacity key={`${x.url}-${x.date || ''}`} dataSet={HOVER} style={[s.startMiniRow]} onPress={() => go(x.url)}>
          <SiteIcon url={x.url} favicon={x.favicon} theme={{ accent: '#888' }} size={14} />
          <Text style={[s.startMiniText, { color: isLightBg ? '#444' : '#bbb' }]} numberOfLines={1}>{x.title || host(x.url)}</Text>
        </TouchableOpacity>
      )) : <Text style={[s.startMiniEmpty, { color: isLightBg ? '#bbb' : '#555' }]}>{empty}</Text>}
    </View>
  );
}

// Adaptive tabs: each flexes to share the bar and shrinks as more open. Tabs
// spring in on open and can be dragged to reorder (lift + live shuffle).
function Tabs({ tabs, active, onSwitch, onClose, onNew, onReorder, incognito, account, closingTabs, theme }) {
  const stripRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const suppress = useRef(false);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onDown = (e) => {
      if (e.button !== 0) return;
      const tabEl = e.target.closest?.('[data-tabid]');
      if (!tabEl || e.target.closest('[data-tabclose]')) return;
      const id = Number(tabEl.getAttribute('data-tabid'));
      dragRef.current = { id, startX: e.clientX, startIndex: tabs.findIndex(t => t.id === id), tabW: tabEl.getBoundingClientRect().width || 120, moved: false };
      const move = (ev) => {
        const d = dragRef.current; if (!d) return;
        const dx = ev.clientX - d.startX;
        if (Math.abs(dx) > 4) d.moved = true;
        const shift = Math.round(dx / d.tabW);
        const target = Math.max(0, Math.min(tabs.length - 1, d.startIndex + shift));
        const curIndex = tabs.findIndex(t => t.id === d.id);
        if (d.moved && target !== curIndex) { onReorder(d.id, target); d.startX = ev.clientX; d.startIndex = target; setDrag({ id: d.id, dx: 0 }); }
        else setDrag({ id: d.id, dx: Math.max(-d.tabW, Math.min(d.tabW, dx % d.tabW)) });
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (dragRef.current?.moved) { suppress.current = true; setTimeout(() => (suppress.current = false), 0); }
        dragRef.current = null; setDrag(null);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    strip.addEventListener('mousedown', onDown);
    return () => strip.removeEventListener('mousedown', onDown);
  }, [tabs, onReorder]);

  return (
    <View style={[s.tabs, { backgroundColor: theme.chrome }]}>
      {incognito
        ? <View style={[s.incPill, { backgroundColor: theme.text }]}><Lock size={11} color={theme.chrome} /><Text style={[s.incText, { color: theme.chrome }]}>Private</Text></View>
        : <View style={s.drag}>
            {account ? (
              <TouchableOpacity dataSet={HOVER} style={[s.tabAvatar, { backgroundColor: theme.accentSoft, borderColor: theme.border }]} onPress={() => {}} accessibilityLabel="Account">
                {account.avatar ? <Image source={{ uri: account.avatar }} style={{ width: 22, height: 22, borderRadius: 11 }} /> : <User size={12} color={theme.accent} />}
              </TouchableOpacity>
            ) : null}
          </View>
      }<View ref={stripRef} style={s.tstrip}>
        {tabs.map(t => {
          const a = t.id === active;
          const dragging = drag && drag.id === t.id;
          const page = t.kind !== 'web' ? PAGES[t.kind] : null;
          const PageIcon = page ? page.icon : null;
          return (
            <TouchableOpacity key={t.id} dataSet={{ tabid: t.id, tabenter: '1', tabclosing: closingTabs?.has(t.id) ? '1' : undefined, ...(a ? {} : { tab: '1' }) }}
              style={[s.tab, T_BG, a ? { backgroundColor: theme.strong, borderColor: theme.border } : { borderColor: 'transparent' },
                dragging && { transform: [{ translateX: drag.dx }, { scale: 1.04 }], zIndex: 6, backgroundColor: theme.strong, borderColor: theme.accent, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }]}
              onPress={() => { if (suppress.current) return; onSwitch(t.id); }}>
              {t.loading ? <View dataSet={{ spin: '1' }} style={s.spin}><RotateCcw size={13} color={theme.accent} /></View>
                : page ? <PageIcon size={14} color={a ? theme.accent : theme.faint} />
                  : t.favicon ? <Image source={{ uri: t.favicon }} style={s.fav} />
                    : <Globe size={14} color={a ? theme.accent : theme.faint} />}
              <Text style={[s.tt, { color: a ? theme.text : theme.muted }]} numberOfLines={1}>{page ? page.title : (t.title || host(t.url))}</Text>
              <TouchableOpacity dataSet={{ tabclose: '1', ...HOVER }} style={[s.close, T_BG]} onPress={e => { e.stopPropagation?.(); onClose(t.id); }}><X size={12} color={a ? theme.muted : theme.faint} /></TouchableOpacity>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity dataSet={HOVER} style={[s.newTab, T_BG]} onPress={onNew}><Plus size={16} color={theme.muted} /></TouchableOpacity>
      </View>
      <View style={s.win}>
        <I icon={Minus} label="Minimize" onPress={() => ipc?.send('window-control', 'minimize')} theme={theme} />
        <I icon={Square} label="Maximize" onPress={() => ipc?.send('window-control', 'maximize')} theme={theme} />
        <TouchableOpacity title="Close" onPress={() => ipc?.send('window-control', 'close')} dataSet={{ danger: '1' }} style={[s.ib, T_BG]}><X size={17} color={theme.muted} /></TouchableOpacity>
      </View>
    </View>
  );
}

function Nav({ tab, isWeb, loading, urlRef, go, back, forward, reload, home, menu, bookmark, bookmarked, pinnedExts, onExt, onExtPanel, bookmarks, history, theme, extPanelOpen, setExtPanelOpen, extActs, clickExt, openPage, toggleExtension, pinExt, showViewLive, urlWrapRef, input, setInput, focused, setFocused, selIdx, setSelIdx, clickingSuggestion, ddCooldownRef }) {
  const themeRef = useRef(theme); themeRef.current = theme;
  const prevSugsRef = useRef('');
  const ddOpenRef = useRef(false);
  useEffect(() => { setInput(isWeb && tab.url && tab.url !== 'about:blank' ? tab.url : ''); }, [tab.url, tab.id, isWeb]);

  const suggestions = useMemo(() => {
    if (!focused || !input.trim()) return [];
    const q = input.trim().toLowerCase();
    const seen = new Set();
    const results = [];
    for (const b of bookmarks || []) {
      const title = (b.title || '').toLowerCase();
      const url = (b.url || '').toLowerCase();
      if ((title.includes(q) || url.includes(q)) && !seen.has(b.url)) { results.push({ url: b.url, title: b.title || host(b.url), type: 'bookmark', favicon: b.favicon || null }); seen.add(b.url); }
      if (results.length >= 5) break;
    }
    for (const h of history || []) {
      const title = (h.title || '').toLowerCase();
      const url = (h.url || '').toLowerCase();
      if ((title.includes(q) || url.includes(q)) && !seen.has(h.url)) { results.push({ url: h.url, title: h.title || host(h.url), type: 'history', favicon: h.favicon || null }); seen.add(h.url); }
      if (results.length >= 8) break;
    }
    if (input.trim().length > 2) {
      results.push({ url: 'https://www.google.com/search?q=' + encodeURIComponent(input.trim()), title: 'Search for "' + input.trim() + '"', type: 'search', favicon: null });
    }
    return results.slice(0, 8);
  }, [input, focused, bookmarks, history]);

  const navigateSuggestion = useCallback((url) => { setInput(''); setFocused(false); go(url); }, [go]);

  const showInlineSuggestions = (focused && suggestions.length > 0);
  const showInlineExtPanel = extPanelOpen;

  return (
    <View style={{ position: 'relative', zIndex: 10 }}>
      <View style={[s.nav, { backgroundColor: theme.chrome }]}>
      <View style={s.navBtns}>
        <I icon={ArrowLeft} label="Back" onPress={back} theme={theme} />
        <I icon={ArrowRight} label="Forward" onPress={forward} theme={theme} />
        {loading
          ? <I icon={X} label="Stop" onPress={() => ipc?.send('view-command', 'stop')} theme={theme} />
          : <I icon={RotateCcw} label="Reload" onPress={reload} theme={theme} />}
        <I icon={Home} label="Home" onPress={home} theme={theme} />
      </View>
      <View style={s.urlWrap} ref={urlWrapRef}>
        <View style={[s.box, { backgroundColor: theme.strong, borderColor: focused ? theme.accent : theme.border }, showInlineSuggestions && !showViewLive && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
          {input.startsWith('https://') ? <Lock size={14} color={theme.success} /> : <Search size={14} color={theme.faint} />}
          <TextInput ref={urlRef} style={[s.url, { color: theme.text }]} value={input} onChangeText={v => { setInput(v); setSelIdx(-1); }}
            onFocus={() => setFocused(true)} onBlur={() => { if (!clickingSuggestion.current) setTimeout(() => setFocused(false), 150); }}
            onKeyDown={showInlineSuggestions ? (e) => {
              if (e.key === 'ArrowDown') { e.preventDefault?.(); setSelIdx(i => Math.min(i + 1, suggestions.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault?.(); setSelIdx(i => Math.max(i - 1, -1)); }
              else if (e.key === 'Enter' && selIdx >= 0) { e.preventDefault?.(); onNavigateSuggestion(suggestions[selIdx].url); }
              else if (e.key === 'Escape') { setFocused(false); }
            } : undefined}
            onSubmitEditing={() => go(input)} placeholder="Search or enter website" placeholderTextColor={theme.faint} selectTextOnFocus autoCapitalize="none" />
        </View>
        {showInlineSuggestions && !showViewLive ? (
          <View style={[s.suggestions, { backgroundColor: theme.chrome + 'ee', borderBottomColor: theme.border }]} {...GLASS_HEAVY}>
            {suggestions.map((sg, i) => (
<TouchableOpacity key={sg.url + i} style={[s.suggestionItem, { borderBottomColor: theme.border + '30' }, i === selIdx && { backgroundColor: theme.accentSoft }]} onPress={() => { clickingSuggestion.current = false; onNavigateSuggestion(sg.url); }} onMouseDown={() => { clickingSuggestion.current = true; }}>
                {sg.favicon ? <Image source={{ uri: sg.favicon }} style={s.suggestionIcon} /> : sg.type === 'bookmark' ? <Star size={14} color={theme.accent} /> : sg.type === 'search' ? <Search size={14} color={theme.muted} /> : <Globe size={14} color={theme.muted} />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, color: theme.text, fontWeight: '500' }} numberOfLines={1}>{sg.title}</Text>
                  <Text style={{ fontSize: 11, color: theme.muted, marginTop: 1 }} numberOfLines={1}>{host(sg.url)}</Text>
                </View>
                <Text style={{ fontSize: 10, color: theme.faint }}>{sg.type === 'bookmark' ? 'Bookmark' : sg.type === 'search' ? 'Search' : 'History'}</Text>
              </TouchableOpacity>
            ))}
            <View style={[s.suggestionHints, { borderTopColor: theme.border + '40', color: theme.muted }]}>
              <View style={s.suggestionHint}><Text style={s.suggestionKey}>↑↓</Text><Text>navigate</Text></View>
              <View style={s.suggestionHint}><Text style={s.suggestionKey}>↵</Text><Text>select</Text></View>
              <View style={s.suggestionHint}><Text style={s.suggestionKey}>Esc</Text><Text>close</Text></View>
            </View>
          </View>
        ) : null}
      </View>
      {pinnedExts.map(a => (
        <TouchableOpacity key={a.id} title={a.name} accessibilityLabel={a.name} dataSet={HOVER} style={[s.ib, T_BG]} onPress={e => onExt(a, e)}>
          {a.iconUrl ? <Image source={{ uri: a.iconUrl }} style={s.extIcon} /> : <Puzzle size={16} color={theme.muted} />}
        </TouchableOpacity>
      ))}
      <View style={{ position: 'relative' }}>
        <I icon={Puzzle} label="Extensions" onPress={onExtPanel} theme={theme} />
        {!showViewLive && showInlineExtPanel && (
          <ExtensionDropdown 
            items={extActs}
            theme={theme}
            onClose={() => setExtPanelOpen(false)}
            onExt={clickExt}
            onSettings={() => { openPage('extensions'); setExtPanelOpen(false); }}
            onToggle={(id, enabled) => toggleExtension(id, enabled)}
            onPin={pinExt}
          />
        )}
      </View>
<View style={[s.navDivider, { backgroundColor: theme.border }]} />
      <I icon={Star} label="Bookmark" onPress={bookmark} solid={bookmarked} theme={theme} />
      <I icon={MoreHorizontal} label="Menu" onPress={menu} theme={theme} />
    </View>
    {showViewLive && extPanelOpen && !ddCooldownRef.current && (
      <ExtensionDropdown 
        position={getExtPanelPos()}
        items={extActs}
        theme={theme}
        onClose={() => setExtPanelOpen(false)}
        onExt={clickExt}
        onSettings={() => { openPage('extensions'); setExtPanelOpen(false); }}
        onToggle={(id, enabled) => toggleExtension(id, enabled)}
        onPin={pinExt}
      />
    )}
  </View>
  );
}

function Row({ icon: Icon, site, title, sub, meta, onPress, actions, theme, tall }) {
  return (
    <TouchableOpacity disabled={!onPress} onPress={onPress} dataSet={onPress ? HOVER : undefined} style={[tall ? s.rowTall : s.dataRow, T_BG, { backgroundColor: theme.panel, borderColor: theme.border }]}>
      <View style={[s.ri, { backgroundColor: site ? theme.soft : theme.accentSoft }]}>{site ? <SiteIcon url={site.url} favicon={site.favicon} theme={theme} /> : <Icon size={18} color={theme.accent} />}</View>
      <View style={s.rb}>
        <Text style={[s.rt, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={[s.rs, { color: theme.muted }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {meta ? <Text style={[s.rm, { color: theme.faint }]}>{meta}</Text> : null}
      {actions}
    </TouchableOpacity>
  );
}

function Chip({ label, icon: Icon, active, onPress, theme }) {
  return (
    <TouchableOpacity onPress={onPress} dataSet={active ? undefined : HOVER} style={[s.chip, T_BG, { borderColor: theme.border }, active && { backgroundColor: theme.accentSoft, borderColor: theme.accent }]}>
      {Icon ? <Icon size={13} color={active ? theme.accent : theme.muted} /> : null}
      <Text style={[s.chipText, { color: active ? theme.accent : theme.text }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function BookmarksPage({ items, folders, go, remove, move, createFolder, theme, account }) {
  const [sel, setSel] = useState('all');
  const [nf, setNf] = useState('');
  const [picking, setPicking] = useState(null);
  const [view, setView] = useState('list');
  const [syncing, setSyncing] = useState(false);
  const shown = sel === 'all' ? items
    : sel === 'local' ? items.filter(b => b.source !== 'tieddr')
    : sel === 'synced' ? items.filter(b => b.source === 'tieddr')
    : sel === 'unfiled' ? items.filter(b => (b.folder || '') === '')
    : items.filter(b => (b.folder || '') === sel);
  const doSync = async () => { setSyncing(true); try { await ipc.invoke('sync-tieddr-bookmarks'); } catch (_) {} setSyncing(false); };
  const localCount = items.filter(b => b.source !== 'tieddr').length;
  const syncedCount = items.filter(b => b.source === 'tieddr').length;

  return (
    <>
      <Head title="Bookmarks" detail={`${items.length} bookmark${items.length === 1 ? '' : 's'}${syncedCount ? ` · ${syncedCount} synced from Tieddr Space` : ''}`} theme={theme} />
      <View style={[s.chipRow, { marginBottom: 6 }]}>
        <Chip label="All" icon={Bookmark} active={sel === 'all'} onPress={() => setSel('all')} theme={theme} />
        <Chip label="Local" icon={Globe} active={sel === 'local'} onPress={() => setSel('local')} theme={theme} />
        {syncedCount > 0 ? <Chip label="Synced" icon={Cloud} active={sel === 'synced'} onPress={() => setSel('synced')} theme={theme} /> : null}
        <Chip label="Unfiled" icon={Folder} active={sel === 'unfiled'} onPress={() => setSel('unfiled')} theme={theme} />
        {folders.map(f => <Chip key={f} label={f} icon={Folder} active={sel === f} onPress={() => setSel(f)} theme={theme} />)}
        <View style={[s.newFolder, { borderColor: theme.border }]}>
          <FolderPlus size={14} color={theme.faint} />
          <TextInput style={[s.newFolderInput, { color: theme.text }]} placeholder="New folder" placeholderTextColor={theme.faint} value={nf} onChangeText={setNf} onSubmitEditing={() => { if (nf.trim()) { createFolder(nf.trim()); setSel(nf.trim()); setNf(''); } }} />
        </View>
        <View style={{ flex: 1 }} />
        {account ? (
          <TouchableOpacity onPress={doSync} disabled={syncing} style={[s.syncBtn, { borderColor: theme.border, opacity: syncing ? 0.5 : 1 }]} dataSet={HOVER}>
            <RefreshCw size={13} color={theme.muted} style={syncing ? { transform: [{ rotate: '360deg' }] } : {}} />
            <Text style={{ fontSize: 12, color: theme.muted }}>{syncing ? 'Syncing\u2026' : 'Sync'}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => setView(v => v === 'list' ? 'grid' : 'list')} style={[s.syncBtn, { borderColor: theme.border }]} dataSet={HOVER}>
          {view === 'list' ? <LayoutGrid size={13} color={theme.muted} /> : <Menu size={13} color={theme.muted} />}
          <Text style={{ fontSize: 12, color: theme.muted }}>{view === 'list' ? 'Grid' : 'List'}</Text>
        </TouchableOpacity>
      </View>

      {view === 'grid' ? (
        <View style={s.bookmarkGrid}>
          {shown.map(x => (
            <TouchableOpacity key={x.url} onPress={() => go(x.url)} style={[s.bookmarkCard, { backgroundColor: theme.soft, borderColor: theme.border }]} dataSet={HOVER} {...GLASS_LIGHT}>
              <View style={[s.bookmarkCardIcon, { backgroundColor: theme.panel }]}>
                <SiteIcon url={x.url} favicon={x.favicon} size={20} />
              </View>
              <Text numberOfLines={1} style={[s.bookmarkCardTitle, { color: theme.text }]}>{x.title || host(x.url)}</Text>
              <Text numberOfLines={1} style={[s.bookmarkCardUrl, { color: theme.faint }]}>{host(x.url)}</Text>
              {x.source === 'tieddr' ? (
                <View style={[s.bookmarkCardBadge, { backgroundColor: theme.accentSoft }]}>
                  <Cloud size={9} color={theme.accent} />
                  <Text style={{ fontSize: 9, color: theme.accent, fontWeight: '600' }}>Synced</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        shown.map(x => (
          <View key={x.url}>
            <Row site={{ url: x.url, favicon: x.favicon }} title={x.title || host(x.url)} sub={x.url} onPress={() => go(x.url)} theme={theme}
              actions={<>
                {x.folder ? <View style={[s.folderTag, { backgroundColor: theme.soft }]}><Folder size={11} color={theme.muted} /><Text style={[s.folderTagText, { color: theme.muted }]} numberOfLines={1}>{x.folder}</Text></View> : null}
                {x.source === 'tieddr' ? (
                  <View style={[s.folderTag, { backgroundColor: theme.accentSoft }]} title="Synced from Tieddr Space">
                    <Cloud size={11} color={theme.accent} />
                    <Text style={[s.folderTagText, { color: theme.accent }]} numberOfLines={1}>Synced</Text>
                  </View>
                ) : (
                  <>
                    <I icon={FolderInput} label="Move to folder" onPress={() => setPicking(picking === x.url ? null : x.url)} theme={theme} solid={picking === x.url} />
                    <I icon={Trash2} label="Remove" onPress={() => remove(x.url)} theme={theme} />
                  </>
                )}
              </>} />
            {picking === x.url ? (
              <View style={[s.movePanel, { backgroundColor: theme.soft, borderColor: theme.border }]}>
                <Text style={[s.moveLabel, { color: theme.muted }]}>Move to</Text>
                <Chip label="Unfiled" icon={Folder} active={!x.folder} onPress={() => { move(x.url, ''); setPicking(null); }} theme={theme} />
                {folders.map(f => <Chip key={f} label={f} icon={Folder} active={x.folder === f} onPress={() => { move(x.url, f); setPicking(null); }} theme={theme} />)}
                {!folders.length ? <Text style={[s.rs, { color: theme.faint }]}>Create a folder above first.</Text> : null}
              </View>
            ) : null}
          </View>
        ))
      )}

      {!shown.length ? <Empty icon={Bookmark} title={sel === 'all' ? 'No bookmarks yet' : 'This folder is empty'} detail={sel === 'all' ? 'Use the star in the toolbar to save the current page.' : 'Move bookmarks here with the folder button.'} theme={theme} /> : null}
    </>
  );
}

// Read-only mirror of Tieddr Space notes — content is synced as plain text
// (see /api/sync/notes), so there's no rich-text editor here, and nothing
// created/edited here writes back to Space. Tap a note to expand its full
// text inline, same interaction shape as BookmarksPage's move-to-folder panel.
function NotesPage({ items, folders, theme }) {
  const [sel, setSel] = useState('all');
  const [open, setOpen] = useState(null);
  const shown = sel === 'all' ? items : items.filter(n => (n.folder || '') === (sel === 'unfiled' ? '' : sel));
  return (
    <>
      <Head title="Notes" detail="Read-only mirror of your Tieddr Space notes, organized into folders." theme={theme} />
      <View style={s.chipRow}>
        <Chip label="All" icon={FileText} active={sel === 'all'} onPress={() => setSel('all')} theme={theme} />
        <Chip label="Unfiled" icon={Folder} active={sel === 'unfiled'} onPress={() => setSel('unfiled')} theme={theme} />
        {folders.map(f => <Chip key={f} label={f} icon={Folder} active={sel === f} onPress={() => setSel(f)} theme={theme} />)}
      </View>
      {shown.length ? shown.map(x => (
        <View key={x.tieddrId}>
          <Row icon={FileText} title={x.title} sub={trunc(x.text, 80) || 'Empty note'} onPress={() => setOpen(open === x.tieddrId ? null : x.tieddrId)} theme={theme}
            actions={<>
              {x.folder ? <View style={[s.folderTag, { backgroundColor: theme.soft }]}><Folder size={11} color={theme.muted} /><Text style={[s.folderTagText, { color: theme.muted }]} numberOfLines={1}>{x.folder}</Text></View> : null}
              <View style={[s.folderTag, { backgroundColor: theme.accentSoft }]} title="Synced from Tieddr Space">
                <Cloud size={11} color={theme.accent} />
                <Text style={[s.folderTagText, { color: theme.accent }]} numberOfLines={1}>Synced</Text>
              </View>
            </>} />
          {open === x.tieddrId ? (
            <View style={[s.movePanel, { backgroundColor: theme.soft, borderColor: theme.border }]}>
              <Text style={{ color: theme.text, fontSize: 13.5, lineHeight: 20 }}>{x.text || 'This note is empty.'}</Text>
            </View>
          ) : null}
        </View>
      )) : <Empty icon={FileText} title={sel === 'all' ? 'No notes yet' : 'This folder is empty'} detail="Sign in with Tieddr Account to sync notes from Tieddr Space." theme={theme} />}
    </>
  );
}

// Group history entries by day for a scannable timeline.
function historyGroups(items) {
  const now = new Date(); const today = now.toDateString();
  const yest = new Date(now.getTime() - 864e5).toDateString();
  const groups = []; const byKey = {};
  for (const x of items) {
    const d = x.date ? new Date(x.date) : now;
    const ds = d.toDateString();
    const label = ds === today ? 'Today' : ds === yest ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if (!byKey[label]) { byKey[label] = []; groups.push([label, byKey[label]]); }
    byKey[label].push(x);
  }
  return groups;
}

function HistoryPage({ items, go, clear, theme }) {
  const groups = historyGroups(items);
  return (
    <>
      <View style={s.topline}>
        <Head title="History" detail="Recent pages for this profile." theme={theme} />
        {items.length ? <Action icon={Trash2} text="Clear history" onPress={clear} theme={theme} danger /> : null}
      </View>
      {items.length ? groups.map(([label, rows]) => (
        <View key={label} style={{ marginBottom: 8 }}>
          <Text style={[s.dayHeader, { color: theme.faint }]}>{label}</Text>
          {rows.map(x => (
            <Row key={`${x.url}-${x.date}`} site={{ url: x.url, favicon: x.favicon }} title={x.title || host(x.url)} sub={x.url}
              meta={x.date ? new Date(x.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''} onPress={() => go(x.url)} theme={theme} />
          ))}
        </View>
      )) : <Empty icon={History} title="History is empty" detail="Pages you visit will appear here." theme={theme} />}
    </>
  );
}

function DownloadsPage({ items, clear, theme }) {
  return (
    <>
      <View style={s.topline}>
        <Head title="Downloads" detail="Active and completed file downloads." theme={theme} />
        {items.length ? <Action icon={Trash2} text="Clear list" onPress={clear} theme={theme} danger /> : null}
      </View>
      {items.length ? items.map(x => {
        const pct = x.totalBytes ? Math.min(100, Math.round(x.receivedBytes / x.totalBytes * 100)) : 0;
        return (
          <View key={x.id} style={[s.download, { backgroundColor: theme.panel, borderColor: theme.border }]}>
            <View style={[s.ri, { backgroundColor: theme.accentSoft }]}><Download size={18} color={theme.accent} /></View>
            <View style={s.rb}>
              <Text style={[s.rt, { color: theme.text }]} numberOfLines={1}>{x.filename}</Text>
              <Text style={[s.rs, { color: theme.muted }]}>{x.state} · {bytes(x.receivedBytes)} of {bytes(x.totalBytes)}</Text>
              <View style={[s.track, { backgroundColor: theme.soft }]}><View style={[s.fillbar, { backgroundColor: theme.accent, width: `${pct}%` }]} /></View>
            </View>
            {x.state === 'progressing' ? <I icon={Pause} label="Pause" onPress={() => ipc.invoke('pause-download', x.id)} theme={theme} /> : null}
            {x.state === 'paused' ? <I icon={Play} label="Resume" onPress={() => ipc.invoke('resume-download', x.id)} theme={theme} /> : null}
            {['progressing', 'paused'].includes(x.state) ? <I icon={Ban} label="Cancel" onPress={() => ipc.invoke('cancel-download', x.id)} theme={theme} /> : null}
            {x.path ? <I icon={FolderOpen} label="Show in folder" onPress={() => ipc.invoke('show-in-folder', x.path)} theme={theme} /> : null}
          </View>
        );
      }) : <Empty icon={Download} title="No downloads" detail="Downloads will show progress here." theme={theme} />}
    </>
  );
}

function StoreBanner({ onGet, busy, theme }) {
  return (
    <View style={[s.banner, { backgroundColor: theme.accentSoft, borderBottomColor: theme.border }]}>
      <View style={[s.bicon, { backgroundColor: theme.strong }]}><Puzzle size={17} color={theme.accent} /></View>
      <View style={s.rb}>
        <Text style={[s.rt, { color: theme.text }]} numberOfLines={1}>Add this Chrome extension to Flow</Text>
        <Text style={[s.rs, { color: theme.muted }]} numberOfLines={1}>Flow downloads and unpacks it for you — nothing to do manually.</Text>
      </View>
      <TouchableOpacity style={[s.getBtn, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]} disabled={busy} onPress={onGet}>
        {busy ? <RotateCcw size={15} color="#fff" /> : <Download size={15} color="#fff" />}
        <Text style={s.getText}>{busy ? 'Adding…' : 'Get'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ExtensionsPage({ items, acts, install, installStore, busy, remove, toggle, onPin, onSidePanel, theme }) {
  const [q, setQ] = useState('');
  const add = () => { const v = q.trim(); if (v && !busy) { installStore(v); setQ(''); } };
  const actOf = id => (acts || []).find(a => a.id === id);
  return (
    <>
      <View style={s.topline}>
        <Head title="Extensions" detail={`${items.length} extension${items.length === 1 ? '' : 's'} installed. Add from the Chrome Web Store or load unpacked.`} theme={theme} />
        <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border }]} onPress={install} dataSet={HOVER}>
          <FolderOpen size={16} color={theme.accent} /><Text style={[s.actionText, { color: theme.accent }]}>Load unpacked</Text>
        </TouchableOpacity>
      </View>
      <View style={[s.card, { backgroundColor: theme.panel, borderColor: theme.border }]}>
        <View style={s.cardHead}><Puzzle size={19} color={theme.accent} /><Text style={[s.pt, { color: theme.text }]}>Add from Chrome Web Store</Text></View>
        <Text style={[s.rs, { color: theme.muted, marginBottom: 12, lineHeight: 19 }]}>Paste a Chrome Web Store link or extension ID. Flow fetches the extension, unpacks it in the background, and enables it — no manual download or folder picking.</Text>
        <View style={[s.inline, { borderColor: theme.border }]}>
          <TextInput style={[s.inlineInput, { color: theme.text }]} placeholder="https://chromewebstore.google.com/detail/\u2026" placeholderTextColor={theme.faint} value={q} onChangeText={setQ} onSubmitEditing={add} autoCapitalize="none" editable={!busy} />
          <TouchableOpacity style={[s.small, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]} disabled={!!busy} onPress={add}><Text style={s.smallText}>{busy ? 'Adding\u2026' : 'Get'}</Text></TouchableOpacity>
        </View>
      </View>
      {items.length ? items.map(x => {
        const act = actOf(x.id);
        return (
        <Row key={`${x.id}-${x.path}`} tall icon={Puzzle} site={act?.iconUrl ? { favicon: act.iconUrl } : undefined} title={x.name}
          sub={x.error || `${x.source === 'store' ? 'Chrome Web Store' : 'Unpacked'} \u00B7 v${x.version || '?'}${act?.sidePanel ? ' \u00B7 Side panel' : ''}${act?.popup ? ' \u00B7 Popup' : ''}${act?.options ? ' \u00B7 Options' : ''}`}
          theme={theme}
          actions={<>
            {x.enabled && act?.sidePanel ? <I icon={PanelTopOpen} label="Side panel" onPress={() => onSidePanel(act)} theme={theme} /> : null}
            {x.enabled && act?.options ? <I icon={SlidersHorizontal} label="Options" onPress={() => ipc?.send('open-extension-options', act.options)} theme={theme} /> : null}
            {x.enabled ? <I icon={Pin} label={act?.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'} solid={act?.pinned} onPress={() => onPin(x.id, !act?.pinned)} theme={theme} /> : null}
            <TouchableOpacity dataSet={HOVER} style={[s.pill, T_BG, { backgroundColor: x.enabled ? theme.accentSoft : theme.soft }]} onPress={() => toggle(x.id, !x.enabled)}>
              {x.enabled ? <CheckCircle size={14} color={theme.success} /> : <AlertCircle size={14} color={theme.faint} />}
              <Text style={[s.pillText, { color: x.enabled ? theme.success : theme.muted }]}>{x.enabled ? 'Enabled' : 'Disabled'}</Text>
            </TouchableOpacity>
            <I icon={Trash2} label="Remove" onPress={() => remove(x.id)} theme={theme} />
          </>} />
        );
      }) : <Empty icon={Puzzle} title="No extensions yet" detail="Add one from the Chrome Web Store above, or load an unpacked folder." theme={theme} />}
    </>
  );
}

const SET_SECTIONS = [
  { id: 'account', label: 'Account', icon: TieddrMark },
  { id: 'privacy', label: 'Privacy & Security', icon: Shield },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'tabs', label: 'Tabs & Startup', icon: Layers },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'languages', label: 'Languages & Accessibility', icon: Languages },
  { id: 'data', label: 'Data & Storage', icon: HardDrive },
  { id: 'extensions', label: 'Extensions', icon: Puzzle },
  { id: 'developer', label: 'Developer', icon: Code2 },
  { id: 'system', label: 'System', icon: Cpu },
  { id: 'updates', label: 'Updates', icon: Rocket },
  { id: 'about', label: 'About', icon: Info },
  { id: 'reset', label: 'Reset', icon: RotateCcw }
];
const SEC = Object.fromEntries(SET_SECTIONS.map(x => [x.id, x]));
const SET_GROUPS = [
  { label: 'Account', ids: ['account'] },
  { label: 'Privacy & Security', ids: ['privacy'] },
  { label: 'Performance', ids: ['performance'] },
  { label: 'Browser', ids: ['tabs', 'appearance', 'languages'] },
  { label: 'Data & System', ids: ['data', 'developer', 'system', 'updates'] },
  { label: 'Manage', ids: ['extensions', 'reset', 'about'] }
];
const SEC_HINT = {
  account: 'Sign in and manage profiles',
  privacy: 'Passwords, tracking, permissions, and security',
  performance: 'Memory, graphics, and network',
  tabs: 'Tab behavior, startup, and session',
  appearance: 'Theme, colors, address bar, and search',
  languages: 'Display language and accessibility',
  data: 'Downloads, cache, and storage',
  extensions: 'Manage add-ons',
  developer: 'DevTools, shortcuts, and debugging',
  system: 'Background and hardware',
  updates: 'Auto-updates and channels',
  about: 'Version and info',
  reset: 'Restore defaults'
};

function PasswordRow({ p, onReveal, onCopy, onDelete, theme }) {
  const [shown, setShown] = useState(false);
  const [pw, setPw] = useState('');
  const toggle = async () => { if (!shown) setPw(await onReveal(p.origin, p.username)); setShown(v => !v); };
  return (
    <Row site={{ url: p.origin }} title={host(p.origin)} sub={shown ? pw : (p.username || '••••••••••')} theme={theme}
      actions={<>
        <I icon={shown ? EyeOff : Eye} label={shown ? 'Hide' : 'Reveal'} onPress={toggle} theme={theme} />
        <I icon={Copy} label="Copy password" onPress={() => onCopy(p.origin, p.username)} theme={theme} />
        <I icon={Trash2} label="Delete" onPress={() => onDelete(p.origin, p.username)} theme={theme} />
      </>} />
  );
}

function SettingsPage({ settings, profiles, active, update, createProfile, switchProfile, openPage, go, clearData, setDefault, chooseDownloads, reset, account, onSignIn, onSignOut, passwords, onRevealPw, onCopyPw, onDeletePw, pwEncAvail, theme, biometricAvailable, changeVaultPin }) {
  const [section, setSection] = useState('account');
  const [name, setName] = useState('');
  const [updateStatus, setUpdateStatus] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const checkUpdate = async () => {
    setCheckingUpdate(true);
    const result = await ipc?.invoke('check-for-updates');
    setUpdateStatus(result || { ok: false, error: 'Update service unavailable' });
    setCheckingUpdate(false);
  };
  const S = SET_SECTIONS.find(x => x.id === section) || SET_SECTIONS[0];

  const body = () => {
    switch (section) {
      case 'account':
        return (<>
          {account ? (
            <Card title="Tieddr Account" icon={TieddrMark} theme={theme}>
              <View style={[s.about, { marginBottom: 14 }]}>
                <View style={[s.avatar, { backgroundColor: theme.accentSoft, width: 56, height: 56, borderRadius: 28 }]}>{account.avatar ? <Image source={{ uri: account.avatar }} style={{ width: 56, height: 56, borderRadius: 28 }} /> : <User size={28} color={theme.accent} />}</View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.rt, { color: theme.text, fontSize: 18 }]}>{account.name || 'Tieddr account'}</Text>
                  <Text style={[s.rs, { color: theme.muted, marginTop: 2 }]}>{account.email || 'account.tieddr.com'}</Text>
                  <View style={[s.syncRow, { marginTop: 6 }]}><CheckCircle size={13} color={theme.success} /><Text style={[s.rs, { color: theme.success }]}>Sync active across Tieddr apps</Text></View>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={[s.primary, { backgroundColor: theme.accent, flex: 1 }]} onPress={() => openPage('vault')}><Shield size={16} color="#fff" /><Text style={s.primaryText}>Open Vault</Text></TouchableOpacity>
                <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border, flex: 1 }]} onPress={onSignOut}><LogOut size={16} color={theme.danger} /><Text style={[s.actionText, { color: theme.danger }]}>Sign out</Text></TouchableOpacity>
              </View>
            </Card>
          ) : (
            <Card title="Sign in with Tieddr" icon={TieddrMark} theme={theme}>
              <View style={[s.about, { marginBottom: 14 }]}>
                <View style={[s.avatar, { backgroundColor: theme.accentSoft }]}><User size={26} color={theme.accent} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.rt, { color: theme.text, fontSize: 16 }]}>One account across Tieddr</Text>
                  <Text style={[s.rs, { color: theme.muted, lineHeight: 19 }]}>Sign in to sync bookmarks, passwords, notes, and settings with Tieddr Space and Tieddr Vault — across every Tieddr app.</Text>
                </View>
              </View>
              <TouchableOpacity style={[s.primary, { backgroundColor: theme.accent }]} onPress={onSignIn}><LogIn size={16} color="#fff" /><Text style={s.primaryText}>Sign in to Tieddr</Text></TouchableOpacity>
            </Card>
          )}
          <Card title="Tieddr ecosystem" icon={LayoutGrid} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 10, lineHeight: 19 }]}>Tieddr is a connected suite of apps. Your Tieddr Account links them all.</Text>
            <View style={{ width: '100%' }}>
              {TIEDDR_APPS.map(a => (
                <Row key={a.name} site={{ url: a.url, favicon: a.icon }} title={a.name} sub={a.tagline} onPress={() => go(a.url)} theme={theme}
                  actions={<ExternalLink size={14} color={theme.faint} />} />
              ))}
            </View>
          </Card>
          <Card title="Profiles on this device" icon={User} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 10, lineHeight: 19 }]}>Each profile has its own bookmarks, history, passwords, and extensions.</Text>
            {profiles.map(p => (
              <TouchableOpacity key={p.id} dataSet={p.id === active ? undefined : HOVER} style={[s.profile, T_BG, p.id === active && { backgroundColor: theme.accentSoft }]} onPress={() => switchProfile(p.id)}>
                <User size={16} color={p.id === active ? theme.accent : theme.muted} />
                <Text style={[s.profileName, { color: theme.text }]}>{p.name}</Text>
                {p.id === active ? <><Text style={{ fontSize: 11, color: theme.success, marginRight: 4 }}>Active</Text><CheckCircle size={15} color={theme.success} /></> : null}
              </TouchableOpacity>
            ))}
            <View style={[s.inline, { borderColor: theme.border }]}>
              <TextInput style={[s.inlineInput, { color: theme.text }]} placeholder="New profile name" placeholderTextColor={theme.faint} value={name} onChangeText={setName} />
              <TouchableOpacity style={[s.small, { backgroundColor: theme.accent }]} onPress={() => { createProfile(name); setName(''); }}><Text style={s.smallText}>Create</Text></TouchableOpacity>
            </View>
          </Card>
        </>);
      case 'privacy':
        return (<>
          <Card title="Privacy and security" icon={Shield} theme={theme}>
            <Toggle label="Ad blocker" detail="Built-in blocker for ads, trackers, and cryptominers. Blocks 50+ ad networks." value={settings.adBlocker !== false} onPress={() => update({ adBlocker: settings.adBlocker === false })} theme={theme} />
            <Toggle label="Block common trackers" detail="Cancel known analytics and tracking requests." value={settings.blockTrackers !== false} onPress={() => update({ blockTrackers: settings.blockTrackers === false })} theme={theme} />
            <Toggle label="Always use HTTPS" detail="Upgrade sites to a secure connection when possible." value={!!settings.httpsOnly} onPress={() => update({ httpsOnly: !settings.httpsOnly })} theme={theme} />
            <Toggle label={'Send \u201CDo Not Track\u201D request'} detail="Ask sites not to track your browsing." value={!!settings.doNotTrack} onPress={() => update({ doNotTrack: !settings.doNotTrack })} theme={theme} />
            <Toggle label="Fingerprint spoofing" detail="Reduce browser fingerprinting by reporting generic hardware info." value={!!settings.fingerprintProtection} onPress={() => update({ fingerprintProtection: !settings.fingerprintProtection })} theme={theme} />
            <Toggle label="Referrer policy" detail="Send a reduced referrer header to sites." value={!!settings.reducedReferrer} onPress={() => update({ reducedReferrer: !settings.reducedReferrer })} theme={theme} />
          </Card>
          <Card title="Vault Security" icon={Lock} theme={theme}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, borderWidth: 1, backgroundColor: theme.accentSoft + '20', borderColor: theme.border, marginBottom: 12 }}>
              <Shield size={20} color={theme.accent} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text }}>Vault Protection</Text>
                <Text style={{ fontSize: 11, color: theme.muted }}>Passwords are encrypted with your vault PIN</Text>
              </View>
              <TouchableOpacity onPress={() => openPage('vault')}>
                <Text style={{ color: theme.accent, fontSize: 13 }}>Open Vault</Text>
              </TouchableOpacity>
            </View>
            <Pick label="Lock vault after" values={[5, 10, 15, 30]} value={settings.vaultAutoLock || 5} format={v => `${v} min`} onPick={v => update({ vaultAutoLock: v })} theme={theme} />
            <Toggle label="Lock on system idle" detail="Lock when screen locks or system sleeps." value={settings.lockOnIdle !== false} onPress={() => update({ lockOnIdle: settings.lockOnIdle === false })} theme={theme} />
            <Toggle label="Lock on minimize" detail="Lock when browser window is minimized." value={settings.lockOnMinimize !== false} onPress={() => update({ lockOnMinimize: settings.lockOnMinimize === false })} theme={theme} />
            <Toggle label="Lock on close" detail="Lock when browser is closed." value={settings.lockOnClose !== false} onPress={() => update({ lockOnClose: settings.lockOnClose === false })} theme={theme} />
            <Pick label="Clear clipboard after" values={[0, 15, 30, 60]} value={settings.clipboardClear || 30} format={v => v === 0 ? 'Never' : `${v}s`} onPick={v => update({ clipboardClear: v })} theme={theme} />
            {biometricAvailable ? (
              <Toggle label="Use biometric authentication" detail="Unlock vault with fingerprint or face ID." value={!!settings.biometricAuth} onPress={() => update({ biometricAuth: !settings.biometricAuth })} theme={theme} />
            ) : (
              <Text style={{ fontSize: 12, color: theme.faint, marginTop: 8 }}>Biometric authentication is not available on this device.</Text>
            )}
            <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border, marginTop: 8 }]} onPress={changeVaultPin}>
              <KeyRound size={16} color={theme.accent} />
              <Text style={[s.actionText, { color: theme.accent }]}>Change vault PIN</Text>
            </TouchableOpacity>
          </Card>
          <Card title="Safe Browsing" icon={ShieldCheck} theme={theme}>
            <Pick label="Safe Browsing protection level" values={['enhanced', 'standard', 'off']} value={settings.safeBrowsing || 'standard'} format={v => ({ enhanced: 'Enhanced (full protection)', standard: 'Standard (balanced)', off: 'Off' })[v]} onPick={v => update({ safeBrowsing: v })} theme={theme} />
            <Toggle label="Send Safe Browsing data" detail="Allow Google to check URLs against its Safe Browsing database." value={settings.safeBrowsingData !== false} onPress={() => update({ safeBrowsingData: settings.safeBrowsingData === false })} theme={theme} />
          </Card>
          <Card title="Browsing data" icon={Trash2} theme={theme}>
            <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border, marginTop: 0 }]} onPress={clearData}>
              <Trash2 size={16} color={theme.danger} /><Text style={[s.actionText, { color: theme.danger }]}>Clear browsing data</Text>
            </TouchableOpacity>
          </Card>
        </>);
      case 'performance':
        return (<>
          <Card title="Performance" icon={Gauge} theme={theme}>
            <Toggle label="Memory saver" detail="Free up memory from inactive tabs." value={!!settings.memorySaver} onPress={() => update({ memorySaver: !settings.memorySaver })} theme={theme} />
            <Toggle label="Use hardware acceleration" detail="Use the GPU for smoother graphics (restart to apply)." value={settings.hardwareAcceleration !== false} onPress={() => update({ hardwareAcceleration: settings.hardwareAcceleration === false })} theme={theme} />
            <Toggle label="GPU rasterization" detail="Use the GPU to render page content." value={!!settings.gpuRasterization} onPress={() => update({ gpuRasterization: !settings.gpuRasterization })} theme={theme} />
          </Card>
          <Card title="Rendering" icon={Monitor} theme={theme}>
            <Toggle label="Smooth scrolling" detail="Enable smooth kinetic scrolling." value={settings.smoothScroll !== false} onPress={() => update({ smoothScroll: settings.smoothScroll === false })} theme={theme} />
            <Toggle label="Accelerated 2D canvas" detail="Hardware-accelerate canvas drawing for faster rendering." value={!!settings.acceleratedCanvas} onPress={() => update({ acceleratedCanvas: !settings.acceleratedCanvas })} theme={theme} />
            <Slider label="Render process limit" detail="Maximum number of renderer processes." value={settings.renderProcessLimit || 4} min={1} max={16} step={1} onChange={v => update({ renderProcessLimit: v })} format={v => `${v} process${v > 1 ? 'es' : ''}`} theme={theme} />
          </Card>
          <Card title="Network" icon={Wifi} theme={theme}>
            <Pick label="DNS over HTTPS" values={['off', 'opportunistic', 'strict']} value={settings.dnsOverHttps || 'off'} format={v => ({ off: 'Off', opportunistic: 'Opportunistic', strict: 'Strict' })[v]} onPick={v => update({ dnsOverHttps: v })} theme={theme} />
            <Toggle label="Preload pages" detail="Predict and preload pages you might visit." value={settings.preloadPages !== false} onPress={() => update({ preloadPages: settings.preloadPages === false })} theme={theme} />
          </Card>
        </>);
      case 'appearance':
        return (<>
          <Card title="Theme" icon={Palette} theme={theme}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
              {Object.values(THEMES).map(x => (
                <TouchableOpacity key={x.id} style={[s.theme, { backgroundColor: x.bg, borderColor: settings.theme === x.id ? theme.accent : theme.border }]} onPress={() => update({ theme: x.id })}>
                  <View style={[s.swatch, { backgroundColor: x.strong, borderColor: x.border }]} />
                  <Text style={[s.thn, { color: x.text }]}>{x.name}</Text>
                  <Text style={[s.thd, { color: x.muted }]}>{x.desc}</Text>
                  {settings.theme === x.id ? <View style={s.themeCheck}><CheckCircle size={16} color={x.accent} /></View> : null}
                </TouchableOpacity>
              ))}
            </View>
          </Card>
          <Card title="Accent color" icon={Palette} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 10 }]}>Choose an accent color for buttons, links, and active states across the browser.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[{ id: '', label: 'Theme default', color: theme.accent }, ...ACCENT_PRESETS].map(a => (
                <TouchableOpacity key={a.id || 'default'} onPress={() => update({ accentColor: a.id })} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: a.color, borderWidth: 3, borderColor: (settings.accentColor || '') === a.id ? theme.text : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {(settings.accentColor || '') === a.id ? <CheckCircle size={16} color="#fff" /> : null}
                </TouchableOpacity>
              ))}
            </View>
          </Card>
          <Card title="Start page background" icon={Palette} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 10 }]}>Set a background image or gradient that shows on every new tab.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {START_BGS.map(bg => (
                <TouchableOpacity key={bg.id} onPress={() => update({ startBackground: bg.id })}
                  style={{ alignItems: 'center', gap: 4 }}>
                  <View
                    style={{ width: 80, height: 52, borderRadius: 10, borderWidth: 2, borderColor: (settings.startBackground || 'none') === bg.id ? theme.accent : theme.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', background: bg.css || theme.soft }}>
                    {bg.id === 'none' ? <Text style={{ fontSize: 10, color: theme.muted, fontWeight: '600' }}>None</Text> : null}
                    {(settings.startBackground || 'none') === bg.id ? <View style={{ position: 'absolute', top: 4, right: 4 }}><CheckCircle size={14} color={theme.accent} /></View> : null}
                  </View>
                  <Text style={{ fontSize: 10, color: (settings.startBackground || 'none') === bg.id ? theme.accent : theme.faint, fontWeight: (settings.startBackground || 'none') === bg.id ? '600' : '400' }}>{bg.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>
          <Card title="Glassmorphism" icon={Sparkles} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 10, lineHeight: 19 }]}>Enable translucent, frosted-glass effects on the toolbar, settings sidebar, and cards. Uses your GPU for real-time blur.</Text>
            <Toggle label="Glass toolbar" detail="Frosted glass effect on the tab bar and navigation." value={settings.glassToolbar !== false} onPress={() => update({ glassToolbar: settings.glassToolbar === false })} theme={theme} />
            <Toggle label="Glass cards" detail="Subtle blur on settings cards and panels." value={settings.glassCards !== false} onPress={() => update({ glassCards: settings.glassCards === false })} theme={theme} />
            <Toggle label="Glass sidebar" detail="Frosted glass effect on the settings sidebar." value={settings.glassSidebar !== false} onPress={() => update({ glassSidebar: settings.glassSidebar === false })} theme={theme} />
            <Pick label="Blur intensity" values={['light', 'medium', 'heavy']} value={settings.blurIntensity || 'medium'} format={v => ({ light: 'Light (16px)', medium: 'Medium (24px)', heavy: 'Heavy (32px)' })[v]} onPick={v => update({ blurIntensity: v })} theme={theme} />
          </Card>
          <Card title="Font and text" icon={Type} theme={theme}>
            <Pick label="UI font" values={['system', 'serif', 'mono']} value={settings.uiFont || 'system'} format={v => ({ system: 'System default', serif: 'Serif', mono: 'Monospace' })[v]} onPick={v => update({ uiFont: v })} theme={theme} />
            <Pick label="Tab font size" values={['small', 'medium', 'large']} value={settings.tabFontSize || 'medium'} format={v => ({ small: 'Small', medium: 'Medium', large: 'Large' })[v]} onPick={v => update({ tabFontSize: v })} theme={theme} />
          </Card>
          <Card title="Search engine" icon={Search} theme={theme}>
            <Pick label="Default search engine" values={['google', 'duckduckgo', 'bing']} value={settings.searchEngine || 'google'} onPick={v => update({ searchEngine: v })} theme={theme} />
          </Card>
          <Card title="Address bar" icon={MousePointer} theme={theme}>
            <Toggle label="Search suggestions" detail="Show search suggestions in address bar." value={settings.searchSuggestions !== false} onPress={() => update({ searchSuggestions: settings.searchSuggestions === false })} theme={theme} />
            <Toggle label="History suggestions" detail="Show browsing history in suggestions." value={settings.historySuggestions !== false} onPress={() => update({ historySuggestions: settings.historySuggestions === false })} theme={theme} />
            <Toggle label="Bookmark suggestions" detail="Show bookmarks in suggestions." value={settings.bookmarkSuggestions !== false} onPress={() => update({ bookmarkSuggestions: settings.bookmarkSuggestions === false })} theme={theme} />
          </Card>
          <Card title="AI innovations" icon={Sparkles} theme={theme}>
            <Toggle label="Smart suggestions" detail="Surface helpful suggestions in the address bar." value={settings.aiSuggestions !== false} onPress={() => update({ aiSuggestions: settings.aiSuggestions === false })} theme={theme} />
            <Toggle label="Tab grouping suggestions" detail="AI-powered suggestions for organizing tabs into groups." value={!!settings.aiTabGroups} onPress={() => update({ aiTabGroups: !settings.aiTabGroups })} theme={theme} />
            <Toggle label="Smart copy" detail="Enhance copied content with formatting and context." value={!!settings.smartCopy} onPress={() => update({ smartCopy: !settings.smartCopy })} theme={theme} />
          </Card>
          <Card title="Default browser" icon={Globe} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 10 }]}>Flow is your default browser.</Text>
            <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border }]} onPress={() => ipc?.send('set-default-browser')}>
              <Globe size={16} color={theme.accent} />
              <Text style={[s.actionText, { color: theme.accent }]}>Set as default</Text>
            </TouchableOpacity>
          </Card>
        </>);
      case 'tabs':
        return (<>
          <Card title="Tabs" icon={Layers} theme={theme}>
            <Pick label="New tab page" values={['blank', 'start', 'last']} value={settings.newTab || 'start'} format={v => ({ blank: 'Blank page', start: 'Start page', last: 'Continue browsing' })[v]} onPick={v => update({ newTab: v })} theme={theme} />
            <Pick label="New tab opens" values={['start', 'blank', 'same']} value={settings.newTabBehavior || 'start'} format={v => ({ start: 'Start page', blank: 'Blank page', same: 'Same page as current' })[v]} onPick={v => update({ newTabBehavior: v })} theme={theme} />
            <Pick label="New window opens" values={['start', 'blank']} value={settings.newWindowBehavior || 'start'} format={v => ({ start: 'Start page', blank: 'Blank page' })[v]} onPick={v => update({ newWindowBehavior: v })} theme={theme} />
            <Toggle label="Show tab bar" detail="Display the tab bar when only one tab is open." value={settings.showTabBar !== false} onPress={() => update({ showTabBar: settings.showTabBar === false })} theme={theme} />
            <Toggle label="Tab grouping" detail="Allow tabs to be grouped." value={settings.tabGrouping !== false} onPress={() => update({ tabGrouping: settings.tabGrouping === false })} theme={theme} />
            <Toggle label="Close tab on middle click" detail="Close tabs when you middle-click them." value={settings.middleClickClose !== false} onPress={() => update({ middleClickClose: settings.middleClickClose === false })} theme={theme} />
            <Toggle label="Show close button on tabs" detail="Display an × button when hovering over tabs." value={settings.showTabClose !== false} onPress={() => update({ showTabClose: settings.showTabClose === false })} theme={theme} />
            <Toggle label="Lazy loading" detail="Delay loading background tabs to save memory." value={!!settings.lazyTabs} onPress={() => update({ lazyTabs: !settings.lazyTabs })} theme={theme} />
          </Card>
          <Card title="Tab groups and organization" icon={PanelTop} theme={theme}>
            <Toggle label="Tab discarding" detail="Unload inactive tabs when memory is low." value={settings.tabDiscarding !== false} onPress={() => update({ tabDiscarding: settings.tabDiscarding === false })} theme={theme} />
            <Toggle label="Tab search" detail="Enable Ctrl+Shift+A to search through open tabs." value={settings.tabSearch !== false} onPress={() => update({ tabSearch: settings.tabSearch === false })} theme={theme} />
            <Pick label="Tab width" values={['narrow', 'normal', 'wide']} value={settings.tabWidth || 'normal'} format={v => ({ narrow: 'Narrow (icon only)', normal: 'Normal', wide: 'Wide (with title)' })[v]} onPick={v => update({ tabWidth: v })} theme={theme} />
          </Card>
          <Card title="Startup" icon={Home} theme={theme}>
            <Pick label="On startup" values={['last', 'start', 'blank']} value={settings.startup || 'start'} format={v => ({ last: 'Continue where you left off', start: 'Open start page', blank: 'Open new tab' })[v]} onPick={v => update({ startup: v })} theme={theme} />
            <Toggle label="Restore previous session" detail="Reopen tabs from last session." value={settings.restoreSession !== false} onPress={() => update({ restoreSession: settings.restoreSession === false })} theme={theme} />
          </Card>
        </>);
      case 'languages':
        return (<>
          <Card title="Languages" icon={Languages} theme={theme}>
            <Pick label="Display language" values={['en']} format={() => 'English (United States)'} value={settings.language || 'en'} onPick={v => update({ language: v })} theme={theme} />
            <Toggle label="Spell check" detail="Check spelling while typing." value={settings.spellCheck !== false} onPress={() => update({ spellCheck: settings.spellCheck === false })} theme={theme} />
          </Card>
          <Card title="Accessibility" icon={Accessibility} theme={theme}>
            <Toggle label="Reduce motion" detail="Minimize animations and transitions." value={!!settings.reduceMotion} onPress={() => update({ reduceMotion: !settings.reduceMotion })} theme={theme} />
            <Toggle label="High contrast" detail="Increase contrast for better visibility." value={!!settings.highContrast} onPress={() => update({ highContrast: !settings.highContrast })} theme={theme} />
            <Pick label="Default zoom" values={[0.8, 0.9, 1, 1.1, 1.25, 1.5]} value={Number(settings.defaultZoom || 1)} format={v => `${Math.round(v * 100)}%`} onPick={v => update({ defaultZoom: v })} theme={theme} />
          </Card>
        </>);
      case 'data':
        return (<>
          <Card title="Downloads" icon={Download} theme={theme}>
            <Text style={[s.label, { color: theme.text }]}>Location</Text>
            <View style={[s.inline, { borderColor: theme.border }]}>
              <Text style={[s.inlineInput, { color: settings.downloadPath ? theme.text : theme.faint, paddingVertical: 10 }]} numberOfLines={1}>{settings.downloadPath || 'System default (Downloads)'}</Text>
              <TouchableOpacity style={[s.small, { backgroundColor: theme.accent }]} onPress={chooseDownloads}><Text style={s.smallText}>Change</Text></TouchableOpacity>
            </View>
            <Toggle label="Ask where to save each file" detail="Choose a location every time you download." value={!!settings.askWhereToSave} onPress={() => update({ askWhereToSave: !settings.askWhereToSave })} theme={theme} />
          </Card>
          <Card title="Cache & Storage" icon={HardDrive} theme={theme}>
            <InfoRow label="Browsing data" value={settings.browsingDataSize || '~45 MB'} theme={theme} />
            <InfoRow label="Extensions" value={settings.extDataSize || '~12 MB'} theme={theme} />
            <InfoRow label="Local storage" value={settings.localStorageSize || '~8 MB'} theme={theme} />
            <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border, marginTop: 8 }]} onPress={clearData}>
              <Trash2 size={16} color={theme.danger} />
              <Text style={[s.actionText, { color: theme.danger }]}>Clear cache</Text>
            </TouchableOpacity>
          </Card>
          <Card title="Keyboard shortcuts" icon={Keyboard} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 10 }]}>Customize keyboard shortcuts for Flow.</Text>
            <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border }]} onPress={() => openPage('data')}>
              <Keyboard size={16} color={theme.accent} />
              <Text style={[s.actionText, { color: theme.accent }]}>Customize shortcuts</Text>
            </TouchableOpacity>
          </Card>
        </>);
      case 'system':
        return (<>
          <Card title="System" icon={Cpu} theme={theme}>
            <Toggle label="Continue running background apps when Flow is closed" detail="Keep extensions and downloads active in the background." value={!!settings.background} onPress={() => update({ background: !settings.background })} theme={theme} />
            <Toggle label="Use hardware acceleration when available" detail="Restart Flow to apply." value={settings.hardwareAcceleration !== false} onPress={() => update({ hardwareAcceleration: settings.hardwareAcceleration === false })} theme={theme} />
            <Toggle label="Send usage statistics" detail="Help improve Flow by sending anonymous usage data." value={!!settings.sendStats} onPress={() => update({ sendStats: !settings.sendStats })} theme={theme} />
          </Card>
        </>);
      case 'developer':
        return (<>
          <Card title="Developer tools" icon={Code2} theme={theme}>
            <Toggle label="Enable DevTools" detail="Allow F12 and right-click → Inspect to open developer tools." value={settings.devTools !== false} onPress={() => update({ devTools: settings.devTools === false })} theme={theme} />
            <Toggle label="Always show console" detail="Open the console panel by default in DevTools." value={!!settings.alwaysShowConsole} onPress={() => update({ alwaysShowConsole: !settings.alwaysShowConsole })} theme={theme} />
            <Toggle label="Show heap statistics" detail="Display JavaScript heap usage in the status bar." value={!!settings.heapStats} onPress={() => update({ heapStats: !settings.heapStats })} theme={theme} />
            <Toggle label="Console logging" detail="Show console messages in the terminal." value={!!settings.consoleLogging} onPress={() => update({ consoleLogging: !settings.consoleLogging })} theme={theme} />
          </Card>
          <Card title="Source maps and debugging" icon={FileCode} theme={theme}>
            <Toggle label="Source maps" detail="Enable source map loading for debugging." value={settings.sourceMaps !== false} onPress={() => update({ sourceMaps: settings.sourceMaps === false })} theme={theme} />
            <Toggle label="Remote debugging" detail="Allow external tools to connect via Chrome DevTools Protocol." value={!!settings.remoteDebugging} onPress={() => update({ remoteDebugging: !settings.remoteDebugging })} theme={theme} />
            {settings.remoteDebugging ? (
              <InfoRow label="Debug port" value={settings.debugPort || '9222'} theme={theme} />
            ) : null}
          </Card>
          <Card title="Web development" icon={Terminal} theme={theme}>
            <Toggle label="Override user agent" detail="Send a custom user agent string with requests." value={!!settings.overrideUserAgent} onPress={() => update({ overrideUserAgent: !settings.overrideUserAgent })} theme={theme} />
            <Toggle label="Emulate CSS media type" detail="Force a specific CSS media type (screen/print) for all pages." value={!!settings.emulateMediaType} onPress={() => update({ emulateMediaType: !settings.emulateMediaType })} theme={theme} />
            <Toggle label="Network throttling" detail="Simulate slow network conditions for testing." value={!!settings.networkThrottling} onPress={() => update({ networkThrottling: !settings.networkThrottling })} theme={theme} />
            <Toggle label="Request blocking" detail="Block network requests matching patterns." value={!!settings.requestBlocking} onPress={() => update({ requestBlocking: !settings.requestBlocking })} theme={theme} />
          </Card>
        </>);
      case 'updates':
        return (<>
          <Card title="Updates" icon={Rocket} theme={theme}>
            <Pick label="Update channel" values={['stable', 'beta', 'dev']} value={settings.updateChannel || 'stable'} format={v => ({ stable: 'Stable', beta: 'Beta (early features)', dev: 'Dev (nightly)' })[v]} onPick={v => update({ updateChannel: v })} theme={theme} />
            <Toggle label="Check for updates automatically" detail="Flow checks for new versions on startup." value={settings.autoUpdate !== false} onPress={() => update({ autoUpdate: settings.autoUpdate === false })} theme={theme} />
            <Toggle label="Background update downloads" detail="Download updates in the background and install on next restart." value={!!settings.backgroundUpdateDownload} onPress={() => update({ backgroundUpdateDownload: !settings.backgroundUpdateDownload })} theme={theme} />
            <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border, marginTop: 6 }]} onPress={checkUpdate} disabled={checkingUpdate}>
              <ArrowUpCircle size={16} color={theme.accent} /><Text style={[s.actionText, { color: theme.accent }]}>{checkingUpdate ? 'Checking…' : 'Check for updates now'}</Text>
            </TouchableOpacity>
            {updateStatus ? <View style={{ marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: updateStatus.available ? theme.accentSoft : theme.soft, borderWidth: 1, borderColor: updateStatus.available ? theme.accent : theme.border }}>
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>{!updateStatus.ok ? 'Could not check for updates' : updateStatus.available ? `Flowr ${updateStatus.latestVersion} is ready` : 'You’re up to date'}</Text>
              <Text style={{ color: theme.muted, fontSize: 12.5, marginTop: 4 }}>{!updateStatus.ok ? updateStatus.error : updateStatus.available ? `You have ${updateStatus.currentVersion}. Download the latest secure release.` : `Flowr ${updateStatus.currentVersion} is the latest release.`}</Text>
              {updateStatus.available ? <TouchableOpacity onPress={() => ipc?.invoke('open-external', updateStatus.downloadUrl)} style={{ marginTop: 10, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, backgroundColor: theme.accent }}><Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '700' }}>Download update</Text></TouchableOpacity> : null}
            </View> : null}
          </Card>
          <Card title="Release notes" icon={BookOpen} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, lineHeight: 19 }]}>See what's new in Flow Browser.</Text>
            <InfoRow label="Current version" value={APP_VERSION} theme={theme} />
            <InfoRow label="Engine" value="Electron 43 · Chromium 134" theme={theme} />
            <InfoRow label="Release date" value="August 2026" theme={theme} />
          </Card>
        </>);
      case 'reset':
        return (
          <Card title="Reset settings" icon={RotateCcw} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 12, lineHeight: 19 }]}>Restore theme, search engine, privacy, and all preferences to their original defaults. Your bookmarks and history are kept.</Text>
            <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border }]} onPress={reset}><RotateCcw size={16} color={theme.danger} /><Text style={[s.actionText, { color: theme.danger }]}>Restore defaults</Text></TouchableOpacity>
          </Card>
        );
      case 'extensions':
        return (
          <Card title="Extensions" icon={Puzzle} theme={theme}>
            <Text style={[s.rs, { color: theme.muted, marginBottom: 12, lineHeight: 19 }]}>Add and manage Chrome-compatible extensions.</Text>
            <TouchableOpacity style={[s.primary, { backgroundColor: theme.accent }]} onPress={() => openPage('extensions')}><Puzzle size={16} color="#fff" /><Text style={s.primaryText}>Manage extensions</Text></TouchableOpacity>
          </Card>
        );
      case 'about':
        return (
          <Card title="About Flow" icon={Info} theme={theme}>
            <View style={s.about}>
              <View style={[s.mark, { backgroundColor: theme.strong, borderColor: theme.border, marginBottom: 0 }]}><Brand size={40} radius={11} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.rt, { color: theme.text, fontSize: 18 }]}>Flow Browser</Text>
                <Text style={[s.rs, { color: theme.muted }]}>Version {APP_VERSION}</Text>
                <Text style={[s.rs, { color: theme.faint, marginTop: 6, lineHeight: 18 }]}>A calm, premium browser built on Electron. Part of the Tieddr ecosystem.</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {['Chrome extensions', 'Themes', 'Profiles', 'Tracker blocking', 'Tieddr Vault', 'Tieddr Space sync', 'Glassmorphism UI', 'Per-site permissions', 'Developer tools'].map(f => (
                <View key={f} style={{ backgroundColor: theme.accentSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: theme.accent }}>{f}</Text>
                </View>
              ))}
            </View>
          </Card>
        );
      default: return null;
    }
  };

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const match = x => !q || x.label.toLowerCase().includes(q) || (SEC_HINT[x.id] || '').toLowerCase().includes(q);

  return (
    <View style={s.setWrap}>
      <View style={[s.setSide, { backgroundColor: theme.chrome + 'cc', borderRightColor: theme.border + '60' }]} {...GLASS_HEAVY}>
        <View style={s.setBrand}><Brand size={22} radius={6} /><Text style={[s.setBrandText, { color: theme.text }]}>Flow</Text></View>
        {account ? (
          <View style={[s.setAccountBar, { backgroundColor: theme.accentSoft, borderColor: theme.border }]}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {account.avatar ? <Image source={{ uri: account.avatar }} style={{ width: 28, height: 28, borderRadius: 14 }} /> : <User size={14} color={theme.muted} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: theme.text }} numberOfLines={1}>{account.name || 'Tieddr account'}</Text>
              <Text style={{ fontSize: 10.5, color: theme.muted }} numberOfLines={1}>{account.email || ''}</Text>
            </View>
          </View>
        ) : null}
        <View style={[s.setSearch, { backgroundColor: theme.strong, borderColor: theme.border }]}>
          <Search size={15} color={theme.faint} />
          <TextInput style={[s.setSearchInput, { color: theme.text }]} placeholder="Search settings" placeholderTextColor={theme.faint} value={query} onChangeText={setQuery} autoCapitalize="none" />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {SET_GROUPS.map(g => {
            const rows = g.ids.map(id => SEC[id]).filter(match);
            if (!rows.length) return null;
            return (
              <View key={g.label} style={{ marginBottom: 6 }}>
                <Text style={[s.setGroup, { color: theme.faint }]}>{g.label}</Text>
                {rows.map(x => (
                  <TouchableOpacity key={x.id} dataSet={section === x.id ? undefined : HOVER} style={[s.setItem, T_BG, section === x.id && { backgroundColor: theme.accentSoft }]} onPress={() => x.id === 'extensions' ? openPage('extensions') : setSection(x.id)}>
                    <x.icon size={16} color={section === x.id ? theme.accent : theme.muted} />
                    <Text style={[s.setItemText, { color: section === x.id ? theme.accent : theme.text }]} numberOfLines={1}>{x.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </ScrollView>
      </View>
      <ScrollView style={s.setMain} contentContainerStyle={s.setMainIn}>
        <View style={s.setHero}>
          <Text style={[s.setHeroTitle, { color: theme.text }]}>{S.label}</Text>
          <Text style={[s.setHeroHint, { color: theme.muted }]}>{SEC_HINT[section]}</Text>
        </View>
        {body()}
      </ScrollView>
    </View>
  );
}

function Card({ title, icon: Icon, children, theme }) {
  return (
    <View style={[s.card, { backgroundColor: theme.panel + 'b8', borderColor: theme.border + '80' }]} {...GLASS_LIGHT}>
      <View style={s.cardHead}><Icon size={19} color={theme.accent} /><Text style={[s.pt, { color: theme.text }]}>{title}</Text></View>
      <View style={s.cardBody}>{children}</View>
    </View>
  );
}

function InfoRow({ label, value, theme }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.border + '30' }}>
      <Text style={{ fontSize: 13, color: theme.muted }}>{label}</Text>
      <Text style={{ fontSize: 13, color: theme.text, fontWeight: '500' }}>{value}</Text>
    </View>
  );
}

function Toggle({ label, detail, value, onPress, theme }) {
  return (
    <TouchableOpacity dataSet={HOVER} style={[s.toggle, T_BG, { borderColor: theme.border }]} onPress={onPress}>
      <View style={s.rb}><Text style={[s.rt, { color: theme.text }]}>{label}</Text><Text style={[s.rs, { color: theme.muted }]}>{detail}</Text></View>
      <View style={[s.togTrack, { backgroundColor: value ? theme.accent : theme.soft }]}><View style={[s.togThumb, value && { transform: [{ translateX: 18 }] }]} /></View>
    </TouchableOpacity>
  );
}

function Pick({ label, values, value, onPick, theme, format }) {
  return (
    <>
      <Text style={[s.label, { color: theme.text }]}>{label}</Text>
      <View style={s.segs}>
        {values.map(v => (
          <TouchableOpacity key={String(v)} dataSet={value === v ? undefined : HOVER} style={[s.seg, T_BG, { borderColor: theme.border }, value === v && { backgroundColor: theme.accentSoft, borderColor: theme.accent }]} onPress={() => onPick(v)}>
            <Text style={[s.segText, { color: value === v ? theme.accent : theme.text }]}>{format ? format(v) : v}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

function Slider({ label, detail, value, min, max, step, onChange, format, theme }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <View style={[s.toggle, { borderColor: theme.border, marginBottom: 12, alignItems: 'stretch', flexDirection: 'column', gap: 8 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}><Text style={[s.rt, { color: theme.text }]}>{label}</Text>{detail ? <Text style={[s.rs, { color: theme.muted }]}>{detail}</Text> : null}</View>
        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.accent, minWidth: 44, textAlign: 'right' }}>{format ? format(value) : value}</Text>
      </View>
      <View style={{ position: 'relative', height: 28, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 3, backgroundColor: theme.soft }}>
          <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: theme.accent }} />
        </View>
        <View style={{ position: 'absolute', left: `${pct}%`, width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', borderWidth: 2, borderColor: theme.accent, transform: [{ translateX: -9 }], boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
      </View>
    </View>
  );
}

function SubSection({ label, theme }) {
  return <Text style={[s.setGroup, { color: theme.accent, marginTop: 16, marginBottom: 6 }]}>{label}</Text>;
}

function DangerButton({ label, icon: Icon, theme, onPress }) {
  return (
    <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.danger + '40', marginTop: 6 }]} onPress={onPress}>
      {Icon ? <Icon size={16} color={theme.danger} /> : null}<Text style={[s.actionText, { color: theme.danger }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Action({ icon: Icon, text, onPress, theme, danger }) {
  return (
    <TouchableOpacity style={[s.action, { backgroundColor: theme.panel, borderColor: theme.border }]} onPress={onPress}>
      <Icon size={16} color={danger ? theme.danger : theme.accent} /><Text style={[s.actionText, { color: danger ? theme.danger : theme.accent }]}>{text}</Text>
    </TouchableOpacity>
  );
}

// --- Tieddr Vault page ----------------------------------------------------
// Password manager + Tieddr Wallet + secrets, synced to the encrypted mirror.
// Sign in with Tieddr Account, unlock with a 6-digit PIN, then manage items.
const VAULT_TABS = [
  { id: 'passwords', label: 'Passwords', icon: KeyRound, type: 'PASSWORD' },
  { id: 'wallet', label: 'Tieddr Wallet', icon: CreditCard, type: 'CREDIT_CARD' },
  { id: 'secrets', label: 'Secrets', icon: FileText, types: ['SECRET', 'KEY_PHRASE'] }
];
const iconForType = (t) => t === 'PASSWORD' ? KeyRound : t === 'CREDIT_CARD' ? CreditCard : t === 'KEY_PHRASE' ? Shield : FileText;

function VaultField({ label, value, onChange, placeholder, theme, secure, keyboard }) {
  return (
    <View style={{ marginBottom: 11 }}>
      <Text style={{ fontSize: 11.5, color: theme.muted, marginBottom: 5 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.faint}
        secureTextEntry={secure} keyboardType={keyboard || 'default'}
        style={{ backgroundColor: theme.soft, borderWidth: 1, borderColor: theme.border, borderRadius: 10, color: theme.text, paddingVertical: 10, paddingHorizontal: 12, fontSize: 13 }} />
    </View>
  );
}

function TieddrVaultPage({ state, items, account, onSignIn, onUnlock, onLock, onAdd, onDelete, onReveal, onCopy, onSync, busy, theme }) {
  const [tab, setTab] = useState('passwords');
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState('');
  const [working, setWorking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState('PASSWORD');
  const [form, setForm] = useState({});
  const [addErr, setAddErr] = useState('');
  const [revealed, setRevealed] = useState({});
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // Tieddr Vault owns its own brand accent (the signature red), regardless of
  // the browser's theme accent — this is the Vault surface, not generic chrome.
  theme = { ...theme, accent: '#ff453a', accentSoft: 'rgba(255,69,58,0.14)' };

  // Signed out
  if (!state.linked) {
    return (
      <View style={{ alignItems: 'center', paddingTop: 56 }}>
        <VaultMark height={40} dark={theme.id === 'flow' || theme.id === 'graphite'} />
        <Text style={{ fontSize: 22, fontWeight: '300', color: theme.text, marginTop: 18 }}>Your secrets, sealed on this device.</Text>
        <Text style={{ fontSize: 14, color: theme.muted, marginTop: 8, textAlign: 'center', maxWidth: 380 }}>Sign in with your Tieddr Account, then unlock with your PIN. Passwords, Tieddr Wallet cards, and secrets sync across every Tieddr app.</Text>
        <TouchableOpacity onPress={onSignIn} style={{ marginTop: 24, backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <LogIn size={16} color="#fff" /><Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Continue with Tieddr Account</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Locked → PIN
  if (!state.unlocked) {
    const submit = async () => {
      if (!/^\d{6}$/.test(pin)) { setPinErr('PIN must be 6 digits'); return; }
      setPinErr(''); setWorking(true);
      const r = await onUnlock(pin); setWorking(false);
      if (!r || !r.ok) { setPin(''); setPinErr((r && r.error) || 'Couldn\'t unlock'); }
    };
    return (
      <View style={{ alignItems: 'center', paddingTop: 56, maxWidth: 360, alignSelf: 'center', width: '100%' }}>
        <VaultMark height={34} dark={theme.id === 'flow' || theme.id === 'graphite'} />
        <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text, marginTop: 16 }}>{state.hasVault ? 'Enter your vault PIN' : 'Create a vault PIN'}</Text>
        <Text style={{ fontSize: 13, color: theme.muted, marginTop: 6, marginBottom: 18, textAlign: 'center' }}>{account && account.email ? `Signed in as ${account.email}` : 'A 6-digit PIN unlocks your vault.'}</Text>
        <TextInput value={pin} onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 6))} placeholder="● ● ● ● ● ●" placeholderTextColor={theme.faint}
          secureTextEntry keyboardType="numeric" maxLength={6}
          style={{ width: '100%', textAlign: 'center', fontSize: 26, letterSpacing: 12, color: theme.text, borderBottomWidth: 2, borderBottomColor: theme.border, paddingVertical: 12, marginBottom: 18 }} />
        <TouchableOpacity onPress={submit} disabled={working} style={{ width: '100%', alignItems: 'center', backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 13, opacity: working ? 0.6 : 1 }}>
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>{working ? 'Unlocking…' : (state.hasVault ? 'Unlock vault' : 'Create vault')}</Text>
        </TouchableOpacity>
        {pinErr ? <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 12 }}>{pinErr}</Text> : null}
      </View>
    );
  }

  // Unlocked
  const activeTab = VAULT_TABS.find(t => t.id === tab) || VAULT_TABS[0];
  const inTab = items.filter(i => activeTab.types ? activeTab.types.includes(i.type) : i.type === activeTab.type);
  const doReveal = async (id) => {
    if (revealed[id] !== undefined) { setRevealed(r => { const n = { ...r }; delete n[id]; return n; }); return; }
    const r = await onReveal(id);
    if (r && r.ok) setRevealed(rv => ({ ...rv, [id]: r.card ? `${r.card.number}  \u00B7  ${r.card.expiry}  \u00B7  CVC ${r.card.cvv}` : (r.value || '') }));
  };
  const saveAdd = async () => {
    setAddErr('');
    if (addType === 'CREDIT_CARD') {
      if (!form.number) { setAddErr('Card number is required'); return; }
      const r = await onAdd({ type: 'CREDIT_CARD', title: form.title, cardholder: form.cardholder, number: form.number, expiry: form.expiry, cvv: form.cvv });
      if (!r || !r.ok) { setAddErr((r && r.error) || 'Couldn\'t save'); return; }
    } else if (addType === 'PASSWORD') {
      if (!form.title) { setAddErr('Give it a title'); return; }
      const r = await onAdd({ type: 'PASSWORD', title: form.title, username: form.username, password: form.password, url: form.url });
      if (!r || !r.ok) { setAddErr((r && r.error) || 'Couldn\'t save'); return; }
    } else {
      if (!form.title) { setAddErr('Give it a title'); return; }
      const r = await onAdd({ type: addType, title: form.title, value: form.value, tag: form.tag });
      if (!r || !r.ok) { setAddErr((r && r.error) || 'Couldn\'t save'); return; }
    }
    setForm({}); setAdding(false);
  };

  return (
    <View>
      <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.border }, GLASS_LIGHT]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View>
            <VaultMark height={26} dark={theme.id === 'flow' || theme.id === 'graphite'} />
            <Text style={{ fontSize: 12, color: theme.muted, marginTop: 6 }}>{items.length} item{items.length === 1 ? '' : 's'} \u00B7 end-to-end encrypted</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={onSync} style={[s.syncBtn, { borderColor: theme.border }]} dataSet={HOVER}>
            <RefreshCw size={14} color={theme.muted} />
            <Text style={{ color: theme.muted, fontSize: 12.5, fontWeight: '500' }}>Sync</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLock} style={[s.syncBtn, { borderColor: theme.border }]} dataSet={HOVER}>
            <Lock size={14} color={theme.danger || '#e25656'} />
            <Text style={{ color: theme.danger || '#e25656', fontSize: 12.5, fontWeight: '500' }}>Lock</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 7, marginBottom: 16 }}>
        {VAULT_TABS.map(t => (
          <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: tab === t.id ? theme.accentSoft : theme.panel, borderWidth: 1, borderColor: tab === t.id ? theme.accent : theme.border }} dataSet={HOVER}>
            <t.icon size={15} color={tab === t.id ? theme.accent : theme.muted} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: tab === t.id ? theme.accent : theme.text }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => { setAdding(a => !a); setAddType(activeTab.type === 'CREDIT_CARD' ? 'CREDIT_CARD' : activeTab.id === 'secrets' ? 'SECRET' : 'PASSWORD'); setForm({}); setAddErr(''); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.accent, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 }}>
          <Plus size={15} color="#fff" /><Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Add</Text>
        </TouchableOpacity>
      </View>

      {adding ? (
        <View style={[{ borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 16, marginBottom: 16 }, GLASS_MEDIUM]}>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
            {[['PASSWORD', 'Password'], ['CREDIT_CARD', 'Card'], ['SECRET', 'Secret'], ['KEY_PHRASE', 'Key phrase']].map(([v, l]) => (
              <TouchableOpacity key={v} onPress={() => setAddType(v)} style={{ borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: addType === v ? theme.accent : theme.soft, borderWidth: 1, borderColor: addType === v ? theme.accent : theme.border }}>
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: addType === v ? '#fff' : theme.text }}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {addType === 'PASSWORD' ? <>
            <VaultField label="Title" value={form.title || ''} onChange={v => setF('title', v)} placeholder="e.g. GitHub" theme={theme} />
            <VaultField label="Username / email" value={form.username || ''} onChange={v => setF('username', v)} theme={theme} />
            <VaultField label="Password" value={form.password || ''} onChange={v => setF('password', v)} theme={theme} />
            <VaultField label="Website" value={form.url || ''} onChange={v => setF('url', v)} placeholder="https://" theme={theme} />
          </> : addType === 'CREDIT_CARD' ? <>
            <VaultField label="Name on card" value={form.title || ''} onChange={v => setF('title', v)} placeholder="e.g. Personal Visa" theme={theme} />
            <VaultField label="Cardholder" value={form.cardholder || ''} onChange={v => setF('cardholder', v)} theme={theme} />
            <VaultField label="Card number" value={form.number || ''} onChange={v => setF('number', v)} keyboard="numeric" theme={theme} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><VaultField label="Expiry (MM/YY)" value={form.expiry || ''} onChange={v => setF('expiry', v)} placeholder="08/27" theme={theme} /></View>
              <View style={{ flex: 1 }}><VaultField label="CVC" value={form.cvv || ''} onChange={v => setF('cvv', v)} secure keyboard="numeric" theme={theme} /></View>
            </View>
          </> : <>
            <VaultField label="Title" value={form.title || ''} onChange={v => setF('title', v)} theme={theme} />
            <VaultField label="Content" value={form.value || ''} onChange={v => setF('value', v)} theme={theme} />
            <VaultField label="Tag" value={form.tag || ''} onChange={v => setF('tag', v)} placeholder="e.g. API key, Crypto, Seed phrase" theme={theme} />
          </>}
          {addErr ? <Text style={{ color: theme.danger, fontSize: 12.5, marginBottom: 10 }}>{addErr}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={() => setAdding(false)} style={{ borderRadius: 9, paddingVertical: 9, paddingHorizontal: 15, borderWidth: 1, borderColor: theme.border }}><Text style={{ color: theme.muted, fontSize: 13 }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={saveAdd} style={{ borderRadius: 9, paddingVertical: 9, paddingHorizontal: 18, backgroundColor: theme.accent }}><Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Save</Text></TouchableOpacity>
          </View>
        </View>
      ) : null}

      {inTab.length ? inTab.map(it => {
        const Icon = iconForType(it.type);
        const sub = it.type === 'PASSWORD' ? (it.username || it.url || '—') : it.type === 'CREDIT_CARD' ? `${it.brand || 'Card'} •••• ${it.last4 || ''}${it.expiry ? ' · ' + it.expiry : ''}` : (it.tag || 'Secret');
        return (
          <View key={it.id} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 12, marginBottom: 8 }, GLASS_LIGHT]}>
            <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Icon size={16} color={theme.accent} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 13.5, fontWeight: '600', color: theme.text }} numberOfLines={1}>{it.title || 'Untitled'}</Text>
              <Text style={{ fontSize: 12, color: theme.muted }} numberOfLines={1}>{revealed[it.id] !== undefined ? revealed[it.id] : sub}</Text>
            </View>
            <TouchableOpacity onPress={() => doReveal(it.id)} style={{ padding: 7 }} dataSet={HOVER}>{revealed[it.id] !== undefined ? <EyeOff size={15} color={theme.muted} /> : <Eye size={15} color={theme.muted} />}</TouchableOpacity>
            {it.type !== 'CREDIT_CARD' ? <TouchableOpacity onPress={() => onCopy(it.id)} style={{ padding: 7 }} dataSet={HOVER}><Copy size={15} color={theme.muted} /></TouchableOpacity> : null}
            <TouchableOpacity onPress={() => onDelete(it.id)} style={{ padding: 7 }} dataSet={HOVER}><Trash2 size={15} color={theme.danger} /></TouchableOpacity>
          </View>
        );
      }) : (
        <View style={[{ alignItems: 'center', paddingVertical: 44, borderWidth: 1, borderColor: theme.border, borderRadius: 14 }, GLASS_LIGHT]}>
          <activeTab.icon size={26} color={theme.faint} />
          <Text style={{ color: theme.faint, fontSize: 13, marginTop: 10 }}>No {activeTab.label.toLowerCase()} yet. Add one with the button above, or save as you browse.</Text>
        </View>
      )}
    </View>
  );
}

// <webview> helpers: we create the webview element imperatively so we fully
// control its lifecycle and event wiring (React doesn't understand the
// `webview` custom element's events). All navigation/state flows back to App
// through handlersRef.current.
function contextParams(params) {
  return {
    x: params.x, y: params.y,
    linkURL: params.linkURL || '',
    srcURL: params.srcURL || '',
    mediaType: params.mediaType,
    isEditable: params.isEditable,
    selectionText: (params.selectionText || '').trim(),
    editFlags: params.editFlags || {}
  };
}

function rectOf(el) {
  try { return el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0 }; }
  catch (_) { return { left: 0, top: 0 }; }
}

function WebviewHost({ tab, active, preloadUrl, incognito, webviewsRef, handlersRef, contentRef }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const wv = document.createElement('webview');
    if (preloadUrl) wv.setAttribute('preload', preloadUrl);
    wv.setAttribute('partition', incognito ? 'flow-incognito' : 'persist:flow-main');
    wv.setAttribute('webpreferences', 'contextIsolation=yes sandbox=no');

    // Electron sizes <webview> guests from the element's native bounds. Do not
    // apply CDP device emulation here: it can retain a stale viewport height
    // after maximize/restore and render a page as a short horizontal strip.
    wv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;min-width:100%;min-height:100%;border:none;display:block;background:#ffffff;';

    host.appendChild(wv);
    webviewsRef.current.set(tab.id, wv);

    // Chromium guests occasionally retain the tiny pre-layout size they had
    // when first attached. Drive the guest with explicit pixel bounds on every
    // host resize; percentages alone do not reliably resize Electron webviews.
    const sizeGuest = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      wv.style.width = `${Math.ceil(rect.width)}px`;
      wv.style.height = `${Math.ceil(rect.height)}px`;
    };
    const resizeObserver = new ResizeObserver(sizeGuest);
    resizeObserver.observe(host);
    sizeGuest();

    const h = () => handlersRef.current;

    let loaded = false;
    const applySrc = () => {
      if (loaded) return;
      loaded = true;
      if (tab.url && tab.url !== 'about:blank') wv.setAttribute('src', tab.url);
    };

    requestAnimationFrame(applySrc);

    const onNav = (e, url) => { if (url && url !== 'about:blank') { h().updateUrl(tab.id, url); try { const t = wv.getTitle(); if (t) h().updateTitle(tab.id, t); } catch (_) {} h().addHistory(url, ''); } };
    const onTitle = (e, title) => { if (title) h().updateTitle(tab.id, title); };
    const onFavicon = (e, favicons) => { if (favicons && favicons[0]) h().updateFavicon(tab.id, favicons[0]); };
    const onStartLoad = () => h().updateLoading(tab.id, true);
    const onStopLoad = () => {
      h().updateLoading(tab.id, false);
      try { const t = wv.getTitle(); if (t) h().updateTitle(tab.id, t); } catch (_) {}
      try {
        wv.executeJavaScript(`(function(){var l=document.querySelector('link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]');return l?l.href:null})()`).then(fav => {
          if (fav) h().updateFavicon(tab.id, fav);
          else { try { const u = new URL(wv.getURL()); h().updateFavicon(tab.id, 'https://www.google.com/s2/favicons?domain=' + u.hostname + '&sz=32'); } catch (_) {} }
        }).catch(() => { try { const u = new URL(wv.getURL()); h().updateFavicon(tab.id, 'https://www.google.com/s2/favicons?domain=' + u.hostname + '&sz=32'); } catch (_) {} });
      } catch (_) {}
    };
    const onFound = (e, result) => h().findResult(result);
    const onFail = (e, errorCode, errorDescription, validatedURL) => {
      if (!validatedURL || validatedURL === 'about:blank' || errorCode === -3 || errorCode === -2) return;
      h().navError(tab.id, validatedURL, errorDescription);
    };
    const onCtx = (e, params) => {
      h().contextMenu({ ...contextParams(params), x: params.x + host.getBoundingClientRect().left, y: params.y + host.getBoundingClientRect().top });
    };
    const onNewWin = (e, url) => { e.preventDefault(); if (url) h().newTab(url); };
    const onDomReady = () => {
      try { h().register(wv.getWebContentsId()); } catch (_) {}
      sizeGuest();
    };

    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    wv.addEventListener('page-title-updated', onTitle);
    wv.addEventListener('page-favicon-updated', onFavicon);
    wv.addEventListener('did-start-loading', onStartLoad);
    wv.addEventListener('did-stop-loading', onStopLoad);
    wv.addEventListener('found-in-page', onFound);
    wv.addEventListener('did-fail-load', onFail);
    wv.addEventListener('context-menu', onCtx);
    wv.addEventListener('new-window', onNewWin);
    wv.addEventListener('dom-ready', onDomReady);

    return () => {
      resizeObserver.disconnect();
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onNav);
      wv.removeEventListener('page-title-updated', onTitle);
      wv.removeEventListener('page-favicon-updated', onFavicon);
      wv.removeEventListener('did-start-loading', onStartLoad);
      wv.removeEventListener('did-stop-loading', onStopLoad);
      wv.removeEventListener('found-in-page', onFound);
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('context-menu', onCtx);
      wv.removeEventListener('new-window', onNewWin);
      wv.removeEventListener('dom-ready', onDomReady);
      try { webviewsRef.current.delete(tab.id); } catch (_) {}
      if (wv.parentNode) wv.parentNode.removeChild(wv);
    };
  }, [tab.id, incognito]);

  useEffect(() => {
    if (hostRef.current) hostRef.current.style.visibility = active ? 'visible' : 'hidden';
  }, [active]);

  const prevUrlRef = useRef(tab.url);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const wv = host.firstChild;
    if (!wv || tab.url === prevUrlRef.current || tab.url === 'about:blank') return;
    prevUrlRef.current = tab.url;
    wv.setAttribute('src', tab.url);
  }, [tab.url]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const wv = host.firstChild;
    if (wv && preloadUrl) wv.setAttribute('preload', preloadUrl);
  }, [preloadUrl]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', background: '#ffffff', pointerEvents: active ? 'auto' : 'none' }} />;
}

function SidePanelHost({ info, preloadUrl, contentRef }) {
  const ref = useRef(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || !info.url || !preloadUrl) return undefined;
    const wv = document.createElement('webview');
    wv.setAttribute('src', info.url);
    wv.setAttribute('preload', preloadUrl);
    wv.setAttribute('partition', info.incognito ? 'flow-incognito' : 'persist:flow-main');
    wv.setAttribute('webpreferences', 'contextIsolation=yes sandbox=no');
    wv.style.position = 'absolute'; wv.style.top = '0'; wv.style.left = '0'; wv.style.right = '0'; wv.style.bottom = '0';
    wv.style.width = '100%'; wv.style.height = '100%'; wv.style.border = 'none'; wv.style.background = '#ffffff';
    host.appendChild(wv);
    return () => { if (wv.parentNode) wv.parentNode.removeChild(wv); };
  }, [info.extId, info.url, preloadUrl, info.incognito]);
  return <View ref={ref} style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: info.width || 400, zIndex: 6, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.12)' }} />;
}

// Dropdown position helpers (used by App's full-screen dropdown layer)
const getDropdownPos = (urlWrapRef) => {
  const el = urlWrapRef?.current;
  if (el && el.getBoundingClientRect) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.bottom, width: r.width };
  }
  return { left: 0, top: 90, width: Math.max(300, (window.innerWidth || 800) - 220) };
};
const getExtPanelPos = () => ({ x: Math.max(100, (window.innerWidth || 800) - 290), y: 90, width: 280 });

let TAB_SEQ = 2;
const nextId = () => TAB_SEQ++;

export default function App() {
  const [tabs, setTabs] = useState([{ id: 1, kind: 'web', title: 'New Tab', url: 'about:blank', loading: false }]);
  const [activeId, setActiveId] = useState(1);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [findCount, setFindCount] = useState({ active: 0, matches: 0 });
  const [zoom, setZoom] = useState(1);
  const [settings, setSettings] = useState({ theme: 'flow', searchEngine: 'google', blockTrackers: true, defaultZoom: 1, accentColor: '', startBackground: 'none' });
  const [bookmarks, setBookmarks] = useState([]);
  const [history, setHistory] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [profiles, setProfiles] = useState([{ id: 'default', name: 'Default' }]);
  const [activeProfile, setActiveProfile] = useState('default');
  const [extensions, setExtensions] = useState([]);
  const [extActs, setExtActs] = useState([]);
  const [extPanelOpen, setExtPanelOpen] = useState(false);
  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteFolders, setNoteFolders] = useState([]);
  const [installing, setInstalling] = useState(false);
  const [incognito, setIncognito] = useState(false);
  const [account, setAccount] = useState(null);
  const [passwords, setPasswords] = useState([]);
  const [pwEncAvail, setPwEncAvail] = useState(true);
  const [vaultState, setVaultState] = useState({ linked: false, unlocked: false, hasVault: false });
  const [vaultItems, setVaultItems] = useState([]);
  const [closingTabs, setClosingTabs] = useState(new Set());
  const [sidePanel, setSidePanel] = useState({ open: false, extId: null });
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const urlRef = useRef(null);
  const extActsRef = useRef(extActs); extActsRef.current = extActs;
  const pendingPwRef = useRef(null);
  const ddCooldownRef = useRef(false);
  const webviewsRef = useRef(new Map());
  const handlersRef = useRef({});
  const contentRef = useRef(null);
  const [preloadUrl, setPreloadUrl] = useState('');
  const [overlay, setOverlay] = useState(null);
  const dropdownOpenRef = useRef(false);

  const refreshExtActs = useCallback(async () => { if (ipc) setExtActs(await ipc.invoke('get-extension-actions') || []); }, []);
  useEffect(() => {
    if (!ipc) return;
    ipc.invoke('get-incognito').then(v => setIncognito(!!v));
    ipc.invoke('get-account').then(a => setAccount(a || null));
    ipc.invoke('pw-list').then(p => setPasswords(p || []));
    ipc.invoke('pw-encryption-available').then(v => setPwEncAvail(!!v));
    ipc.invoke('vault-state').then(v => setVaultState(v || { linked: false, unlocked: false, hasVault: false }));
    ipc.invoke('check-biometric-available').then(v => setBiometricAvailable(!!v));
    refreshExtActs();
  }, [refreshExtActs]);

  const changeVaultPin = useCallback(async () => {
    const currentPin = prompt('Enter current vault PIN:');
    if (!currentPin) return;
    const newPin = prompt('Enter new 6-digit PIN:');
    if (!newPin) return;
    const confirmPin = prompt('Confirm new PIN:');
    if (newPin !== confirmPin) { alert('PINs do not match'); return; }
    const result = await ipc?.invoke('change-vault-pin', currentPin, newPin);
    if (result?.success) { alert('PIN changed successfully'); }
    else { alert(result?.error || 'Failed to change PIN'); }
  }, []);

  const tab = tabs.find(t => t.id === activeId) || tabs[0];
  const theme = resolveTheme(settings.theme, settings.accentColor);
  const isWeb = tab.kind === 'web';
  const isStart = isWeb && (!tab.url || tab.url === 'about:blank');
  const showViewLive = isWeb && !isStart;
  const storeId = showViewLive ? storeIdOf(tab.url) : null;
  const marked = isWeb && bookmarks.some(x => x.url === tab.url && tab.url !== 'about:blank');
  const viewTop = CHROME_H + (findOpen && showViewLive ? FIND_H : 0) + (storeId ? BANNER_H : 0);

  const activeIdRef = useRef(activeId); activeIdRef.current = activeId;
  const tabRef = useRef(tab); tabRef.current = tab;
  const themeRef = useRef(theme); themeRef.current = theme;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const viewTopRef = useRef(viewTop); viewTopRef.current = viewTop;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const urlWrapRef = useRef(null);

  const load = useCallback(async () => {
    if (!ipc) return;
    const [r, b, h, d, p, a, e, f, n, nf] = await Promise.all([
      ipc.invoke('get-settings'), ipc.invoke('get-bookmarks'), ipc.invoke('get-history'),
      ipc.invoke('get-downloads'), ipc.invoke('get-profiles'), ipc.invoke('get-active-profile'),
      ipc.invoke('get-extensions'), ipc.invoke('get-bookmark-folders'),
      ipc.invoke('get-notes'), ipc.invoke('get-note-folders')
    ]);
    setSettings(v => ({ ...v, ...r }));
    setBookmarks(b || []); setHistory(h || []); setDownloads(d || []);
    setProfiles(p || []); setActiveProfile(a || 'default'); setExtensions(e || []); setFolders(f || []);
    setNotes(n || []); setNoteFolders(nf || []);
    if (r?.autoUpdate !== false) ipc.invoke('check-for-updates').then(result => {
      if (result?.available) console.info(`[Flowr] Update ${result.latestVersion} is available`);
    }).catch(() => {});
    // Trigger a background Tieddr Space sync on load — if the user is
    // signed in, this fetches fresh bookmarks/notes from Space and the
    // bookmarks-changed/notes-changed listeners above will update state.
    ipc.invoke('sync-tieddr-bookmarks').catch(() => {});
  }, []);

  const openWebTab = useCallback((u = 'about:blank') => {
    const id = nextId();
    setTabs(v => v.concat({ id, kind: 'web', title: 'New Tab', url: 'about:blank', loading: false }));
    setActiveId(id);
    if (u && u !== 'about:blank') setTimeout(() => {
      setTabs(v => v.map(t => t.id === id ? { ...t, url: u, title: host(u), loading: true } : t));
    }, 80);
    return id;
  }, []);

  const openPage = useCallback(kind => {
    setTabs(v => {
      const existing = v.find(t => t.kind === kind);
      if (existing) { setActiveId(existing.id); return v; }
      const id = nextId();
      setActiveId(id);
      return v.concat({ id, kind, title: PAGES[kind].title, url: `flow://${kind}` });
    });
  }, []);

  const go = useCallback(v => {
    const u = urlOf(v, settingsRef.current);
    if (tabRef.current.kind === 'web') {
      setTabs(x => x.map(t => t.id === tabRef.current.id ? { ...t, url: u, title: host(u), loading: true } : t));
    } else openWebTab(u);
  }, [openWebTab]);

  const closeTab = useCallback(id => {
    setClosingTabs(prev => new Set([...prev, id]));
    setTimeout(() => {
      setTabs(prev => {
        const idx = prev.findIndex(t => t.id === id);
        const left = prev.filter(t => t.id !== id);
        if (!left.length) {
          const nid = nextId();
          setActiveId(nid);
          return [{ id: nid, kind: 'web', title: 'New Tab', url: 'about:blank', loading: false }];
        }
        if (id === activeIdRef.current) setActiveId(left[Math.min(idx, left.length - 1)].id);
        return left;
      });
      setClosingTabs(prev => { const n = new Set(prev); n.delete(id); return n; });
    }, 210);
  }, []);

  const reorderTab = useCallback((id, target) => {
    setTabs(prev => {
      const from = prev.findIndex(t => t.id === id);
      if (from < 0 || from === target) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }, []);

  const bookmark = useCallback(async () => {
    const t = tabRef.current;
    if (t.kind !== 'web' || t.url === 'about:blank') return;
    setBookmarks(await ipc.invoke('add-bookmark', { url: t.url, title: t.title || host(t.url), favicon: t.favicon }) || []);
  }, []);

  const activeWebview = useCallback(() => webviewsRef.current.get(activeIdRef.current), []);

  const home = useCallback(() => {
    const t = tabRef.current;
    if (t.kind === 'web') {
      const wv = webviewsRef.current.get(t.id);
      if (wv) { try { wv.loadURL('about:blank'); } catch (_) {} }
      setTabs(v => v.map(x => x.id === t.id ? { ...x, url: 'about:blank', title: 'New Tab', favicon: undefined } : x));
    } else openWebTab();
  }, [openWebTab]);

  const back = useCallback(() => { const wv = activeWebview(); if (wv && wv.canGoBack && wv.canGoBack()) wv.goBack(); }, [activeWebview]);
  const forward = useCallback(() => { const wv = activeWebview(); if (wv && wv.canGoForward && wv.canGoForward()) wv.goForward(); }, [activeWebview]);

  // Dropdown state (lifted from Nav for full-screen overlay)
  const [navFocused, setNavFocused] = useState(false);
  const [navSelIdx, setNavSelIdx] = useState(-1);
  const [navInput, setNavInput] = useState('');
  const navClickingSuggestion = useRef(false);
  const navDdCooldownRef = useRef(false);

  // Suggestions derived from navInput, bookmarks, history
  const navSuggestions = useMemo(() => {
    if (!navFocused || !navInput.trim()) return [];
    const q = navInput.trim().toLowerCase();
    const seen = new Set();
    const results = [];
    for (const b of bookmarks || []) {
      const title = (b.title || '').toLowerCase();
      const url = (b.url || '').toLowerCase();
      if ((title.includes(q) || url.includes(q)) && !seen.has(b.url)) { results.push({ url: b.url, title: b.title || host(b.url), type: 'bookmark', favicon: b.favicon || null }); seen.add(b.url); }
      if (results.length >= 5) break;
    }
    for (const h of history || []) {
      const title = (h.title || '').toLowerCase();
      const url = (h.url || '').toLowerCase();
      if ((title.includes(q) || url.includes(q)) && !seen.has(h.url)) { results.push({ url: h.url, title: h.title || host(h.url), type: 'history', favicon: h.favicon || null }); seen.add(h.url); }
      if (results.length >= 8) break;
    }
    if (navInput.trim().length > 2) {
      results.push({ url: 'https://www.google.com/search?q=' + encodeURIComponent(navInput.trim()), title: 'Search for "' + navInput.trim() + '"', type: 'search', favicon: null });
    }
    return results.slice(0, 8);
  }, [navInput, navFocused, bookmarks, history]);

  const navNavigateSuggestion = useCallback((url) => { setNavInput(''); setNavFocused(false); go(url); }, [go]);
  const reload = useCallback(() => { const wv = activeWebview(); if (wv && wv.reload) wv.reload(); }, [activeWebview]);
  const stop = useCallback(() => { const wv = activeWebview(); if (wv && wv.stop) wv.stop(); }, [activeWebview]);

  const doZoom = useCallback(async dir => {
    const wv = activeWebview();
    let z = 1;
    if (wv && wv.getZoomFactor) z = wv.getZoomFactor() || 1;
    if (dir === 'in') z = Math.min(3, Math.round((z + 0.1) * 10) / 10);
    else if (dir === 'out') z = Math.max(0.3, Math.round((z - 0.1) * 10) / 10);
    else if (dir === 'reset') z = 1;
    if (wv && wv.setZoomFactor) { try { wv.setZoomFactor(z); } catch (_) {} }
    setZoom(z);
  }, [activeWebview]);
  const openFind = useCallback(() => { if (tabRef.current.kind === 'web') { setFindOpen(true); setFindText(''); setFindCount({ active: 0, matches: 0 }); } }, []);
  const closeFind = useCallback(() => {
    setFindOpen(false); setFindText('');
    const wv = activeWebview();
    if (wv && wv.stopFindInPage) { try { wv.stopFindInPage('clearSelection'); } catch (_) {} }
  }, [activeWebview]);
  const translate = useCallback(() => { const u = tabRef.current.url; if (u && u !== 'about:blank') openWebTab(`https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(u)}`); }, [openWebTab]);

  const showDialog = useCallback((d) => setOverlay({ kind: 'dialog', theme: theme, ...d }), [theme]);

  // Extension toolbar: click a pinned icon to open its popup, or the puzzle
  // button for the quick-view panel of all extensions.
  const clickExt = useCallback((a, e) => {
    const x = e?.nativeEvent?.pageX ?? (typeof window !== 'undefined' ? window.innerWidth - 120 : 0);
    // If the extension has a side_panel manifest key, toggle the side panel
    if (a.sidePanel) {
      setSidePanel({ open: true, extId: a.id, url: a.sidePanel, width: 400, incognito });
      return;
    }
    if (a.popup) ipc?.send('open-extension-popup', { popup: a.popup, x, y: CHROME_H });
    else openPage('extensions');
  }, [openPage, incognito]);
  const openExtPanel = useCallback(() => {
    const acts = extActsRef.current;
    if (!acts.length) { openPage('extensions'); return; }
    const x = typeof window !== 'undefined' ? window.innerWidth - 60 : 0;
    const items = acts.map(a => ({
      label: a.name, iconUrl: a.iconUrl, icon: 'Puzzle',
      action: a.popup ? { ext: { popup: a.popup, x, y: CHROME_H } }
        : a.sidePanel ? { sidePanel: { extId: a.id, url: a.sidePanel } }
        : { menu: 'page:extensions' }
    }));
    if (sidePanel.open) {
      items.push({ type: 'sep' }, { label: 'Close side panel', icon: 'PanelClose', action: { sidePanelClose: true } });
    }
    items.push({ type: 'sep' }, { label: 'Manage extensions', icon: 'Settings', action: { menu: 'page:extensions' } });
    setOverlay({ kind: 'menu', theme, items, width: 300 });
  }, [openPage, sidePanel.open, theme]);
  const pinExt = useCallback(async (id, pinned) => { setExtActs(await ipc.invoke('pin-extension', id, pinned) || []); }, []);
  const toggleExtension = useCallback(async (id, enabled) => { setExtActs(await ipc.invoke('toggle-extension', id, enabled) || []); }, []);

  // Build and open the glass browser menu in the overlay window.
  const openMenu = useCallback(() => {
    const t = tabRef.current;
    const canWeb = t.kind === 'web' && t.url && t.url !== 'about:blank';
    const items = [
      { label: 'New tab', icon: 'Plus', hint: 'Ctrl T', action: { menu: 'new-tab' } },
      { label: 'New window', icon: 'AppWindow', hint: 'Ctrl N', action: { menu: 'new-window' } },
      { label: 'New incognito window', icon: 'VenetianMask', hint: 'Ctrl ⇧ N', action: { menu: 'incognito' } },
      { type: 'sep' },
      { type: 'zoom' },
      { type: 'sep' },
      { label: 'Find in page', icon: 'Search', hint: 'Ctrl F', disabled: !canWeb, action: { menu: 'find' } },
      { label: 'Print…', icon: 'Printer', hint: 'Ctrl P', disabled: !canWeb, action: { cmd: 'print' } },
      { label: 'Save page as…', icon: 'Save', disabled: !canWeb, action: { cmd: 'savePage' } },
      { label: 'Translate page', icon: 'Languages', disabled: !canWeb, action: { menu: 'translate' } },
      { type: 'sep' },
      { label: 'Bookmark this page', icon: 'Star', hint: 'Ctrl D', disabled: !canWeb, action: { menu: 'bookmark' } },
      { label: 'Bookmarks', icon: 'Bookmark', action: { menu: 'page:bookmarks' } },
      { label: 'Notes', icon: 'FileText', action: { menu: 'page:notes' } },
      { label: 'History', icon: 'History', hint: 'Ctrl H', action: { menu: 'page:history' } },
      { label: 'Downloads', icon: 'Download', hint: 'Ctrl J', action: { menu: 'page:downloads' } },
      { label: 'Extensions', icon: 'Puzzle', action: { menu: 'page:extensions' } },
      { type: 'sep' },
      { label: 'Tieddr Vault', icon: 'Shield', action: { menu: 'page:vault' } },
      { label: 'Settings', icon: 'Settings', hint: 'Ctrl ,', action: { menu: 'page:settings' } }
    ];
    setOverlay({ kind: 'menu', theme, zoom: zoomRef.current, items, width: 288 });
  }, []);

  // Build a context menu from the params reported by main, and open it as glass.
  const openContext = useCallback((p) => {
    const items = [];
    const sep = () => items.push({ type: 'sep' });
    if (p.isEditable) {
      items.push({ label: 'Undo', icon: 'Undo2', disabled: !p.editFlags?.canUndo, action: { cmd: 'undo' } });
      items.push({ label: 'Redo', icon: 'Redo2', disabled: !p.editFlags?.canRedo, action: { cmd: 'redo' } });
      sep();
      items.push({ label: 'Cut', icon: 'Scissors', disabled: !p.editFlags?.canCut, action: { cmd: 'cut' } });
      items.push({ label: 'Copy', icon: 'Copy', disabled: !p.editFlags?.canCopy, action: { cmd: 'copy' } });
      items.push({ label: 'Paste', icon: 'ClipboardPaste', disabled: !p.editFlags?.canPaste, action: { cmd: 'paste' } });
      items.push({ label: 'Select all', icon: 'TextCursorInput', action: { cmd: 'selectAll' } });
    } else {
      if (p.linkURL) { items.push({ label: 'Open link in new tab', icon: 'ExternalLink', action: { open: p.linkURL } }); items.push({ label: 'Copy link address', icon: 'Copy', action: { cmd: 'copyText', arg: p.linkURL } }); sep(); }
      if (p.mediaType === 'image' && p.srcURL) { items.push({ label: 'Open image in new tab', icon: 'Image', action: { open: p.srcURL } }); items.push({ label: 'Save image as…', icon: 'Download', action: { cmd: 'saveImage', arg: p.srcURL } }); items.push({ label: 'Copy image', icon: 'Copy', action: { cmd: 'copyImage', arg: { x: p.x, y: p.y } } }); sep(); }
      if (p.selectionText) { items.push({ label: 'Copy', icon: 'Copy', action: { cmd: 'copy' } }); items.push({ label: `Search for “${trunc(p.selectionText, 24)}”`, icon: 'Search', action: { search: p.selectionText } }); sep(); }
      if (!p.ui) {
        items.push({ label: 'Back', icon: 'ArrowLeft', action: { cmd: 'back' } });
        items.push({ label: 'Forward', icon: 'ArrowRight', action: { cmd: 'forward' } });
        items.push({ label: 'Reload', icon: 'RotateCcw', action: { cmd: 'reload' } });
        sep();
        items.push({ label: 'Save page as…', icon: 'Save', action: { cmd: 'savePage' } });
        items.push({ label: 'Print…', icon: 'Printer', action: { cmd: 'print' } });
        sep();
        items.push({ label: 'Inspect', icon: 'Code2', action: { cmd: 'inspect', arg: { x: p.x, y: p.y } } });
      } else if (!items.length) {
        items.push({ label: 'Reload page', icon: 'RotateCcw', action: { cmd: 'reload' } });
      }
    }
    const x = p.x;
    const y = p.y;
    setOverlay({ kind: 'context', theme, x, y, items, width: 244 });
  }, []);

  // Execute an action reported back from the overlay window.
  const runAction = useCallback((a) => {
    if (!a) return;
    if (a.menu) {
      switch (a.menu) {
        case 'new-tab': openWebTab(); break;
        case 'new-window': ipc?.send('new-window', { incognito: false }); break;
        case 'incognito': ipc?.send('new-window', { incognito: true }); break;
        case 'find': openFind(); break;
        case 'translate': translate(); break;
        case 'bookmark': bookmark(); break;
        case 'zoom-in': doZoom('in'); break;
        case 'zoom-out': doZoom('out'); break;
        case 'zoom-reset': doZoom('reset'); break;
        default: if (a.menu.startsWith('page:')) openPage(a.menu.slice(5));
      }
    } else if (a.cmd) {
      const wv = activeWebview();
      const id = wv && wv.getWebContentsId ? wv.getWebContentsId() : null;
      ipc?.send('view-command', id, a.cmd, a.arg);
    }
    else if (a.open) openWebTab(a.open);
    else if (a.search) openWebTab(urlOf(a.search, settingsRef.current));
    else if (a.ext) ipc?.send('open-extension-popup', a.ext);
    else if (a.sidePanel) setSidePanel({ open: true, extId: a.sidePanel.extId, url: a.sidePanel.url, width: 400, incognito });
    else if (a.sidePanelClose) setSidePanel({ open: false, extId: null, url: null });
    else if (a.dialog === 'clear-data') ipc.invoke('clear-browsing-data').then(load);
    else if (a.dialog === 'reset') ipc.invoke('reset-settings').then(d => setSettings(v => ({ ...v, ...d })));
    else if (a.dialog === 'pw-save') { const p = pendingPwRef.current; if (p) ipc.invoke('pw-save', p).then(x => setPasswords(x || [])); }
    else if (a.kind === 'dd-click') { ddCooldownRef.current = true; setTimeout(() => { ddCooldownRef.current = false; }, 600); go(a.url); }
    else if (a.kind === 'dd-ext-click') { const ext = extActsRef.current.find(e => e.id === a.id); if (ext) clickExt(ext); }
    else if (a.kind === 'dd-ext-toggle') { toggleExtension(a.id, a.enabled); }
    else if (a.kind === 'dd-ext-pin') { pinExt(a.id, a.pinned); }
    else if (a.kind === 'dd-ext-settings' || a.kind === 'dd-ext-manage') { openPage('extensions'); }
  }, [openWebTab, openFind, translate, bookmark, doZoom, openPage, load, go, toggleExtension, pinExt, clickExt]);

  useEffect(() => {
    const wv = activeWebview();
    if (!wv || !wv.findInPage) return;
    if (findText) { try { wv.findInPage(findText, { forward: true, findNext: false }); } catch (_) {} }
    else { try { wv.stopFindInPage('clearSelection'); } catch (_) {} }
  }, [findText, activeWebview]);

  // Wire the webview event handlers so WebviewHost can route page events back
  // to this component's state. Assigned every render so closures stay fresh.
  const handlers = {
    updateUrl: (id, url) => setTabs(v => v.map(t => t.id === id ? { ...t, url } : t)),
    updateTitle: (id, title) => setTabs(v => v.map(t => t.id === id ? { ...t, title } : t)),
    updateFavicon: (id, favicon) => setTabs(v => v.map(t => t.id === id ? { ...t, favicon } : t)),
    updateLoading: (id, loading) => setTabs(v => v.map(t => t.id === id ? { ...t, loading } : t)),
    findResult: (r) => setFindCount({ active: r?.activeMatchOrdinal || 0, matches: r?.matches || 0 }),
    addHistory: (url, title) => ipc?.send('add-history', url, title),
    contextMenu: (p) => openContext(p),
    newTab: (url) => openWebTab(url),
    register: (id) => ipc?.send('register-webview', id),
    navError: (id, url, msg) => showDialog({ title: 'Could not load page', message: `${host(url) || 'Page'}${msg ? ': ' + msg : ''} — the site may block embedding. Try opening in a new window.` })
  };
  useEffect(() => { handlersRef.current = handlers; });

  useEffect(() => {
    if (!ipc) return;
    load();
    ipc.invoke('get-view-preload').then(url => setPreloadUrl(url || '')).catch(() => setPreloadUrl(''));
    ipc.on('request-new-tab', u => openWebTab(u));
    ipc.on('downloads-changed', x => setDownloads(x || []));
    // Pushed by a background Tieddr Space sync (on sign-in, on startup if
    // already signed in, and every ~15 min) — not tied to a user action, so
    // it needs its own listener rather than piggybacking on load()'s explicit
    // get-bookmarks/get-bookmark-folders calls.
    ipc.on('bookmarks-changed', b => { setBookmarks(b || []); ipc.invoke('get-bookmark-folders').then(f => setFolders(f || [])); });
    ipc.on('bookmark-folders-changed', x => setFolders(x || []));
    ipc.on('notes-changed', x => { setNotes(x || []); ipc.invoke('get-note-folders').then(f => setNoteFolders(f || [])); });
    ipc.on('note-folders-changed', x => setNoteFolders(x || []));
    ipc.on('profile-changed', load);
    ipc.on('show-context-menu', p => openContext(p));
    ipc.on('account-changed', a => { setAccount(a || null); setTimeout(load, 150); ipc.invoke('vault-state').then(v => setVaultState(v || { linked: false, unlocked: false, hasVault: false })); });
    ipc.on('vault-locked', () => { setVaultState(v => ({ ...v, unlocked: false })); setVaultItems([]); });
    ipc.on('side-panel-opened', (e, info) => setSidePanel({ open: true, extId: info?.extId || null, url: info?.url || null, width: info?.width || 400, incognito: !!info?.incognito }));
    ipc.on('side-panel-closed', () => setSidePanel({ open: false, extId: null, url: null }));
    ipc.on('pw-save-prompt', ({ origin, username, password }) => {
      pendingPwRef.current = { origin, username, password };
      showDialog({
        title: 'Save password?',
        message: `Save the password${username ? ' for ' + username : ''} on ${host(origin)}? ${pwEncAvail ? 'It will be encrypted with your system keychain' : 'It will be stored on this device'} and offered next time you sign in.`,
        actions: [{ label: 'Not now', action: null }, { label: 'Save password', primary: true, action: { dialog: 'pw-save' } }]
      });
    });
  }, [load, openWebTab, showDialog, openContext]);

  useEffect(() => {
    if (!ipc) return;
    ipc.on('shortcut', action => {
      switch (action) {
        case 'new-tab': case 'reopen': openWebTab(); break;
        case 'new-window': ipc.send('new-window', { incognito: false }); break;
        case 'incognito': ipc.send('new-window', { incognito: true }); break;
        case 'close-tab': closeTab(activeIdRef.current); break;
        case 'focus-url': urlRef.current?.focus?.(); break;
        case 'find': openFind(); break;
        case 'back': back(); break;
        case 'forward': forward(); break;
        case 'reload': reload(); break;
        case 'hard-reload': reload(); break;
        case 'zoom-in': doZoom('in'); break;
        case 'zoom-out': doZoom('out'); break;
        case 'zoom-reset': doZoom('reset'); break;
        case 'reader': { const wv = activeWebview(); ipc?.send('view-command', wv && wv.getWebContentsId ? wv.getWebContentsId() : null, 'reader'); break; }
        case 'devtools': { const wv = activeWebview(); ipc?.send('view-command', wv && wv.getWebContentsId ? wv.getWebContentsId() : null, 'devtools'); break; }
        case 'next-tab': setTabs(v => { const i = v.findIndex(t => t.id === activeIdRef.current); setActiveId(v[(i + 1) % v.length].id); return v; }); break;
        case 'prev-tab': setTabs(v => { const i = v.findIndex(t => t.id === activeIdRef.current); setActiveId(v[(i - 1 + v.length) % v.length].id); return v; }); break;
        case 'settings': openPage('settings'); break;
        case 'bookmarks': openPage('bookmarks'); break;
        case 'history': openPage('history'); break;
        case 'downloads': openPage('downloads'); break;
        case 'bookmark-page': bookmark(); break;
        default:
          if (action?.startsWith('tab-')) {
            const n = action === 'tab-last' ? -1 : parseInt(action.slice(4), 10) - 1;
            setTabs(v => { const t = n === -1 ? v[v.length - 1] : v[n]; if (t) setActiveId(t.id); return v; });
          }
      }
    });
  }, [openWebTab, closeTab, openPage, bookmark, openFind, back, forward, reload, doZoom]);

  const rmBookmark = async u => setBookmarks(await ipc.invoke('remove-bookmark', u));
  const moveBookmark = async (u, folder) => setBookmarks(await ipc.invoke('move-bookmark', u, folder));
  const createBookmarkFolder = async name => setFolders(await ipc.invoke('create-bookmark-folder', name));
  const signIn = async () => { const a = await ipc.invoke('tieddr-sign-in'); setAccount(a || null); const v = await ipc.invoke('vault-state'); setVaultState(v || { linked: false, unlocked: false, hasVault: false }); };
  const signOut = async () => { setAccount(await ipc.invoke('tieddr-sign-out')); await ipc.invoke('vault-lock'); setVaultState({ linked: false, unlocked: false, hasVault: false }); setVaultItems([]); };
  const revealPw = (o, u) => ipc.invoke('pw-reveal', o, u);
  const copyPw = (o, u) => ipc.invoke('pw-copy', o, u);
  const deletePw = async (o, u) => setPasswords(await ipc.invoke('pw-delete', o, u) || []);

  // --- Tieddr Vault ---
  const vaultRefresh = useCallback(async () => { const r = await ipc.invoke('vault-list'); if (r && r.ok) setVaultItems(r.items || []); }, []);
  const vaultUnlock = async (pin) => {
    const r = await ipc.invoke('vault-unlock', pin);
    if (r && r.ok) { setVaultState(v => ({ ...v, unlocked: true, hasVault: true })); await vaultRefresh(); }
    return r;
  };
  const vaultLock = async () => { await ipc.invoke('vault-lock'); setVaultState(v => ({ ...v, unlocked: false })); setVaultItems([]); };
  const vaultAdd = async (payload) => { const r = await ipc.invoke('vault-add', payload); if (r && r.ok) await vaultRefresh(); return r; };
  const vaultDelete = async (id) => { const r = await ipc.invoke('vault-delete', id); await vaultRefresh(); return r; };
  const vaultReveal = (id) => ipc.invoke('vault-reveal', id);
  const vaultCopy = (id) => ipc.invoke('vault-copy', id);
  const vaultSync = async () => { const r = await ipc.invoke('vault-sync'); await vaultRefresh(); return r; };
  useEffect(() => { if (vaultState.unlocked) vaultRefresh(); }, [vaultState.unlocked, vaultRefresh]);
  const clearHistory = async () => setHistory(await ipc.invoke('clear-history'));
  const clearDownloads = async () => setDownloads(await ipc.invoke('clear-downloads'));
  const update = async patch => setSettings(await ipc.invoke('update-settings', patch));
  const createProfile = async name => { if (name.trim()) setProfiles(await ipc.invoke('create-profile', name.trim())); };
  const switchProfile = async id => { await ipc.invoke('switch-profile', id); setActiveProfile(id); await load(); };
  const install = async () => { try { setExtensions(await ipc.invoke('install-unpacked-extension')); refreshExtActs(); } catch (e) { showDialog({ title: 'Extension could not load', message: e.message }); } };
  const installStore = async idOrUrl => {
    if (installing) return;
    setInstalling(true);
    try {
      const r = await ipc.invoke('install-store-extension', idOrUrl);
      if (r?.ok) { setExtensions(r.extensions || []); refreshExtActs(); openPage('extensions'); showDialog({ title: 'Extension added', message: `${r.name} is installed and enabled in Flow.` }); }
      else showDialog({ title: 'Could not add extension', message: r?.error || 'The extension could not be installed.' });
    } catch (e) { showDialog({ title: 'Could not add extension', message: e.message }); }
    finally { setInstalling(false); }
  };
  const clearData = () => showDialog({
    title: 'Clear browsing data?', message: 'This clears cache, cookies, site data, and history for this profile. Bookmarks are kept.',
    actions: [{ label: 'Cancel', action: null }, { label: 'Clear data', primary: true, action: { dialog: 'clear-data' } }]
  });
  const setDefault = async () => { const ok = await ipc.invoke('set-default-browser'); showDialog({ title: ok ? 'Request sent' : 'Could not set default', message: ok ? 'Flow asked Windows to handle web links. You may need to confirm in Windows settings.' : 'Windows blocked the change. Set Flow as default from Windows Settings → Apps → Default apps.' }); };
  const chooseDownloads = async () => { const p = await ipc.invoke('choose-download-path'); setSettings(v => ({ ...v, downloadPath: p })); };
  const reset = () => showDialog({
    title: 'Restore default settings?', message: 'Theme, search engine, privacy, and all preferences return to defaults. Bookmarks and history are kept.',
    actions: [{ label: 'Cancel', action: null }, { label: 'Restore defaults', primary: true, action: { dialog: 'reset' } }]
  });

  const pageContent = useMemo(() => ({
    bookmarks: <BookmarksPage items={bookmarks} folders={folders} go={go} remove={rmBookmark} move={moveBookmark} createFolder={createBookmarkFolder} theme={theme} account={account} />,
    notes: <NotesPage items={notes} folders={noteFolders} theme={theme} />,
    history: <HistoryPage items={history} go={go} clear={clearHistory} theme={theme} />,
    downloads: <DownloadsPage items={downloads} clear={clearDownloads} theme={theme} />,
    extensions: <ExtensionsPage items={extensions} acts={extActs} install={install} installStore={installStore} busy={installing} onPin={pinExt}
      onSidePanel={act => setSidePanel({ open: true, extId: act.id, url: act.sidePanel, width: 400, incognito })}
      remove={async id => { setExtensions(await ipc.invoke('remove-extension', id)); refreshExtActs(); }}
      toggle={async (id, en) => { setExtensions(await ipc.invoke('toggle-extension', id, en)); refreshExtActs(); }}
      theme={theme} />,
    vault: <TieddrVaultPage state={vaultState} items={vaultItems} account={account} onSignIn={signIn} onUnlock={vaultUnlock} onLock={vaultLock} onAdd={vaultAdd} onDelete={vaultDelete} onReveal={vaultReveal} onCopy={vaultCopy} onSync={vaultSync} theme={theme} />
  }), [bookmarks, notes, noteFolders, history, downloads, extensions, extActs, folders, installing, theme, go, vaultState, vaultItems, account, settings]);

  return (
    <View style={[s.app, { backgroundColor: theme.bg }]}>
      <View style={[s.chrome, { backgroundColor: theme.chrome + 'cc', borderBottomColor: theme.border + '60', zIndex: 1001 }]} {...GLASS_HEAVY}>
        <Tabs tabs={tabs} active={activeId} onSwitch={setActiveId} onClose={closeTab} onNew={() => openWebTab()} onReorder={reorderTab} incognito={incognito} account={account} closingTabs={closingTabs} theme={theme} />
        <Nav tab={tab} isWeb={isWeb} loading={tab.loading} urlRef={urlRef} go={go} back={back} forward={forward} reload={reload} home={home} menu={openMenu} bookmark={bookmark} bookmarked={marked}
          pinnedExts={extActs.filter(a => a.pinned)} onExt={clickExt} onExtPanel={() => setExtPanelOpen(!extPanelOpen)} bookmarks={bookmarks} history={history} theme={theme}
          extPanelOpen={extPanelOpen} setExtPanelOpen={setExtPanelOpen} extActs={extActs} clickExt={clickExt} openPage={openPage} toggleExtension={toggleExtension} pinExt={pinExt} showViewLive={showViewLive} ddCooldownRef={navDdCooldownRef} urlWrapRef={urlWrapRef}
          focused={navFocused} setFocused={setNavFocused} selIdx={navSelIdx} setSelIdx={setNavSelIdx} clickingSuggestion={navClickingSuggestion}
          input={navInput} setInput={setNavInput} />
        {showViewLive && tab.loading ? <LoadingBar theme={theme} /> : null}
      </View>
      {showViewLive && navFocused && navSuggestions.length > 0 && !navDdCooldownRef.current && (
        <View style={[s.suggestions, { position: 'absolute', ...getDropdownPos(urlWrapRef), zIndex: 1000, backgroundColor: theme.chrome + 'ee', borderBottomColor: theme.border }]} {...GLASS_HEAVY}>
          {navSuggestions.map((sg, i) => (
            <TouchableOpacity key={sg.url + i} style={[s.suggestionItem, { borderBottomColor: theme.border + '30' }, i === navSelIdx && { backgroundColor: theme.accentSoft }]} onPress={() => { navClickingSuggestion.current = false; navNavigateSuggestion(sg.url); }} onMouseDown={() => { navClickingSuggestion.current = true; }}>
              {sg.favicon ? <Image source={{ uri: sg.favicon }} style={s.suggestionIcon} /> : sg.type === 'bookmark' ? <Star size={14} color={theme.accent} /> : sg.type === 'search' ? <Search size={14} color={theme.muted} /> : <Globe size={14} color={theme.muted} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, color: theme.text, fontWeight: '500' }} numberOfLines={1}>{sg.title}</Text>
                <Text style={{ fontSize: 11, color: theme.muted, marginTop: 1 }} numberOfLines={1}>{host(sg.url)}</Text>
              </View>
              <Text style={{ fontSize: 10, color: theme.faint }}>{sg.type === 'bookmark' ? 'Bookmark' : sg.type === 'search' ? 'Search' : 'History'}</Text>
            </TouchableOpacity>
          ))}
          <View style={[s.suggestionHints, { borderTopColor: theme.border + '40', color: theme.muted }]}>
            <View style={s.suggestionHint}><Text style={s.suggestionKey}>↑↓</Text><Text>navigate</Text></View>
            <View style={s.suggestionHint}><Text style={s.suggestionKey}>↵</Text><Text>select</Text></View>
            <View style={s.suggestionHint}><Text style={s.suggestionKey}>Esc</Text><Text>close</Text></View>
          </View>
        </View>
      )}
      {showViewLive && extPanelOpen && !navDdCooldownRef.current && (
        <ExtensionDropdown 
          position={getExtPanelPos()}
          items={extActs}
          theme={theme}
          onClose={() => setExtPanelOpen(false)}
          onExt={clickExt}
          onSettings={() => { openPage('extensions'); setExtPanelOpen(false); }}
          onToggle={(id, enabled) => toggleExtension(id, enabled)}
          onPin={pinExt}
        />
      )}
      <View style={[s.content, { height: 'calc(100vh - ' + viewTop + 'px)' }]} ref={contentRef}>
        {isWeb ? (
          <>
            {tabs.filter(t => t.kind === 'web' && !(t.id === activeId && isStart)).map(t => (
              <WebviewHost key={t.id} tab={t} active={t.id === activeId} preloadUrl={preloadUrl} incognito={incognito} webviewsRef={webviewsRef} handlersRef={handlersRef} contentRef={contentRef} />
            ))}
            {isStart ? (
              <View style={[s.startLayer, { backgroundColor: theme.bg }]}>
                <Start go={go} open={openPage} bookmarks={bookmarks} history={history} account={account} settings={settings} theme={theme} />
              </View>
            ) : (
              <View style={s.topBar}>
                {findOpen ? <FindBar text={findText} setText={setFindText} count={findCount} onNext={() => { const wv = activeWebview(); if (wv && wv.findInPage) { try { wv.findInPage(findText, { forward: true, findNext: true }); } catch (_) {} } }} onPrev={() => { const wv = activeWebview(); if (wv && wv.findInPage) { try { wv.findInPage(findText, { forward: false, findNext: true }); } catch (_) {} } }} onClose={closeFind} theme={theme} /> : null}
                {storeId ? <StoreBanner onGet={() => installStore(storeId)} busy={installing} theme={theme} /> : null}
              </View>
            )}
          </>
        ) : tab.kind === 'settings'
          ? <SettingsPage settings={settings} profiles={profiles} active={activeProfile} update={update} createProfile={createProfile} switchProfile={switchProfile} openPage={openPage} go={go} clearData={clearData} setDefault={setDefault} chooseDownloads={chooseDownloads} reset={reset} account={account} onSignIn={signIn} onSignOut={signOut} passwords={passwords} onRevealPw={revealPw} onCopyPw={copyPw} onDeletePw={deletePw} pwEncAvail={pwEncAvail} theme={theme} biometricAvailable={biometricAvailable} changeVaultPin={changeVaultPin} />
          : <ScrollView style={s.pageScroll} contentContainerStyle={s.page}>{pageContent[tab.kind]}</ScrollView>}
        {sidePanel.open ? <SidePanelHost info={sidePanel} preloadUrl={preloadUrl} contentRef={contentRef} /> : null}
        {overlay ? <Overlay overlay={overlay} onAction={runAction} onClose={() => setOverlay(null)} onZoom={doZoom} zoom={zoom} /> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  app: { flex: 1, minWidth: 0 },
  chrome: { WebkitAppRegion: 'drag', zIndex: 10, borderBottomWidth: 1 },
  tabs: { height: 42, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 6 },
  drag: { width: 58, height: 32, alignItems: 'center', justifyContent: 'center' },
  incPill: { height: 22, borderRadius: 6, paddingHorizontal: 9, marginRight: 4, flexDirection: 'row', alignItems: 'center', gap: 5, WebkitAppRegion: 'no-drag' },
  incText: { fontSize: 11, fontWeight: '600' },
  tstrip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3, overflow: 'hidden' },
  tab: { height: 33, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden', WebkitAppRegion: 'no-drag' },
  newTab: { width: 30, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center', WebkitAppRegion: 'no-drag', marginLeft: 2 },
  fav: { width: 15, height: 15, borderRadius: 3 }, tt: { flex: 1, fontSize: 12.5, fontWeight: '550' },
  spin: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 }, close: { padding: 3, borderRadius: 5 },
  win: { flexDirection: 'row', gap: 2, marginLeft: 6 },
  ib: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', WebkitAppRegion: 'no-drag' },
  nav: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 6, WebkitAppRegion: 'no-drag', position: 'relative' },
  navBtns: { flexDirection: 'row', gap: 1, marginRight: 6 },
  extIcon: { width: 17, height: 17, borderRadius: 4 },
  navDivider: { width: 1, height: 18, marginHorizontal: 5, opacity: 0.6 },
  box: { flex: 1, height: 36, borderRadius: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, transitionProperty: 'border-color, background-color', transitionDuration: '150ms', transitionTimingFunction: EASE, position: 'relative' },
  url: { flex: 1, height: '100%', fontSize: 13, outlineStyle: 'none' },
  urlWrap: { flex: 1, position: 'relative' },
  suggestions: { position: 'absolute', top: 36, left: 0, right: 0, zIndex: 1000, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderWidth: 1, borderTopWidth: 0, overflow: 'hidden', maxHeight: 400 },
  suggestionItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1 },
  suggestionIcon: { width: 16, height: 16, borderRadius: 3 },
  suggestionHints: { flexDirection: 'row', gap: 12, padding: 8, borderTopWidth: 1, fontSize: 11 },
  suggestionHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  suggestionKey: { backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, fontFamily: 'monospace' },
  content: { position: 'relative', overflow: 'hidden', flex: 'none' },
  viewWrap: { flex: 1 }, mount: { flex: 1, width: '100%' },
  startLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50 },
  loadbar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, overflow: 'hidden', zIndex: 20 },
  loadbarInner: { height: '100%', width: '35%', borderRadius: 2 },
  find: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderBottomWidth: 1 },
  findInput: { flex: 1, height: '100%', fontSize: 13.5, outlineStyle: 'none' }, findCount: { fontSize: 12, minWidth: 44, textAlign: 'right' },
  banner: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: 1, WebkitAppRegion: 'no-drag' },
  bicon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  getBtn: { height: 34, borderRadius: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 7 }, getText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pageScroll: { flex: 1 }, page: { padding: 32, maxWidth: 1080, width: '100%', alignSelf: 'center' },
  start: { flex: 1 }, startIn: { minHeight: '100%', alignItems: 'center', paddingHorizontal: 28, paddingTop: 92, paddingBottom: 48 },
  startBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 },
  clockWrap: { alignItems: 'center', marginBottom: 26, zIndex: 1 },
  clock: { fontSize: 52, fontWeight: '200', letterSpacing: -1.5, lineHeight: 58 },
  greet: { fontSize: 15, marginTop: 6, fontWeight: '500' },
  startDate: { fontSize: 13, marginTop: 2, fontWeight: '400' },
  startSearch: { width: '100%', maxWidth: 620, height: 50, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 11, marginBottom: 28, zIndex: 1 },
  startSearchInput: { flex: 1, height: '100%', fontSize: 15, outlineStyle: 'none' },
  startProfile: { width: '100%', maxWidth: 620, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 24, zIndex: 1 },
  startAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  startProfileName: { fontSize: 13, fontWeight: '600' },
  startProfileSub: { fontSize: 11.5, marginTop: 1 },
  startProfileBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  startDials: { width: '100%', maxWidth: 620, flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 24, zIndex: 1 },
  startDial: { width: 80, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 4, alignItems: 'center', gap: 8, borderWidth: 1 },
  startDialIcon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  startDialLabel: { fontSize: 11, fontWeight: '500', maxWidth: 72, textAlign: 'center' },
  startQuickRow: { width: '100%', maxWidth: 620, flexDirection: 'row', gap: 8, marginBottom: 28, zIndex: 1 },
  startQuick: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  startQuickLabel: { fontSize: 12, fontWeight: '600' },
  startCols: { width: '100%', maxWidth: 620, flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center', zIndex: 1 },
  startMini: { flex: 1, minWidth: 270, borderRadius: 14, borderWidth: 1, padding: 16 },
  startMiniTitle: { fontSize: 13, fontWeight: '600' },
  startMiniAction: { fontSize: 12, fontWeight: '600' },
  startMiniRow: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 7, paddingHorizontal: 4, marginHorizontal: -4 },
  startMiniText: { flex: 1, fontSize: 12.5, fontWeight: '500' },
  startMiniEmpty: { fontSize: 12.5, lineHeight: 18 },
  startBranding: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 40, zIndex: 1 },
  startBrandText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  tabAvatar: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', WebkitAppRegion: 'no-drag' },
  search: { width: '100%', maxWidth: 620, height: 50, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 11, marginBottom: 30 },
  searchInput: { flex: 1, height: '100%', fontSize: 15, outlineStyle: 'none' },
  dials: { width: '100%', maxWidth: 620, flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 34 },
  dial: { width: 82, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 4, alignItems: 'center', gap: 9 },
  dialIcon: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dialLabel: { fontSize: 11.5, fontWeight: '500', maxWidth: 74, textAlign: 'center' },
  cols: { width: '100%', maxWidth: 620, flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center' },
  mini: { flex: 1, minWidth: 270, borderRadius: 12, borderWidth: 1, padding: 16 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  pt: { fontSize: 14, fontWeight: '600' }, link: { fontSize: 12.5, fontWeight: '600' },
  compact: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 7, paddingHorizontal: 6, marginHorizontal: -6 }, ct: { flex: 1, fontSize: 13, fontWeight: '500' }, muted: { fontSize: 13, lineHeight: 20 },
  head: { marginBottom: 22 }, h1: { fontSize: 23, fontWeight: '700', letterSpacing: -0.4 }, hd: { fontSize: 13.5, marginTop: 6, maxWidth: 640, lineHeight: 20 },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginBottom: 20 },
  chip: { height: 30, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }, chipText: { fontSize: 12.5, fontWeight: '600', maxWidth: 160 },
  newFolder: { height: 30, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  newFolderInput: { width: 92, height: '100%', fontSize: 12.5, fontWeight: '500', outlineStyle: 'none' },
  folderTag: { height: 22, borderRadius: 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 130 }, folderTagText: { fontSize: 11, fontWeight: '600' },
  movePanel: { borderWidth: 1, borderRadius: 10, padding: 11, marginTop: -4, marginBottom: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }, moveLabel: { fontSize: 12, fontWeight: '600', marginRight: 2 },
  syncBtn: { height: 28, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  bookmarkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  bookmarkCard: { width: 150, borderRadius: 12, borderWidth: 1, padding: 14, alignItems: 'center', gap: 7 },
  bookmarkCardIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bookmarkCardTitle: { fontSize: 12.5, fontWeight: '600', textAlign: 'center', width: '100%' },
  bookmarkCardUrl: { fontSize: 11, textAlign: 'center', width: '100%' },
  bookmarkCardBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  dayHeader: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8, marginTop: 6, marginLeft: 2 },
  dataRow: { minHeight: 60, borderRadius: 10, borderWidth: 1, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  rowTall: { minHeight: 74, borderRadius: 10, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  ri: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rb: { flex: 1, minWidth: 0 }, rt: { fontSize: 13.5, fontWeight: '600', marginBottom: 2 }, rs: { fontSize: 12, lineHeight: 17 }, rm: { fontSize: 12, minWidth: 84, textAlign: 'right' },
  download: { minHeight: 78, borderRadius: 10, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  track: { height: 5, borderRadius: 3, marginTop: 8, overflow: 'hidden' }, fillbar: { height: '100%', borderRadius: 3 },
  pill: { height: 28, borderRadius: 7, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }, pillText: { fontSize: 12, fontWeight: '600' },
  empty: { borderWidth: 1, borderRadius: 12, padding: 32, alignItems: 'center' },
  ei: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, et: { fontSize: 15, fontWeight: '600', marginBottom: 6 }, ed: { fontSize: 13.5, textAlign: 'center', lineHeight: 20, maxWidth: 360 },
  card: { borderRadius: 12, borderWidth: 1, padding: 18, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 16 }, cardBody: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  theme: { width: 200, borderRadius: 11, borderWidth: 1.5, padding: 12, position: 'relative' }, themeCheck: { position: 'absolute', top: 10, right: 10 },
  swatch: { height: 44, borderRadius: 8, borderWidth: 1, marginBottom: 10 }, thn: { fontSize: 13.5, fontWeight: '600', marginBottom: 3 }, thd: { fontSize: 12, lineHeight: 16 },
  toggle: { width: '100%', borderWidth: 1, borderRadius: 10, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 8 },
  togTrack: { width: 40, height: 24, borderRadius: 12, padding: 3, transitionProperty: 'background-color', transitionDuration: '200ms', transitionTimingFunction: EASE },
  togThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', transitionProperty: 'transform', transitionDuration: '220ms', transitionTimingFunction: EASE },
  label: { width: '100%', fontSize: 12.5, fontWeight: '600', marginTop: 8, marginBottom: 2 }, segs: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  seg: { height: 32, borderRadius: 8, borderWidth: 1, paddingHorizontal: 13, justifyContent: 'center' }, segText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  profile: { width: '100%', height: 40, borderRadius: 9, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, profileName: { flex: 1, fontSize: 13, fontWeight: '600' },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  about: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 6 },
  mark: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  inline: { width: '100%', height: 40, borderRadius: 9, borderWidth: 1, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', marginTop: 6 },
  inlineInput: { flex: 1, height: '100%', paddingHorizontal: 12, outlineStyle: 'none' },
  small: { height: '100%', justifyContent: 'center', paddingHorizontal: 14 }, smallText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  primary: { height: 40, borderRadius: 9, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }, primaryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  action: { height: 36, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }, actionText: { fontSize: 12.5, fontWeight: '600' },
  setWrap: { flex: 1, flexDirection: 'row' },
  setSide: { width: 262, borderRightWidth: 1, paddingHorizontal: 10, paddingTop: 14 },
  setBrand: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 8, marginBottom: 12 }, setBrandText: { fontSize: 15, fontWeight: '700' },
  setAccountBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 10, borderWidth: 1, marginBottom: 10, marginHorizontal: 2 },
  setSearch: { height: 34, borderRadius: 8, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, marginBottom: 12, marginHorizontal: 2 },
  setSearchInput: { flex: 1, height: '100%', fontSize: 13, outlineStyle: 'none' },
  setGroup: { fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, paddingHorizontal: 10, marginTop: 10, marginBottom: 4 },
  setItem: { minHeight: 34, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 1 }, setItemText: { flex: 1, fontSize: 13, fontWeight: '550' },
  setMain: { flex: 1 }, setMainIn: { padding: 34, maxWidth: 860, width: '100%' },
  setHero: { marginBottom: 24 },
  setHeroTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 }, setHeroHint: { fontSize: 13.5, marginTop: 4 },
  extDropdown: { position: 'absolute', top: '100%', right: 0, width: 280, borderRadius: 10, borderWidth: 1, overflow: 'hidden', zIndex: 1000 },
  extDropdownHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1 },
  extDropdownTitle: { fontSize: 13, fontWeight: '600' },
  extDropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 14 },
  extDropdownItemMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  extDropdownIcon: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  extDropdownItemInfo: { flex: 1, minWidth: 0 },
  extDropdownItemName: { fontSize: 13, fontWeight: '500' },
  extDropdownItemDesc: { fontSize: 11, marginTop: 2 },
  extDropdownActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  extDropdownToggle: { width: 28, height: 16, borderRadius: 8, position: 'relative' },
  extDropdownToggleDot: { width: 12, height: 12, borderRadius: 6, position: 'absolute', top: 2, left: 2 },
  extDropdownAction: { padding: 4 },
  extDropdownFooter: { padding: 10, borderTopWidth: 1 },
  extDropdownEmpty: { flexDirection: 'column', alignItems: 'center', gap: 8, padding: 24 },
  settingsHero: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 24, borderBottomWidth: 1, marginBottom: 24 },
  settingsHeroIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  settingsHeroTitle: { fontSize: 24, fontWeight: '700' },
  settingsHeroDesc: { fontSize: 14, marginTop: 4 },
  settingsCard: { borderRadius: 12, borderWidth: 1, marginBottom: 16, overflow: 'hidden' },
  settingsCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderBottomWidth: 1 },
  settingsCardTitle: { fontSize: 15, fontWeight: '600' },
  settingsCardBody: { padding: 16 },
  settingsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1 },
  settingsToggleInfo: { flex: 1 },
  settingsToggleLabel: { fontSize: 14, fontWeight: '500' },
  settingsToggleDetail: { fontSize: 12, marginTop: 2 },
  settingsToggleSwitch: { width: 40, height: 22, borderRadius: 11, position: 'relative' },
  settingsToggleDot: { width: 18, height: 18, borderRadius: 9, position: 'absolute', top: 2 }
});
