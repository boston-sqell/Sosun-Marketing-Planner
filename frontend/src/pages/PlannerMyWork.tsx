import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Inbox, ClipboardCheck } from 'lucide-react';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { plannerApi, buildStatusIndex } from '../services/plannerApi';
import type { PlannerWorkItem, PlannerWorkflowStatus } from '../services/plannerApi';
import { PlannerViewTabs, StatusBadge } from './Planner';

export const PlannerMyWork: React.FC = () => {
  const navigate = useNavigate();
  const [assigned, setAssigned] = useState<PlannerWorkItem[]>([]);
  const [awaiting, setAwaiting] = useState<PlannerWorkItem[]>([]);
  const [statusIndex, setStatusIndex] = useState<Map<string, Map<string, PlannerWorkflowStatus>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [mine, workflows] = await Promise.all([plannerApi.myWork(), plannerApi.config.workflows()]);
        setAssigned(mine.assigned);
        setAwaiting(mine.awaitingApproval);
        setStatusIndex(buildStatusIndex(workflows));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load your work.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const statusMeta = (item: PlannerWorkItem) => statusIndex.get(item.workflowId)?.get(item.status);

  const card = (item: PlannerWorkItem) => (
    <div
      key={item.id}
      className="section-card"
      onClick={() => navigate(`/planner/${item.id}`)}
      style={{ padding: 14, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {item.typeId}{item.dueDate ? ` · Due ${item.dueDate}` : ''}
        </div>
      </div>
      <StatusBadge status={item.status} meta={statusMeta(item)} />
    </div>
  );

  const section = (title: string, Icon: typeof Inbox, list: PlannerWorkItem[], empty: string) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon size={16} />
        <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{title}</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({list.length})</span>
      </div>
      {list.length === 0 ? (
        <div className="section-card" style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{list.map(card)}</div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ marginBottom: 16 }}>
        <PlannerViewTabs active="mywork" />
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 14 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading your work…" />
      ) : (
        <>
          {section('Awaiting my approval', ClipboardCheck, awaiting, 'Nothing awaiting your approval.')}
          {section('Assigned to me', Inbox, assigned, 'Nothing is assigned to you.')}
        </>
      )}
    </div>
  );
};
