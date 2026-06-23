import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  Search, ExternalLink, Camera, ThumbsUp, Play, Video,
  Link2, Megaphone, CheckSquare, HardDrive, LayoutGrid,
} from 'lucide-react';
import { db } from '../firebase/config';
import { useBrandScope } from '../context/BrandScopeContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { toDisplayDate } from '../utils/dateUtils';
import type { CampaignData, TaskData } from '../types';

/**
 * Post Link Library.
 *
 * No media is stored in the app. Tasks and campaigns carry an `assetLink`
 * (the published post / creative URL); this page renders them as preview
 * cards in a grid. Clicking a card opens the original post.
 */

type Platform = 'instagram' | 'tiktok' | 'facebook' | 'youtube' | 'drive' | 'other';

interface LinkItem {
  id: string;
  kind: 'task' | 'campaign';
  title: string;
  brand: string;
  link: string;
  platform: Platform;
  status?: string;
  date?: string;        // display date (scheduled/published or startDate)
  caption?: string;
}

const detectPlatform = (url: string): Platform => {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('facebook.com') || u.includes('fb.com') || u.includes('fb.watch')) return 'facebook';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('drive.google.com') || u.includes('docs.google.com')) return 'drive';
  return 'other';
};

const PLATFORM_META: Record<Platform, { label: string; color: string; Icon: React.ComponentType<{ size?: number | string }> }> = {
  instagram: { label: 'Instagram', color: '#C53070', Icon: Camera },
  tiktok: { label: 'TikTok', color: '#161823', Icon: Video },
  facebook: { label: 'Facebook', color: '#1A66C2', Icon: ThumbsUp },
  youtube: { label: 'YouTube', color: '#E2574C', Icon: Play },
  drive: { label: 'Drive', color: '#2E9E6B', Icon: HardDrive },
  other: { label: 'Link', color: '#7C6FF0', Icon: Link2 },
};

const domainOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
};

