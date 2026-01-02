/* Early theme bootstrap to avoid flash on load. */
(function(){
  'use strict';
  try {
    const THEME_STORAGE_KEY = 'SCT_DASHBOARD_THEME_V1';
    const THEME_TOGGLE_SEEN_KEY = 'SCT_THEME_TOGGLE_SEEN_V1';
    const THEME_PRESETS = {
      red: { accent: '#ff6b6b', accentStrong: '#ff9b93', accentRgb: '255,107,107' },
      orange: { accent: '#ff9f43', accentStrong: '#ffbf7a', accentRgb: '255,159,67' },
      gold: { accent: '#ffcf8f', accentStrong: '#ffe1b5', accentRgb: '255,207,143' },
      lemon: { accent: '#ffe066', accentStrong: '#ffe994', accentRgb: '255,224,102' },
      lime: { accent: '#b7ff5a', accentStrong: '#cdff8c', accentRgb: '183,255,90' },
      green: { accent: '#9eea6a', accentStrong: '#c1f28f', accentRgb: '158,234,106' },
      mint: { accent: '#6ff5c7', accentStrong: '#9af8d8', accentRgb: '111,245,199' },
      teal: { accent: '#5fe0d7', accentStrong: '#8cf0e9', accentRgb: '95,224,215' },
      cyan: { accent: '#54e6ff', accentStrong: '#87eeff', accentRgb: '84,230,255' },
      blue: { accent: '#7dc4ff', accentStrong: '#9ad5ff', accentRgb: '125,196,255' },
      sky: { accent: '#6aaeff', accentStrong: '#97c6ff', accentRgb: '106,174,255' },
      indigo: { accent: '#9a7cff', accentStrong: '#b6a1ff', accentRgb: '154,124,255' },
      violet: { accent: '#b08bff', accentStrong: '#c8aeff', accentRgb: '176,139,255' },
      magenta: { accent: '#ff66d4', accentStrong: '#ff94e1', accentRgb: '255,102,212' },
      pink: { accent: '#ff8fd3', accentStrong: '#ffb6e7', accentRgb: '255,143,211' },
      rose: { accent: '#ff7aa2', accentStrong: '#ffa2be', accentRgb: '255,122,162' },
      sand: { accent: '#e2c08c', accentStrong: '#ebd3ae', accentRgb: '226,192,140' },
      gray: { accent: '#c9d1d9', accentStrong: '#e4e9ef', accentRgb: '201,209,217' },
      darkRed: { accent: '#c44545', accentStrong: '#e07a7a', accentRgb: '196,69,69' },
      darkOrange: { accent: '#c26a2a', accentStrong: '#e49857', accentRgb: '194,106,42' },
      darkGold: { accent: '#c8a042', accentStrong: '#e0bc5e', accentRgb: '200,160,66' },
      darkLime: { accent: '#5aa83a', accentStrong: '#8cc275', accentRgb: '90,168,58' },
      darkGreen: { accent: '#39ff14', accentStrong: '#7bff5f', accentRgb: '57,255,20' },
      darkMint: { accent: '#1f8f6f', accentStrong: '#62b19a', accentRgb: '31,143,111' },
      darkTeal: { accent: '#1f9c8a', accentStrong: '#45b9aa', accentRgb: '31,156,138' },
      darkCyan: { accent: '#1a7f9b', accentStrong: '#5fa5b9', accentRgb: '26,127,155' },
      darkCopper: { accent: '#8b5a3b', accentStrong: '#ae8c76', accentRgb: '139,90,59' },
      darkBlue: { accent: '#2f6fb3', accentStrong: '#5c8fca', accentRgb: '47,111,179' },
      darkSky: { accent: '#2b5c9c', accentStrong: '#6b8dba', accentRgb: '43,92,156' },
      darkIndigo: { accent: '#4d2f7a', accentStrong: '#6e4aa6', accentRgb: '77,47,122' },
      darkViolet: { accent: '#5c3a8f', accentStrong: '#8d75b1', accentRgb: '92,58,143' },
      darkMagenta: { accent: '#9b3d86', accentStrong: '#b977aa', accentRgb: '155,61,134' },
      darkPink: { accent: '#b64b8f', accentStrong: '#d476b4', accentRgb: '182,75,143' },
      darkRose: { accent: '#a3465d', accentStrong: '#bf7e8e', accentRgb: '163,70,93' },
      darkSlate: { accent: '#5b6b7a', accentStrong: '#8c97a2', accentRgb: '91,107,122' },
      darkGray: { accent: '#8d949c', accentStrong: '#aeb5bd', accentRgb: '141,148,156' }
    };
    const THEME_ALIASES = { amber: 'gold', rose: 'red', violet: 'indigo', grey: 'gray', deepPurple: 'indigo', darkPurple: 'darkPink', yellow: 'lemon', limegreen: 'lime', aqua: 'cyan', turquoise: 'cyan', skyblue: 'sky', purple: 'violet', fuchsia: 'magenta', beige: 'sand', copper: 'darkCopper', slate: 'darkSlate' };
    const BASE_RGB = {
      bg: [10,15,20],
      'bg-deep': [7,11,16],
      'bg-alt': [10,14,19],
      'bg-dark': [8,12,16],
      'bg-ultra': [6,10,14],
      panel: [18,25,38],
      'panel-strong': [24,33,49],
      'panel-deep': [12,16,22],
      'panel-mid': [12,18,26],
      'panel-soft': [20,28,40],
      'panel-soft-alt': [20,28,38],
      'panel-hover': [22,30,42],
      'panel-edge': [24,34,46],
      surface: [16,22,31],
      'surface-strong': [18,26,36],
      'bg-subtle': [18,24,32],
      chip: [18,26,36]
    };
    const BASE_TINT = {
      bg: 0.12,
      'bg-deep': 0.1,
      'bg-alt': 0.12,
      'bg-dark': 0.1,
      'bg-ultra': 0.09,
      panel: 0.08,
      'panel-strong': 0.08,
      'panel-deep': 0.07,
      'panel-mid': 0.07,
      'panel-soft': 0.08,
      'panel-soft-alt': 0.08,
      'panel-hover': 0.08,
      'panel-edge': 0.08,
      surface: 0.09,
      'surface-strong': 0.09,
      'bg-subtle': 0.1,
      chip: 0.09
    };
    const resolveThemeId = (themeId)=>{
      if (THEME_PRESETS[themeId]) return themeId;
      const alias = THEME_ALIASES[themeId];
      return THEME_PRESETS[alias] ? alias : 'darkBlue';
    };
    const root = document.documentElement;
    const stored = localStorage.getItem(THEME_STORAGE_KEY) || 'darkBlue';
    const resolved = resolveThemeId(stored);
    const theme = THEME_PRESETS[resolved] || THEME_PRESETS.darkBlue;
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-strong', theme.accentStrong);
    root.style.setProperty('--accent-rgb', theme.accentRgb);
    root.style.setProperty('--glow-right', `rgba(${theme.accentRgb},0.2)`);
    root.style.setProperty('--glow-right-soft', `rgba(${theme.accentRgb},0.16)`);
    const accent = theme.accentRgb.split(',').map((v)=> Number(v.trim()) || 0);
    const mix = (base, amt)=> base.map((v, i)=> Math.round(v + (accent[i] - v) * amt));
    Object.entries(BASE_RGB).forEach(([key, base])=>{
      const amt = BASE_TINT[key] ?? 0.08;
      const mixed = mix(base, amt).join(',');
      root.style.setProperty(`--${key}-rgb`, mixed);
    });
    const themeSeen = localStorage.getItem(THEME_TOGGLE_SEEN_KEY) === '1';
    if (themeSeen) root.classList.add('theme-seen');
  } catch {}
})();
