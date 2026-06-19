import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { FileBarChart2, RefreshCw, Download, ChevronDown, ChevronUp, Trash2, Printer } from 'lucide-react';
import { db, auth } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { useBrandScope } from '../context/BrandScopeContext';
import { LoadingSpinner } from '../components/LoadingSpinner';
import type { ReportDoc } from '../types';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

const ReportBody: React.FC<{ report: ReportDoc }> = ({ report }) => {
  const p = report.payload;
  if (!p) return null;

  const kpi = (title: string, value: string | number, sub?: string) => (
    <div className="stat-card" key={title}>
      <div className="stat-header"><span className="stat-title">{title}</span></div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 14 }}>
      <div className="card-grid" style={{ marginBottom: 16 }}>
        {kpi('Total Spend', p.spend.total.toLocaleString(), `${Object.keys(p.spend.byCategory).length} categories`)}
        {kpi('Campaigns', `${p.campaigns.active} active`, `${p.campaigns.completed} completed · spent ${p.campaigns.budgetSpent.toLocaleString()} / ${p.campaigns.budgetPlanned.toLocaleString()}`)}
        {kpi('Content Published', p.content.published, `${p.content.overdue} overdue`)}
        {kpi('Merchandising', p.retail.outletsCovered, `${p.retail.installed} installed · ${p.retail.verified} verified`)}
      </div>

      {p.brandBreakdown && p.brandBreakdown.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h5 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            Brand Breakdown
          </h5>
          {p.brandBreakdown.map(b => (
            <div key={b.brand} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span><strong>{b.brand}</strong></span>
              <span style={{ color: 'var(--text-muted)' }}>
                spend <strong style={{ color: 'var(--text)' }}>{b.spend.toLocaleString()}</strong>
                {' '}· {b.activeCampaigns} active campaigns · {b.published} published
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2col" style={{ gap: 16 }}>
        <div>
          <h5 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            Spend by Category
          </h5>
          {Object.entries(p.spend.byCategory).length === 0
            ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No spend recorded.</div>
            : Object.entries(p.spend.byCategory).map(([cat, amt]) => (
              <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{cat}</span><strong>{amt.toLocaleString()}</strong>
              </div>
            ))}

          <h5 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '14px 0 8px' }}>
            Published by Platform
          </h5>
          {Object.entries(p.content.byPlatform).length === 0
            ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing published.</div>
            : Object.entries(p.content.byPlatform).map(([pl, n]) => (
              <div key={pl} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{pl}</span><strong>{n}</strong>
              </div>
            ))}
        </div>

        <div>
          <h5 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            Events & Sponsorships
          </h5>
          {p.events.length === 0
            ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No events this period.</div>
            : p.events.map(e => (
              <div key={e.name} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{e.name}</strong>
                  <span style={{ fontWeight: 800, color: e.roi === null ? 'var(--text-muted)' : e.roi >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {e.roi === null ? '—' : `${(e.roi * 100).toFixed(1)}% ROI`}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {e.status} · cost {e.totalCost.toLocaleString()} · {e.leads} leads · sales {e.salesAttributed.toLocaleString()}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export const Reports: React.FC = () => {
  const { role } = useAuth();
  const { isInScope, selected } = useBrandScope();
  const canRun = role === 'admin' || role === 'internal';
  const isAdmin = role === 'admin';

  const [reports, setReports] = useState<ReportDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() =>
    onSnapshot(collection(db, 'reports'),
      snap => {
        setReports(snap.docs.map(d => ({ id: d.id, ...d.data() } as ReportDoc)));
        setLoading(false);
      },
      err => { console.warn('Reports access denied:', err.message); setLoading(false); }),
    []);

  const visible = useMemo(
    () => reports.filter(r => isInScope(r.brand))
      .sort((a, b) => b.period.localeCompare(a.period) || a.brand.localeCompare(b.brand)),
    [reports, isInScope],
  );

  const run = async () => {
    setRunning(true);
    setMessage('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${BACKEND}/api/reports/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(selected.length ? { period, brands: selected } : { period, combined: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Failed (${res.status})`);
      const ok = data.results.filter((r: any) => r.ok).length;
      setMessage(`Generated ${ok}/${data.results.length} brand report(s) for ${data.period}.`);
    } catch (e: any) {
      setMessage(`Generation failed: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const removeReport = async (r: ReportDoc) => {
    if (!window.confirm(`Delete report ${r.brand} · ${r.period}? This cannot be undone.`)) return;
    await deleteDoc(doc(db, 'reports', r.id));
  };

  /** Opens a print-ready view of the report; the browser's print dialog saves it as PDF. */
  const exportPDF = (r: ReportDoc) => {
    const p = r.payload;
    if (!p) return;
    const esc = (x: string) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rows = (obj: Record<string, number>) =>
      Object.entries(obj).map(([k, v]) =>
        `<tr><td>${esc(k)}</td><td class="num">${v.toLocaleString()}</td></tr>`).join('')
      || '<tr><td colspan="2">—</td></tr>';
    const eventRows = p.events.map(e =>
      `<tr><td>${esc(e.name)}</td><td>${esc(e.status)}</td><td class="num">${e.totalCost.toLocaleString()}</td><td class="num">${e.leads}</td><td class="num">${e.salesAttributed.toLocaleString()}</td><td class="num">${e.roi === null ? '—' : (e.roi * 100).toFixed(1) + '%'}</td></tr>`).join('')
      || '<tr><td colspan="6">No events this period.</td></tr>';
    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to export PDFs.'); return; }
    w.document.write(`<!doctype html><html><head><title>${esc(p.brand)} — ${p.period}</title><style>
      body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;margin:36px;}
      h1{font-size:22px;margin:0;} .sub{color:#666;font-size:13px;margin-bottom:20px;}
      h2{font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#0a7d43;border-bottom:2px solid #0a7d43;padding-bottom:4px;margin-top:26px;}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;}
      td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;} .num{text-align:right;}
      th{background:#f3f7f4;}
      .kpis{display:flex;gap:12px;margin-top:14px;} .kpi{border:1px solid #ddd;border-radius:8px;padding:10px 14px;flex:1;}
      .kpi b{display:block;font-size:20px;} .kpi span{font-size:11px;color:#666;}
    </style></head><body>
      <h1>${esc(p.brand)} — Monthly Brand Report</h1>
      <div class="sub">Period: ${p.period}${r.generatedAt ? ' · Generated ' + new Date(r.generatedAt).toLocaleString() : ''} · Sosun Fihaara Marketing Planner</div>
      <div class="kpis">
        <div class="kpi"><b>${p.spend.total.toLocaleString()}</b><span>Total spend</span></div>
        <div class="kpi"><b>${p.campaigns.active}</b><span>Active campaigns</span></div>
        <div class="kpi"><b>${p.content.published}</b><span>Posts published</span></div>
        <div class="kpi"><b>${p.retail.outletsCovered}</b><span>Outlets covered</span></div>
      </div>
      ${p.brandBreakdown && p.brandBreakdown.length ? `<h2>Brand Breakdown</h2><table><tr><th>Brand</th><th>Spend</th><th>Active campaigns</th><th>Published</th></tr>${p.brandBreakdown.map(b => `<tr><td>${esc(b.brand)}</td><td class="num">${b.spend.toLocaleString()}</td><td class="num">${b.activeCampaigns}</td><td class="num">${b.published}</td></tr>`).join('')}</table>` : ''}
      <h2>Spend by Category</h2><table>${rows(p.spend.byCategory)}</table>
      <h2>Campaigns</h2><table>
        <tr><td>Active</td><td class="num">${p.campaigns.active}</td></tr>
        <tr><td>Completed</td><td class="num">${p.campaigns.completed}</td></tr>
        <tr><td>Budget planned</td><td class="num">${p.campaigns.budgetPlanned.toLocaleString()}</td></tr>
        <tr><td>Budget spent</td><td class="num">${p.campaigns.budgetSpent.toLocaleString()}</td></tr>
      </table>
      <h2>Content by Platform</h2><table>${rows(p.content.byPlatform)}</table>
      <h2>Events &amp; Sponsorships</h2><table><tr><th>Event</th><th>Status</th><th>Cost</th><th>Leads</th><th>Sales</th><th>ROI</th></tr>${eventRows}</table>
      <h2>Merchandising</h2><table>
        <tr><td>Outlets covered</td><td class="num">${p.retail.outletsCovered}</td></tr>
        <tr><td>Installed</td><td class="num">${p.retail.installed}</td></tr>
        <tr><td>Verified</td><td class="num">${p.retail.verified}</td></tr>
      </table>
      <script>window.onload = function () { window.print(); };</script>
    </body></html>`);
    w.document.close();
  };

  const exportJSON = (r: ReportDoc) => {
    const blob = new Blob([JSON.stringify(r.payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${r.brand.replace(/\s+/g, '_')}_${r.period}_report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingSpinner message="Loading reports..." />;

  return (
    <div>
      <div className="section-card">
        <div className="section-header">
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileBarChart2 size={18} /> Brand Performance Reports
          </h3>
          {canRun && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="form-input" type="month" value={period}
                onChange={e => setPeriod(e.target.value)} style={{ width: 160 }} />
              <button className="btn btn-primary" onClick={run} disabled={running}>
                <RefreshCw size={15} className={running ? 'spinning-anim' : ''} />
                <span>{running ? 'Generating…' : 'Generate'}</span>
              </button>
            </div>
          )}
        </div>

        {message && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{message}</div>
        )}

        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
            No reports yet. {canRun ? 'Pick a period and hit Generate, or wait for the monthly scheduler.' : ''}
          </div>
        ) : visible.map(r => {
          const isOpen = expanded === r.id;
          return (
            <div key={r.id} style={{
              border: '1px solid var(--border)', borderRadius: 10, padding: 14,
              marginBottom: 12, backgroundColor: 'var(--bg)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setExpanded(isOpen ? null : r.id)}>
                <div>
                  <strong style={{ fontSize: 15 }}>{r.brand}</strong>
                  <span className="badge low" style={{ fontSize: 10, marginLeft: 8 }}>{r.period}</span>
                  <span className={`badge ${r.status === 'ready' ? 'approved' : r.status === 'failed' ? 'high' : 'medium'}`}
                    style={{ fontSize: 10, marginLeft: 6 }}>
                    {r.status}
                  </span>
                  {r.generatedAt && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                      {new Date(r.generatedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {r.status === 'ready' && (
                    <>
                      <button className="btn-icon" title="Export as PDF"
                        onClick={e => { e.stopPropagation(); exportPDF(r); }}>
                        <Printer size={14} />
                      </button>
                      <button className="btn-icon" title="Export JSON"
                        onClick={e => { e.stopPropagation(); exportJSON(r); }}>
                        <Download size={14} />
                      </button>
                    </>
                  )}
                  {isAdmin && (
                    <button className="btn-icon" title="Delete report"
                      onClick={e => { e.stopPropagation(); removeReport(r); }}>
                      <Trash2 size={14} style={{ color: 'var(--red)' }} />
                    </button>
                  )}
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>
              {isOpen && r.status === 'ready' && <ReportBody report={r} />}
              {isOpen && r.status === 'failed' && (
                <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 8 }}>{r.error}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
