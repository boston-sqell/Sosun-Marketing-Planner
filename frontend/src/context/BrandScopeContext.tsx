import React, {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useSearchParams, useLocation } from 'react-router-dom';
import { db, auth } from '../firebase/config';
import type { Brand } from '../types';

/**
 * Global brand portfolio scope.
 *
 * - `brands`   : live catalog from the `brands` collection.
 * - `selected` : brand NAMES currently in scope ([] = all brands). Names are
 *                used (not ids) so legacy documents that store `brand: string`
 *                filter correctly without migration.
 * - Selection persists in the URL (?brands=A,B) — shareable, refresh-proof,
 *   and the back button works.
 */
interface BrandScope {
  brands: Brand[];
  selected: string[];
  isInScope: (brandName?: string | null) => boolean;
  anyInScope: (brandNames?: string[] | null) => boolean;
  toggle: (name: string) => void;
  clear: () => void;
  colorOf: (brandName?: string | null) => string;
}

const FALLBACK_COLOR = '#7C6FF0';

const Ctx = createContext<BrandScope | null>(null);

export const BrandScopeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [params, setParams] = useSearchParams();
  const location = useLocation();

  const isBudgetOrReports = location.pathname === '/budget' || location.pathname === '/reports';

  const selected = useMemo(() => {
    if (!isBudgetOrReports) return [];
    return params.get('brands')?.split(',').map(decodeURIComponent).filter(Boolean) ?? [];
  }, [params, isBudgetOrReports]);

  // Only subscribe to Firestore once the user is authenticated — avoids
  // permission errors on the login page.
  useEffect(() => {
    let unsubSnap: (() => void) | undefined;
    const unsubAuth = onAuthStateChanged(auth, user => {
      if (unsubSnap) { unsubSnap(); unsubSnap = undefined; }
      if (user) {
        unsubSnap = onSnapshot(
          query(collection(db, 'brands'), orderBy('name')),
          snap => setBrands(snap.docs.map(d => ({ id: d.id, ...d.data() } as Brand))),
          err => console.warn('brands listener:', (err as Error).message),
        );
      } else {
        setBrands([]);
      }
    });
    return () => { unsubAuth(); unsubSnap?.(); };
  }, []);

  const set = (names: string[]) => {
    setParams(prev => {
      const p = new URLSearchParams(prev);
      if (names.length) p.set('brands', names.map(encodeURIComponent).join(','));
      else p.delete('brands');
      return p;
    }, { replace: true });
  };

  const value = useMemo<BrandScope>(() => {
    const colorMap = new Map(brands.map(b => [b.name, b.color]));
    return {
      brands,
      selected,
      isInScope: name => !isBudgetOrReports || selected.length === 0 || (!!name && selected.includes(name)),
      anyInScope: names =>
        !isBudgetOrReports || selected.length === 0 || (names ?? []).some(n => selected.includes(n)),
      toggle: name => set(selected.includes(name)
        ? selected.filter(x => x !== name)
        : [...selected, name]),
      clear: () => set([]),
      colorOf: name => (name && colorMap.get(name)) || FALLBACK_COLOR,
    };
  }, [brands, selected, isBudgetOrReports]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useBrandScope = (): BrandScope => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBrandScope must be used inside BrandScopeProvider');
  return v;
};
