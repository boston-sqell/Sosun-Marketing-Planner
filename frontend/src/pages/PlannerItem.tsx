import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Lock } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi } from '../services/plannerApi';
import type {
  ApiError,
  PlannerWorkItem,
  PlannerTransition,
  PlannerActivityEntry,
} from '../services/plannerApi';
import { prettyStatus } from './Planner';

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
  const [transitions, setTransitions] = useState<PlannerTransition[]>([]);
  const [activity, setActivity] = useState<PlannerActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validatorErrors, setValidatorErrors] = useState<string[]>([]);
  const [firing, setFiring] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [it, trs, act] = await Promise.all([
        plannerApi.get(id),
        plannerApi.transitions(id),
        plannerApi.activity(id),
      ]);
      setItem(it);
      setTransitions(trs);
      setActivity(act);
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
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        {prettyStatus(item.status)} · {item.typeId} · {item.spaceId}
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