export const MediaLibrary: React.FC = () => {
  const { isInScope, colorOf } = useBrandScope();

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterPlatform, setFilterPlatform] = useState<'All' | Platform>('All');
  const [filterKind, setFilterKind] = useState<'All' | 'task' | 'campaign'>('All');

  useEffect(() => {
    let pending = 2;
    const done = () => { if (--pending <= 0) setLoading(false); };
    const u1 = onSnapshot(collection(db, 'tasks'), snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as TaskData)));
      done();
    }, err => { console.warn('tasks listener:', (err as Error).message); done(); });
    const u2 = onSnapshot(collection(db, 'campaigns'), snap => {
      setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() } as CampaignData)));
      done();
    }, err => { console.warn('campaigns listener:', (err as Error).message); done(); });
    return () => { u1(); u2(); };
  }, []);

  const items = useMemo<LinkItem[]>(() => {
    const out: LinkItem[] = [];

    for (const t of tasks) {
      const link = (t.assetLink || '').trim();
      if (!link) continue;
      out.push({
        id: `task-${t.id}`,
        kind: 'task',
        title: t.title,
        brand: t.brand,
        link,
        platform: detectPlatform(link),
        status: t.status,
        date: t.publishedDate || t.scheduledDate,
        caption: t.caption,
      });
    }

    for (const c of campaigns) {
      const links = [...(c.assetLinks || []), c.assetLink || '']
        .map(l => (l || '').trim())
        .filter((l, i, arr) => l && arr.indexOf(l) === i);
      links.forEach((link, idx) => {
        out.push({
          id: `campaign-${c.id}-${idx}`,
          kind: 'campaign',
          title: c.name,
          brand: c.brand,
          link,
          platform: detectPlatform(link),
          status: c.status,
          date: c.startDate,
        });
      });
    }

    return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [tasks, campaigns]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (!isInScope(i.brand)) return false;
      if (filterPlatform !== 'All' && i.platform !== filterPlatform) return false;
      if (filterKind !== 'All' && i.kind !== filterKind) return false;
      if (q && !(
        i.title.toLowerCase().includes(q) ||
        i.brand.toLowerCase().includes(q) ||
        i.link.toLowerCase().includes(q) ||
        (i.caption || '').toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [items, isInScope, filterPlatform, filterKind, search]);

  const open = (item: LinkItem) => window.open(item.link, '_blank', 'noopener,noreferrer');

  if (loading) return <LoadingSpinner message="Loading post links..." />;

  return (
    <div>
      {/* Search + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '220px',
          backgroundColor: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '8px 12px',
        }}>
          <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, brand, caption or URL…"
            style={{ border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: '13px', width: '100%' }}
          />
        </div>

        <select
          value={filterPlatform}
          onChange={e => setFilterPlatform(e.target.value as typeof filterPlatform)}
          style={{ padding: '8px 12px', backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px', outline: 'none' }}
        >
          <option value="All">All Platforms</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="facebook">Facebook</option>
          <option value="youtube">YouTube</option>
          <option value="drive">Drive</option>
          <option value="other">Other</option>
        </select>

        <select
          value={filterKind}
          onChange={e => setFilterKind(e.target.value as typeof filterKind)}
          style={{ padding: '8px 12px', backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '13px', outline: 'none' }}
        >
          <option value="All">Tasks & Campaigns</option>
          <option value="task">Tasks only</option>
          <option value="campaign">Campaigns only</option>
        </select>

        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
          {visible.length} link{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Grid */}
      {visible.length === 0 ? (
        <div className="section-card" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
          <LayoutGrid size={28} style={{ opacity: 0.4, marginBottom: '10px' }} />
          <p style={{ fontSize: '14px', marginBottom: '6px' }}>No post links yet.</p>
          <p style={{ fontSize: '12px' }}>
            Add a <strong>Post / Asset Link</strong> on any task or campaign and it will appear here as a preview card.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '14px' }}>
          {visible.map(item => {
            const meta = PLATFORM_META[item.platform];
            const Icon = meta.Icon;
            const KindIcon = item.kind === 'task' ? CheckSquare : Megaphone;
            const brandColor = colorOf(item.brand);
            return (
              <div
                key={item.id}
                onClick={() => open(item)}
                title={`Open on ${meta.label}: ${item.link}`}
                style={{
                  border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden',
                  backgroundColor: 'var(--card)', cursor: 'pointer',
                  transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                  display: 'flex', flexDirection: 'column',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 18px rgba(0,0,0,0.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; (e.currentTarget as HTMLDivElement).style.boxShadow = ''; }}
              >
                {/* Preview banner (platform-branded; no media stored) */}
                <div style={{
                  height: '86px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `linear-gradient(135deg, ${meta.color}22, ${meta.color}08)`,
                  borderBottom: `2.5px solid ${meta.color}`,
                  position: 'relative',
                }}>
                  <span style={{ color: meta.color }}><Icon size={30} /></span>
                  <span style={{
                    position: 'absolute', top: '8px', right: '8px',
                    fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px',
                    padding: '2px 8px', borderRadius: '999px',
                    backgroundColor: 'var(--card)', color: meta.color, border: `1px solid ${meta.color}55`,
                  }}>
                    {meta.label}
                  </span>
                </div>

                {/* Body */}
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                  <strong style={{
                    fontSize: '13px', lineHeight: 1.3,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {item.title}
                  </strong>

                  {item.caption && (
                    <span style={{
                      fontSize: '11px', color: 'var(--text-muted)',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {item.caption}
                    </span>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: 'auto' }}>
                    <span style={{
                      fontSize: '9px', fontWeight: 800, padding: '1px 8px', borderRadius: '999px',
                      backgroundColor: `${brandColor}1A`, color: brandColor,
                    }}>
                      {item.brand}
                    </span>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 700 }}>
                      <KindIcon size={9} /> {item.kind}
                    </span>
                    {item.status && <span className="badge low" style={{ fontSize: '9px', padding: '1px 6px' }}>{item.status}</span>}
                  </div>

                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: '10px', color: 'var(--text-light)',
                    borderTop: '1px solid var(--border)', paddingTop: '6px',
                  }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '70%' }}>
                      {domainOf(item.link)}{item.date ? ` · ${toDisplayDate(item.date)}` : ''}
                    </span>
                    <ExternalLink size={11} style={{ flexShrink: 0 }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
