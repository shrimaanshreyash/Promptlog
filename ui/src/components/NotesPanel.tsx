import React, { useState, useEffect } from 'react';
import { ActionButton } from './ActionButton';
import { RetroWindow } from './RetroWindow';
import { formatLocalDateTime } from '../utils/time';

interface Note {
  id: string;
  prompt_id: string;
  version_id: string;
  note_type: string;
  title: string;
  body: string;
  severity: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface Version {
  id: string;
  version_number: number;
}

interface NotesPanelProps {
  promptId: string;
  versions: Version[];
  onClose: () => void;
}

export const NotesPanel: React.FC<NotesPanelProps> = ({ promptId, versions, onClose }) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [targetVersionId, setTargetVersionId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('none');
  const [noteType, setNoteType] = useState('general_note');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const readJsonResponse = async (response: Response) => {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { error: text || response.statusText || 'Unexpected server response.' };
    }
  };

  const fetchNotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/prompts/${promptId}/notes`);
      const data = await response.json();
      if (response.ok) {
        setNotes(data.notes || []);
      } else {
        setError(data.error || 'Failed to fetch notes.');
      }
    } catch (e: any) {
      setError(e.message || 'Connection error.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, [promptId]);

  useEffect(() => {
    if (versions.length > 0 && !versions.some(v => v.id === targetVersionId)) {
      setTargetVersionId(versions[0].id); // Default to latest version
    } else if (versions.length === 0) {
      setTargetVersionId('');
    }
  }, [versions, targetVersionId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title && !body) {
      setError('Note must have a title or body.');
      return;
    }
    if (!targetVersionId) {
      setError('No prompt version is loaded yet. Select the prompt again or wait for versions to load.');
      return;
    }
    setError(null);
    try {
      const response = await fetch(`/api/prompts/${promptId}/versions/${targetVersionId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_type: noteType, title, body, severity }),
      });
      const data = await readJsonResponse(response);
      if (response.ok) {
        setIsEditing(null);
        resetForm();
        await fetchNotes();
      } else {
        setError(data.error || 'Failed to create note.');
      }
    } catch (e: any) {
      setError(e.message || 'Connection error.');
    }
  };

  const handleUpdate = async (noteId: string) => {
    if (!title && !body) {
      setError('Note must have a title or body.');
      return;
    }
    setError(null);
    try {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note_type: noteType, title, body, severity }),
      });
      const data = await readJsonResponse(response);
      if (response.ok) {
        setIsEditing(null);
        resetForm();
        await fetchNotes();
      } else {
        setError(data.error || 'Failed to update note.');
      }
    } catch (e: any) {
      setError(e.message || 'Connection error.');
    }
  };

  const handleDelete = async (noteId: string) => {
    if (!window.confirm('Are you sure you want to delete this note?')) return;
    setError(null);
    try {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: 'DELETE',
      });
      const data = await readJsonResponse(response);
      if (response.ok && data.success) {
        await fetchNotes();
      } else {
        setError(data.error || 'Failed to delete note.');
      }
    } catch (e: any) {
      setError(e.message || 'Connection error.');
    }
  };

  const startEdit = (note: Note) => {
    setIsEditing(note.id);
    setTargetVersionId(note.version_id);
    setTitle(note.title);
    setBody(note.body);
    setSeverity(note.severity);
    setNoteType(note.note_type);
  };

  const startNew = () => {
    setIsEditing('new');
    resetForm();
    if (versions.length > 0) {
      setTargetVersionId(versions[0].id);
    }
  };

  const resetForm = () => {
    setTitle('');
    setBody('');
    setSeverity('none');
    setNoteType('general_note');
  };

  const getVersionNum = (vId: string) => {
    const v = versions.find(ver => ver.id === vId);
    return v ? `v${v.version_number}` : 'unknown';
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} note(s)?`)) return;
    setError(null);
    try {
      const response = await fetch('/api/notes/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteIds: Array.from(selectedIds) }),
      });
      const data = await readJsonResponse(response);
      if (response.ok && data.success) {
        setSelectedIds(new Set());
        await fetchNotes();
      } else {
        setError(data.error || 'Bulk delete failed.');
      }
    } catch (e: any) {
      setError(e.message || 'Connection error.');
    }
  };

  return (
    <div className="popup-overlay">
      <RetroWindow title="PROMPT HUMAN NOTES MANAGER" headerBg="var(--lavender)" className="notes-panel-window" onClose={onClose}>
        <div className="notes-panel-body">
          {error && <div className="error-box mono font-12">{error}</div>}

          {isEditing ? (
            <form onSubmit={isEditing === 'new' ? handleCreate : (e) => { e.preventDefault(); handleUpdate(isEditing); }} className="note-form mono">
              <h3 className="form-title">{isEditing === 'new' ? 'WRITE NEW NOTE' : 'EDIT NOTE'}</h3>
              
              {isEditing === 'new' && (
                <div className="form-group">
                  <label>TARGET VERSION:</label>
                  <select value={targetVersionId} onChange={(e) => setTargetVersionId(e.target.value)}>
                    {versions.map(v => (
                      <option key={v.id} value={v.id}>Version {v.version_number}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>NOTE TYPE:</label>
                <select value={noteType} onChange={(e) => setNoteType(e.target.value)}>
                  <option value="general_note">GENERAL NOTE</option>
                  <option value="reason">CHANGE REASON</option>
                  <option value="issue">BUG / ISSUE</option>
                  <option value="benefit">BENEFIT / IMPROVEMENT</option>
                  <option value="test_result">TEST RESULT</option>
                  <option value="risk">RISK ASSESSMENT</option>
                </select>
              </div>

              <div className="form-group">
                <label>SEVERITY LEVEL:</label>
                <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="none">NONE (INFORMATIONAL)</option>
                  <option value="low">LOW</option>
                  <option value="medium">MEDIUM</option>
                  <option value="high">HIGH</option>
                  <option value="critical">CRITICAL</option>
                </select>
              </div>

              <div className="form-group">
                <label>NOTE TITLE:</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" />
              </div>

              <div className="form-group">
                <label>NOTE DETAIL / BODY:</label>
                <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Observations, changes, etc." />
              </div>

              <div className="form-actions">
                <ActionButton type="button" variant="pink" onClick={() => setIsEditing(null)}>ABORT</ActionButton>
                <ActionButton type="submit" variant="lime" disabled={isEditing === 'new' && !targetVersionId}>SAVE NOTE</ActionButton>
              </div>
            </form>
          ) : (
            <div className="notes-list-section">
              <div className="notes-list-header">
                <span className="mono">LOGGED ENTRIES ({notes.length})</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {selectedIds.size > 0 && (
                    <ActionButton variant="pink" onClick={handleBulkDelete}>DELETE ({selectedIds.size})</ActionButton>
                  )}
                  <ActionButton variant="lime" onClick={startNew}>+ ADD NOTE</ActionButton>
                </div>
              </div>

              {loading && <div className="mono font-12">LOADING MEMORY DISK...</div>}

              {!loading && notes.length === 0 && (
                <div className="empty-notes mono">NO LOGGED NOTES FOUND FOR THIS PROMPT.</div>
              )}

              <div className="notes-scroll">
                {notes.map(note => (
                  <div key={note.id} className={`note-card note-severity-${note.severity}${selectedIds.has(note.id) ? ' note-selected' : ''}`}>
                    <div className="note-card-header">
                      <label style={{ cursor: 'pointer', marginRight: '6px' }}>
                        <input type="checkbox" checked={selectedIds.has(note.id)} onChange={() => toggleSelect(note.id)} />
                      </label>
                      <span className="note-badge badge-type">{note.note_type.replace('_', ' ').toUpperCase()}</span>
                      <span className="note-version">Target: {getVersionNum(note.version_id)}</span>
                    </div>
                    <div className="note-card-body">
                      {note.title && <h4 className="note-title">{note.title}</h4>}
                      <p className="note-body-text">{note.body}</p>
                      <div className="note-meta mono font-10">
                        {note.created_by && <span>BY: {note.created_by.toUpperCase()} · </span>}
                        DATE: {formatLocalDateTime(note.created_at)}
                      </div>
                    </div>
                    <div className="note-card-actions">
                      <button className="text-btn" onClick={() => startEdit(note)}>[EDIT]</button>
                      <button className="text-btn text-danger" onClick={() => handleDelete(note.id)}>[DELETE]</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </RetroWindow>
    </div>
  );
};
