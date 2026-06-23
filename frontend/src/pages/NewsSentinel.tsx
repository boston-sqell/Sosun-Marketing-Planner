import React, { useEffect, useMemo, useState } from 'react';
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, setDoc, updateDoc, deleteDoc, runTransaction,
} from 'firebase/firestore';
import {
  Radar, Plus, ExternalLink, X, RotateCcw, Trash2, Check,
  Newspaper, Tag, Settings2, ArrowUpRight,
} from 'lucide-react';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { logActivity } from '../utils/activityLogger';
import { runScanNow } from '../services/newsApi';
import { formatTimeAgo } from '../utils/dateUtils';
import type { NewsSource, NewsKeyword, NewsMention } from '../types';
import './../styles/news.css';

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const SENTIMENT_META: Record<string, { label: string; cls: string }> = {
  positive: { label: 'Positive', cls: 'pos' },
  negative: { label: 'Negative', cls: 'neg' },
  neutral: { label: 'Neutral', cls: 'neu' },
};

type Tab = 'queue' | 'planner' | 'settings';

export const NewsSentinel: React.FC = () => {
  const { profile, role } = useAuth();
  const { brands, anyInScope, colorOf } = useBrandScope();
  const isAdmin = role === 'admin';

  const [tab, setTab] = useState<Tab>('queue');
  const [mentions, setMentions] = useState<NewsMention[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [keywords, setKeywords] = useState<NewsKeyword[]>([]);
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState<{ msg: string; warn?: boolean } | null>(null);

  // Add-to-planner modal
  const [modalFor, setModalFor] = useState<NewsMention | null>(null);
  const [mTitle, setMTitle] = useState('');
  const [mBrand, setMBrand] = useState('');
  const [mPriority, setMPriority] = useState('Medium');
  const [mNotes, setMNotes] = useState('');

  // New source / keyword inputs (admin)
  const [srcName, setSrcName] = useState('');
  const [srcUrl, setSrcUrl] = useState('');
  const [srcType, setSrcType] = useState<'rss' | 'html'>('rss');
  const [srcPattern, setSrcPattern] = useState('');
  const [srcProxy, setSrcProxy] = useState(false);
  const [kwText, setKwText] = useState('');
  const [kwBrand, setKwBrand] = useState('');

  // ── Live data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubs = [
      onSnapshot(
        query(collection(db, 'newsMentions'), orderBy('createdAt', 'desc'), limit(200)),
        (s) => setMentions(s.docs.map((d) => ({ id: d.id, ...d.data() } as NewsMention))),
        (e) => console.warn('mentions listener:', e.message),
      ),
      onSnapshot(
        query(collection(db, 'newsSources'), orderBy('createdAt', 'desc')),
        (s) => setSources(s.docs.map((d) => ({ id: d.id, ...d.data() } as NewsSource))),
        (e) => console.warn('sources listener:', e.message),
      ),
      onSnapshot(
        query(collection(db, 'newsKeywords'), orderBy('createdAt', 'desc')),
        (s) => setKeywords(s.docs.map((d) => ({ id: d.id, ...d.data() } as NewsKeyword))),
        (e) => console.warn('keywords listener:', e.message),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const flash = (msg: string, warn = false) => {
    setToast({ msg, warn });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const queue = useMemo(
    () => mentions.filter((m) => m.status === 'new' && anyInScope(m.brands)),
    [mentions, anyInScope],
  );
  const planner = useMemo(
    () => mentions.filter((m) => m.status === 'added' && anyInScope(m.brands)),
    [mentions, anyInScope],
  );

  // ── Actions ──────────────────────────────────────────────────────────────
  const scanNow = async (backfillDays?: number) => {
    setScanning(true);
    try {
      const s = await runScanNow(backfillDays);
      flash(
        s.written > 0
          ? `${s.written} new mention${s.written > 1 ? 's' : ''} detected${backfillDays ? ` (backfill ${backfillDays}d)` : ''}`
          : 'Scan complete — no new mentions',
        s.written === 0,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Scan failed', true);
    } finally {
      setScanning(false);
    }
  };

  const dismiss = (m: NewsMention) =>
    updateDoc(doc(db, 'newsMentions', m.id), { status: 'dismissed' }).catch((e) => flash(e.message, true));

  const undo = (m: NewsMention) =>
    updateDoc(doc(db, 'newsMentions', m.id), { status: 'new', plannerTaskId: '', plannerPriority: '' })
      .catch((e) => flash(e.message, true));

  const openModal = (m: NewsMention) => {
    setModalFor(m);
    setMTitle(`Press: ${m.title}`);
    setMBrand(m.brands[0] || brands[0]?.name || 'Sosun Fihaara');
    setMPriority('Medium');
    setMNotes('');
  };

  const confirmAdd = async () => {
    if (!modalFor) return;
    const m = modalFor;
    const taskId = doc(collection(db, 'tasks')).id;
    const now = new Date().toISOString();
    try {
      await runTransaction(db, async (tx) => {
        tx.set(doc(db, 'tasks', taskId), {
          id: taskId,
          title: mTitle,
          brand: mBrand,
          platforms: [],
          contentType: 'Other',
          campaignId: '',
          priority: mPriority,
          status: 'Idea',
          assignedTo: 'Internal',
          submittedBy: profile?.displayName || 'News Sentinel',
          notes: mNotes,
          assetLink: m.url,
          caption: '',
          checklist: [],
          comments: [],
          progress: 0,
          createdAt: now,
        });
        tx.update(doc(db, 'newsMentions', m.id), {
          status: 'added',
          plannerTaskId: taskId,
          plannerPriority: mPriority,
        });
      });
      await logActivity(profile?.displayName || 'User', role || 'internal', 'task', 'created task from news', mTitle, taskId);
      setModalFor(null);
      flash('Added to planner');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not add task', true);
    }
  };

  // Admin: sources / keywords CRUD (direct Firestore, gated by rules)
  const addSource = async () => {
    const name = srcName.trim();
    const url = srcUrl.trim();
    if (!name || !url) return;
    const id = doc(collection(db, 'newsSources')).id;
    const pattern = srcPattern.trim();
    await setDoc(doc(db, 'newsSources', id), {
      id, name, url, type: srcType,
      ...(srcType === 'html' && pattern ? { linkPattern: pattern } : {}),
      ...(srcProxy ? { useProxy: true } : {}),
      enabled: true,
      createdAt: new Date().toISOString(), createdBy: profile?.uid || '',
    } as NewsSource).catch((e) => flash(e.message, true));
    setSrcName(''); setSrcUrl(''); setSrcPattern(''); setSrcProxy(false);
  };
  const toggleSource = (s: NewsSource) =>
    updateDoc(doc(db, 'newsSources', s.id), { enabled: !s.enabled }).catch((e) => flash(e.message, true));
  const removeSource = (s: NewsSource) =>
    deleteDoc(doc(db, 'newsSources', s.id)).catch((e) => flash(e.message, true));

  const addKeyword = async () => {
    const keyword = kwText.trim();
    if (!keyword) return;
    const id = doc(collection(db, 'newsKeywords')).id;
    await setDoc(doc(db, 'newsKeywords', id), {
      id, keyword, brand: kwBrand || null, enabled: true,
      createdAt: new Date().toISOString(),
    } as NewsKeyword).catch((e) => flash(e.message, true));
    setKwText(''); setKwBrand('');
  };
  const removeKeyword = (k: NewsKeyword) =>
    deleteDoc(doc(db, 'newsKeywords', k.id)).catch((e) => flash(e.message, true));

  // ── Card renderer ──────────────────────────────────────────────────────────
  const Card: React.FC<{ m: NewsMention }> = ({ m }) => {
    const sent = SENTIMENT_META[m.sentiment || 'neutral'];
    return (
      <div className={`news-card ${m.status}`}>
        <div className="news-card-meta">
          <span className="news-src">{m.source}</span>
          <span className="news-time">{formatTimeAgo(m.detectedAt)}</span>
          {m.matchedKeywords.map((k) => (
            <span key={k} className="news-kw">⚑ {k}</span>
          ))}
          {m.brands.map((b) => (
            <span key={b} className="news-brand" style={{ '--c': colorOf(b) } as React.CSSProperties}>{b}</span>
          ))}
          {sent && <span className={`news-sent ${sent.cls}`}>{sent.label}</span>}
        </div>
        {/* React escapes text by default — external titles/excerpts cannot inject markup */}
        <div className="news-title">{m.title}</div>
        {m.excerpt && <div className="news-excerpt">{m.excerpt}</div>}
        <div className="news-actions">
          {m.status === 'new' ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => openModal(m)}>
                <Plus size={14} /> Add to Planner
              </button>
              <a className="btn btn-ghost btn-sm" href={m.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Open
              </a>
              <button className="btn btn-ghost btn-sm danger" onClick={() => dismiss(m)}>
                <X size={14} /> Dismiss
              </button>
            </>
          ) : (
            <>
              <span className="news-added-badge"><Check size={14} /> Added · {m.plannerPriority || 'Medium'}</span>
              <a className="btn btn-ghost btn-sm" href={m.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Open
              </a>
              <button className="btn btn-ghost btn-sm" onClick={() => undo(m)}>
                <RotateCcw size={14} /> Undo
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="news-page">
      <div className="news-toolbar">
        <div className="news-tabs">
          <button className={`news-tab ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>
            <Newspaper size={15} /> Queue <span className="news-count">{queue.length}</span>
          </button>
          <button className={`news-tab ${tab === 'planner' ? 'active' : ''}`} onClick={() => setTab('planner')}>
            <Tag size={15} /> Planner <span className="news-count warn">{planner.length}</span>
          </button>
          {isAdmin && (
            <button className={`news-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
              <Settings2 size={15} /> Sources & Keywords
            </button>
          )}
        </div>
        <div className="news-toolbar-actions">
          {isAdmin && (
            <button className="btn btn-ghost" onClick={() => scanNow(30)} disabled={scanning} title="Paginate JSON sources back ~1 month to populate the app (run once)">
              ⏳ Backfill 1 month
            </button>
          )}
          <button className="btn btn-primary" onClick={() => scanNow()} disabled={scanning}>
            <Radar size={16} className={scanning ? 'spin' : ''} /> {scanning ? 'Scanning…' : 'Scan Now'}
          </button>
        </div>
      </div>

      {tab === 'queue' && (
        <div className="news-feed">
          {queue.length === 0 ? (
            <div className="news-empty">
              <Radar size={40} />
              <h3>Nothing in the queue</h3>
              <p>Run a scan, or wait for the hourly sweep. New brand mentions land here for review.</p>
            </div>
          ) : (
            queue.map((m) => <Card key={m.id} m={m} />)
          )}
        </div>
      )}

      {tab === 'planner' && (
        <div className="news-feed">
          {planner.length === 0 ? (
            <div className="news-empty">
              <Tag size={40} />
              <h3>Planner is empty</h3>
              <p>Mentions you promote become tasks in the Tasks &amp; Queue. They are listed here too.</p>
            </div>
          ) : (
            planner.map((m) => <Card key={m.id} m={m} />)
          )}
        </div>
      )}

      {tab === 'settings' && isAdmin && (
        <div className="news-settings">
          <section className="news-sec">
            <h3>News Sources</h3>
            <p className="news-hint">
              Add an RSS/Atom feed URL. For outlets without a feed, use a Google News RSS search, e.g.
              <code> https://news.google.com/rss/search?q=%22Sosun+Fihaara%22&amp;hl=en-MV&amp;gl=MV </code>
            </p>
            <div className="news-row">
              <input className="form-input" placeholder="Display name (e.g. Avas)" value={srcName} onChange={(e) => setSrcName(e.target.value)} />
              <input className="form-input" placeholder={srcType === 'html' ? 'Listing page URL to scrape' : 'Feed URL'} value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} />
              <select className="form-select" style={{ maxWidth: 130 }} value={srcType} onChange={(e) => setSrcType(e.target.value as 'rss' | 'html')}>
                <option value="rss">RSS / Atom</option>
                <option value="html">HTML scrape</option>
              </select>
              <button className="btn btn-primary" onClick={addSource}>Add</button>
            </div>
            {srcType === 'html' && (
              <input className="form-input" style={{ marginBottom: 14 }} placeholder="Article link pattern (regex), e.g. /\d{4,}$ — optional" value={srcPattern} onChange={(e) => setSrcPattern(e.target.value)} />
            )}
            <label className="news-proxy-toggle">
              <input type="checkbox" checked={srcProxy} onChange={(e) => setSrcProxy(e.target.checked)} />
              <span>Fetch via proxy (for Cloudflare-blocked sites — needs PROXY_URL set on the server)</span>
            </label>
            <div className="news-list">
              {sources.map((s) => (
                <div key={s.id} className={`news-li ${s.enabled ? '' : 'off'}`}>
                  <label className="news-toggle">
                    <input type="checkbox" checked={s.enabled} onChange={() => toggleSource(s)} />
                    <span className="news-li-name">{s.name}</span>
                  </label>
                  <span className={`news-type-tag ${s.type}`}>{s.type === 'html' ? 'HTML' : s.type === 'json' ? 'JSON' : 'RSS'}</span>
                  {s.useProxy && <span className="news-type-tag proxy">PROXY</span>}
                  <a className="news-li-url" href={s.url} target="_blank" rel="noreferrer">{s.url} <ArrowUpRight size={12} /></a>
                  <button className="news-li-del" onClick={() => removeSource(s)} title="Delete"><Trash2 size={14} /></button>
                </div>
              ))}
              {sources.length === 0 && <div className="news-li-empty">No sources yet.</div>}
            </div>
          </section>

          <section className="news-sec">
            <h3>Brand Keywords</h3>
            <p className="news-hint">Each term is matched case-insensitively on whole words. Map it to a brand so mentions inherit the global brand filter.</p>
            <div className="news-row">
              <input className="form-input" placeholder="Keyword (e.g. Pascual)" value={kwText} onChange={(e) => setKwText(e.target.value)} />
              <select className="form-select" value={kwBrand} onChange={(e) => setKwBrand(e.target.value)}>
                <option value="">— No brand —</option>
                {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
              <button className="btn btn-primary" onClick={addKeyword}>Add</button>
            </div>
            <div className="news-chips">
              {keywords.map((k) => (
                <span key={k.id} className="news-chip">
                  {k.keyword}{k.brand ? ` · ${k.brand}` : ''}
                  <X size={13} onClick={() => removeKeyword(k)} />
                </span>
              ))}
              {keywords.length === 0 && <div className="news-li-empty">No keywords yet.</div>}
            </div>
          </section>

          <section className="news-sec">
            <h3>Scheduling</h3>
            <p className="news-hint">
              The scan runs server-side on a schedule (Cloud Scheduler → <code>POST /api/news/scan</code>). The button above
              triggers the same worker on demand. No browser tab needs to stay open.
            </p>
          </section>
        </div>
      )}

      {/* Add-to-Planner modal */}
      {modalFor && (
        <div className="news-modal-overlay" onClick={() => setModalFor(null)}>
          <div className="news-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add to Planner</h3>
            <p className="news-hint">Creates a task in Tasks &amp; Queue, linked to this article.</p>
            <label className="news-label">Task Title</label>
            <input className="form-input" value={mTitle} onChange={(e) => setMTitle(e.target.value)} />
            <label className="news-label">Brand</label>
            <select className="form-select" value={mBrand} onChange={(e) => setMBrand(e.target.value)}>
              {(mBrand && !brands.some((b) => b.name === mBrand)) && <option value={mBrand}>{mBrand}</option>}
              {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
            <label className="news-label">Priority</label>
            <select className="form-select" value={mPriority} onChange={(e) => setMPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label className="news-label">Notes</label>
            <textarea className="form-input" rows={3} value={mNotes} onChange={(e) => setMNotes(e.target.value)}
              placeholder="e.g. Positive Pascual mention — consider resharing." />
            <div className="news-modal-actions">
              <button className="btn btn-ghost" onClick={() => setModalFor(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmAdd}>Add to Planner</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`news-toast ${toast.warn ? 'warn' : ''}`}>{toast.msg}</div>}
    </div>
  );
};
