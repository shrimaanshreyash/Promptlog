import React, { useCallback, useEffect, useState, useRef } from 'react';
import { parseUtcTimestamp } from '../utils/time';

interface ActivityEvent {
  id: string;
  event_type: string;
  stable_name?: string;
  display_name?: string;
  created_at: string;
  event_payload_json?: string;
}

interface EventPayload {
  versionNumber?: number;
  toVersion?: number;
  classification?: string;
  detection_method?: string;
  sourceFile?: string;
  patchPath?: string;
}

const EVENT_ICONS: Record<string, string> = {
  prompt_detected: '\u{1F7E2}',
  prompt_changed: '\u{1F7E1}',
  prompt_removed_from_codebase: '\u{1F534}',
  prompt_restored: '\u{1F535}',
  prompt_confirmed: '✅',
  prompt_ignored: '\u{1F6AB}',
  prompt_marked_as_code: '⌨️',
  note_added: '\u{1F4DD}',
  rollback_patch_created: '⏪',
  rollback_applied: '\u{1F504}',
};

const EVENT_LABELS: Record<string, string> = {
  prompt_detected: 'NEW PROMPT DETECTED',
  prompt_changed: 'PROMPT MODIFIED',
  prompt_removed_from_codebase: 'PROMPT REMOVED FROM SOURCE',
  prompt_restored: 'PROMPT RESTORED',
  prompt_confirmed: 'USER CONFIRMED',
  prompt_ignored: 'USER IGNORED',
  prompt_marked_as_code: 'MARKED AS CODE',
  note_added: 'NOTE ADDED',
  rollback_patch_created: 'ROLLBACK PATCH CREATED',
  rollback_applied: 'ROLLBACK APPLIED',
};

interface ActivityFeedProps {
  refreshTrigger: number;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ refreshTrigger }) => {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [expanded, setExpanded] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const loadEvents = useCallback(async () => {
    try {
      const r = await fetch('/api/events?limit=50');
      const d = await r.json() as { events?: ActivityEvent[] };
      setEvents(d.events || []);
    } catch (e) {
      console.error('Failed to load events:', e);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents, refreshTrigger]);

  useEffect(() => {
    if (events.length > prevCountRef.current && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
    prevCountRef.current = events.length;
  }, [events.length]);

  const formatTime = (ts: string) => {
    return parseUtcTimestamp(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDate = (ts: string) => {
    const d = parseUtcTimestamp(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'TODAY';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase();
  };

  const getPayload = (evt: ActivityEvent): EventPayload | null => {
    if (!evt.event_payload_json) return null;
    try {
      const parsed: unknown = JSON.parse(evt.event_payload_json);
      return parsed && typeof parsed === 'object' ? parsed as EventPayload : null;
    } catch { return null; }
  };

  const getDetail = (evt: ActivityEvent) => {
    const p = getPayload(evt);
    if (!p) return null;

    const parts: string[] = [];

    if (p.versionNumber) parts.push(`v${p.versionNumber}`);
    if (p.toVersion) parts.push(`→ v${p.toVersion}`);

    if (p.classification) {
      parts.push(p.classification === 'confirmed' ? 'HIGH CONFIDENCE' : p.classification.toUpperCase());
    }

    if (p.detection_method) parts.push(p.detection_method);

    if (p.sourceFile) parts.push(p.sourceFile);
    if (p.patchPath) parts.push(p.patchPath);

    return parts.length > 0 ? parts.join(' · ') : null;
  };

  return (
    <div className="activity-feed">
      <div
        className="activity-feed-header mono font-11"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        <span>{expanded ? '▼' : '▶'} ACTIVITY LOG</span>
        <span className="badge-count">{events.length}</span>
      </div>
      {expanded && (
        <div className="activity-feed-list" ref={feedRef}>
          {events.length === 0 ? (
            <div className="activity-empty mono font-10">
              NO EVENTS YET. WATCHING FOR FILE CHANGES...
            </div>
          ) : (
            events.map((evt) => {
              const icon = EVENT_ICONS[evt.event_type] || '⚠️';
              const label = EVENT_LABELS[evt.event_type] || evt.event_type.replace(/_/g, ' ').toUpperCase();
              const detail = getDetail(evt);
              return (
                <div key={evt.id} className={`activity-item activity-${evt.event_type}`}>
                  <span className="activity-icon">{icon}</span>
                  <div className="activity-body">
                    <div className="activity-label mono font-10">
                      <span className="activity-type">{label}</span>
                    </div>
                    <div className="activity-name mono font-10">
                      {evt.display_name || evt.stable_name || '—'}
                    </div>
                    {detail && (
                      <div className="activity-detail mono font-9">{detail}</div>
                    )}
                  </div>
                  <div className="activity-time mono font-9">
                    <div>{formatDate(evt.created_at)}</div>
                    <div>{formatTime(evt.created_at)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
