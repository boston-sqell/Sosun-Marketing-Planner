import React, { useEffect, useRef, useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import { useMediaQuery } from '../hooks/useMediaQuery';

/**
 * Live UI theme customizer (sits next to the dark-mode toggle).
 *
 * The stylesheet derives every accent from --primary-hue/sat/lightness plus
 * --accent (gradient mix) and the --radius scale, so changing these variables
 * restyles the whole app instantly. Settings persist in localStorage.
 */
interface ThemeSettings {
  hue: number;        // primary hue (0-360)
  sat: number;        // saturation %
  light: number;      // lightness %
  accentHue: number;  // mix color used in gradients
  radius: number;     // base corner radius px
}

const DEFAULTS: ThemeSettings = { hue: 148, sat: 90, light: 34, accentHue: 148, radius: 12 };
const STORAGE_KEY = 'sosun-ui-theme';

const PRESETS: Array<{ name: string } & Omit<ThemeSettings, 'radius'>> = [
  { name: 'Sosun Green', hue: 148, sat: 90, light: 34, accentHue: 148 },
  { name: 'Forest Mix', hue: 148, sat: 90, light: 30, accentHue: 200 },
  { name: 'Ocean', hue: 210, sat: 85, light: 45, accentHue: 180 },
  { name: 'Royal', hue: 224, sat: 90, light: 60, accentHue: 262 },
  { name: 'Magenta', hue: 330, sat: 75, light: 45, accentHue: 20 },
  { name: 'Amber', hue: 35, sat: 90, light: 45, accentHue: 60 },
];

export function applyTheme(t: ThemeSettings) {
  const root = document.documentElement;
  root.style.setProperty('--primary-hue', String(t.hue));
  root.style.setProperty('--primary-sat', `${t.sat}%`);
  root.style.setProperty('--primary-lightness', `${t.light}%`);
  root.style.setProperty('--accent', `hsl(${t.accentHue}, ${t.sat}%, ${Math.min(t.light + 12, 62)}%)`);
  root.style.setProperty('--radius-sm', `${Math.max(2, t.radius - 6)}px`);
  root.style.setProperty('--radius', `${t.radius}px`);
  root.style.setProperty('--radius-lg', `${t.radius + 6}px`);
}

export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* corrupted settings: fall back to defaults */ }
  return DEFAULTS;
}

export const ThemeCustomizer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeSettings>(loadTheme);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Apply persisted theme on mount and on every change
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const slider = (
    label: string, value: number, min: number, max: number,
    onChange: (v: number) => void, suffix = '',
  ) => (
    <div style={{ marginBottom: 10 }} key={label}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
        <span>{label}</span><strong>{value}{suffix}</strong>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(parseInt(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--primary)' }}
      />
    </div>
  );

  const renderPanelContent = () => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ fontSize: 13 }}>Appearance</strong>
        <button className="btn-icon" title="Reset to Sosun Green" onClick={() => setTheme(DEFAULTS)}>
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Preset swatches */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {PRESETS.map(({ name, ...p }) => (
          <button
            key={name} title={name}
            onClick={() => setTheme(t => ({ ...t, ...p }))}
            style={{
              width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
              border: theme.hue === p.hue && theme.accentHue === p.accentHue
                ? '2.5px solid var(--text)' : '2px solid var(--border)',
              background: `linear-gradient(135deg, hsl(${p.hue}, ${p.sat}%, ${p.light}%), hsl(${p.accentHue}, ${p.sat}%, ${Math.min(p.light + 12, 62)}%))`,
            }}
          />
        ))}
      </div>

      {slider('Primary color (hue)', theme.hue, 0, 360, v => setTheme(t => ({ ...t, hue: v })))}
      {slider('Mix color (gradient hue)', theme.accentHue, 0, 360, v => setTheme(t => ({ ...t, accentHue: v })))}
      {slider('Intensity (saturation)', theme.sat, 30, 100, v => setTheme(t => ({ ...t, sat: v })), '%')}
      {slider('Brightness', theme.light, 25, 65, v => setTheme(t => ({ ...t, light: v })), '%')}
      {slider('Corner roundness', theme.radius, 2, 22, v => setTheme(t => ({ ...t, radius: v })), 'px')}

      <div style={{
        marginTop: 4, height: 34, borderRadius: 'var(--radius)',
        background: 'linear-gradient(135deg, var(--primary), var(--accent))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 12, fontWeight: 700,
      }}>
        Preview
      </div>
    </>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="theme-toggle" title="Customize colors & shape" onClick={() => setOpen(o => !o)}>
        <Palette size={18} />
      </button>

      {open && (
        isMobile ? (
          <div className="mobile-more-overlay" onClick={() => setOpen(false)}>
            <div className="mobile-more-sheet" onClick={e => e.stopPropagation()} style={{ paddingBottom: '32px' }}>
              <div className="mobile-more-handle" style={{ marginBottom: '16px' }} />
              {renderPanelContent()}
            </div>
          </div>
        ) : (
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 1000,
            width: 280, backgroundColor: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 16, boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
          }}>
            {renderPanelContent()}
          </div>
        )
      )}
    </div>
  );
};
