import React from 'react';
import { useBrandScope } from '../context/BrandScopeContext';

/**
 * Global brand portfolio pill bar. [] selected = "All brands".
 * Rendered once in App.tsx so every page shares the same scope.
 */
export const BrandScopeBar: React.FC = () => {
  const { brands, selected, toggle, clear } = useBrandScope();

  if (brands.length === 0) return null;

  const pill = (active: boolean, color?: string): React.CSSProperties => ({
    padding: '5px 12px',
    borderRadius: '999px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    border: `1.5px solid ${active ? (color || 'var(--primary)') : 'var(--border)'}`,
    backgroundColor: active ? `${color || 'var(--primary)'}22` : 'var(--card)',
    color: active ? (color || 'var(--primary)') : 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    whiteSpace: 'nowrap',
  });

  return (
    <div className="brand-scope-bar">
      <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: '4px' }}>
        Portfolio
      </span>
      <button style={pill(selected.length === 0)} onClick={clear}>All Brands</button>
      {brands.filter(b => b.active !== false).map(b => {
        const active = selected.includes(b.name);
        return (
          <button key={b.id} style={pill(active, b.color)} onClick={() => toggle(b.name)}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: b.color || 'var(--primary)', display: 'inline-block',
            }} />
            {b.name}
          </button>
        );
      })}
    </div>
  );
};
