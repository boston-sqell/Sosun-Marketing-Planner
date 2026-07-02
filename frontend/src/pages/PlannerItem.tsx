import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Lock } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi, prettyStatus } from '../services/plannerApi';
import type {
  ApiError,
  PlannerWorkItem,
  PlannerTransition,
  PlannerActivityEntry,
  PlannerWorkflow,
} from '../services/plannerApi';
import { StatusBadge } from './Planner';

const activityLabel = (e: PlannerActivityEntry): string => {
  switch (e.kind) {
    case 'created':
      return 'Created';
    case 'transition':
      return `Moved ${prettyStatus(String(e.payload.from))} → ${prettyStatus(String(e.payload.to))}`;
    default:
      return prettyStatus(e.kind);
  }
};

export const PlannerItem: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<PlannerWorkItem | null>(null);
  const [workflow, setWorkflow] = useState<PlannerWorkflow | null>(null);
  const [transitions, setTransitions] = useState<PlannerTransition[]>([]);
  const [activity, setActivity] = useState<PlannerActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validatorErrors, setValidatorErrors] = useState<string[]>([]);
  const [firing, setFiring] = useState<string | null>(null);
  const [approvalComment, setApprovalComment] = useState('');
  const [deciding, setDeciding] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const it = await plannerApi.get(id);
      const [trs, act, wf] = await Promise.all([
        plannerApi.transitions(id),
        plannerApi.activity(id),
        plannerApi.config.workflow(it.workflowId).catch(() => null),
      ]);
      setItem(it);
      setTransitions(trs);
      setActivity(act);
      setWorkflow(wf);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work item.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const fire = async (transitionId: string) => {
    if (!id) return;
    setFiring(transitionId);
    setError(null);
    setValidatorErrors([]);
    try {
      await plannerApi.transition(id, transitionId);
      await load();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 422 && apiErr.details?.length) {
        setValidatorErrors(apiErr.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)));
      } else {
        setError(apiErr.message || 'Transition failed.');
      }
    } finally {
      setFiring(null);
    }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    if (!id) return;
    if (decision === 'reject' && !approvalComment.trim()) {
      setError('A comment is required to reject.');
      return;
    }
    setDeciding(true);
    setError(null);
    try {
      await plannerApi.decide(id, decision, approvalComment.trim() || undefined);
      setApprovalComment('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit decision.');
    } finally {
      setDeciding(false);
    }
  };

  if (loading) return <LoadingSpinner message="Loading work item…" />;

  if (error && !item) {
    return (
      <div>
        <BackLink navigate={navigate} />
        <div style={bannerStyle}><AlertCircle size={16} /> {error}</div>
      </div>
    );
  }

  if (!item) return null;

  const fields = item.fields ?? {};
  const fieldKeys = Object.keys(fields);
  const statusMeta = workflow?.statuses.find((s) => s.id === item.status);

  return (
    <div style={{ maxWidth: 820 }}>
      <BackLink navigate={navigate} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h3 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{item.title}</h3>
        {item.locked && (
          <span title="Locked for editing by its workflow" style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <Lock size={13} /> Locked
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        <StatusBadge status={item.status} meta={statusMeta} />
        <span>{item.typeId} · {item.spaceId}</span>
      </div>

      {error && <div style={bannerStyle}><AlertCircle size={16} /> {error}</div>}
      {validatorErrors.length > 0 && (
        <div style={{ ...bannerStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><AlertCircle size={16} /> Can't make this move yet:</strong>
          <ul style={{ margin: '4px 0 0 24px', padding: 0 }}>
            {validatorErrors.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
        </div>
      )}

      {/* Transition buttons */}
      {transitions.length > 0 && (
        <div className="section-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Actions
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {transitions.map((t) => (
              <button key={t.id} className="btn btn-primary" onClick={() => fire(t.id)} disabled={firing !== null}>
                {firing === t.id ? 'Working…' : t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Approvals */}
      {item.approval && (
        <div className="section-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Approvals</span>
            <ApprovalStateBadge state={item.approval.state} />
          </div>

          {item.approval.decisions.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {item.approval.decisions.map((d, i) => (
                <li key={i} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, color: d.decision === 'approve' ? '#16a34a' : '#dc2626' }}>
                    {d.decision === 'approve' ? 'Approved' : 'Rejected'}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>stage {d.stageIndex + 1} · {new Date(d.ts).toLocaleString()}</span>
                  {d.comment && <span style={{ fontStyle: 'italic' }}>“{d.comment}”</span>}
                </li>
              ))}
            </ul>
          )}

          {item.approval.state === 'pending' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Awaiting stage {item.approval.stageIndex + 1} sign-off.</div>
              <textarea
                value={approvalComment}
                onChange={(e) => setApprovalComment(e.target.value)}
                placeholder="Comment (required to reject)…"
                rows={2}
                style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => decide('approve')} disabled={deciding}>
                  {deciding ? 'Submitting…' : 'Approve'}
                </button>
                <button
                  onClick={() => decide('reject')}
                  disabled={deciding || !approvalComment.trim()}
                  style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: deciding || !approvalComment.trim() ? 'not-allowed' : 'pointer', opacity: !approvalComment.trim() ? 0.6 : 1 }}
                >
                  Reject
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              This approval is {item.approval.state}.
            </div>
          )}
        </div>
      )}

      {/* Overview */}
      <div className="section-card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={sectionTitle}>Overview</div>
        {item.description ? (
          <p style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>{item.description}</p>
        ) : (
          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No description.</p>
        )}
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0, fontSize: 14 }}>
          <Row label="Priority" value={item.priority ?? '—'} />
          <Row label="Brands" value={(item.brandIds ?? []).join(', ') || '—'} />
          <Row label="Start" value={item.startDate ?? '—'} />
          <Row label="Due" value={item.dueDate ?? '—'} />
          {fieldKeys.map((k) => (
            <Row key={k} label={k} value={String(fields[k] ?? '—')} />
          ))}
        </dl>
      </div>

      {/* Activity */}
      <div className="section-card" style={{ padding: 16 }}>
        <div style={sectionTitle}>Activity</div>
        {activity.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>No activity yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activity.map((e) => (
              <li key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span>{activityLabel(e)}</span>
                <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(e.ts).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const bannerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16,
  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 14,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 12,
  textTransform: 'uppercase', letterSpacing: 0.5,
};

const APPROVAL_STATE_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#16a34a',
  rejected: '#dc2626',
};

const ApprovalStateBadge: React.FC<{ state: string }> = ({ state }) => (
  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: '#fff', background: APPROVAL_STATE_COLORS[state] || '#64748b', textTransform: 'capitalize' }}>
    {state}
  </span>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <>
    <dt style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{label}</dt>
    <dd style={{ margin: 0 }}>{value}</dd>
  </>
);

const BackLink: React.FC<{ navigate: ReturnType<typeof useNavigate> }> = ({ navigate }) => (
  <button
    onClick={() => navigate('/planner')}
    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, marginBottom: 16, fontSize: 14 }}
  >
    <ArrowLeft size={16} /> Back to work items
  </button>
);
