import { useEffect, useState, useCallback, useRef } from 'react';
import './index.css';
import { TopPdfToolbar } from './components/TopPdfToolbar';
import { PromptExplorer } from './components/PromptExplorer';
import { PromptDocumentViewer } from './components/PromptDocumentViewer';
import { EmptySystemState } from './components/EmptySystemState';
import { NotesPanel } from './components/NotesPanel';
import { RollbackPanel } from './components/RollbackPanel';
import { ExportPanel } from './components/ExportPanel';
import { ActivityFeed } from './components/ActivityFeed';
import type { Project, Prompt, PromptVersion } from './types';

function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const selectedPromptRef = useRef<Prompt | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);

  // Filtering states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');

  // SSE status
  const [sseStatus, setSseStatus] = useState<'active' | 'inactive' | 'error'>('inactive');

  // Activity feed refresh counter
  const [activityTick, setActivityTick] = useState(0);

  // Modals / Panels toggles
  const [showExport, setShowExport] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);

  // Helper to load versions of a prompt
  const loadVersions = useCallback(async (promptId: string) => {
    try {
      const r = await fetch(`/api/prompts/${promptId}/versions`);
      const d = await r.json() as { versions?: PromptVersion[] };
      setVersions(d.versions || []);
    } catch (e) {
      console.error('Failed to load versions:', e);
    }
  }, []);

  const [allPrompts, setAllPrompts] = useState<Prompt[]>([]);

  // Load all prompts, filter client-side for display
  const loadPrompts = useCallback(async () => {
    try {
      let url = `/api/prompts?status=all`;
      if (searchTerm) {
        url += `&search=${encodeURIComponent(searchTerm)}`;
      }
      const r = await fetch(url);
      const d = await r.json() as { prompts?: Prompt[] };
      const all = d.prompts || [];
      setAllPrompts(all);

      const filtered = statusFilter === 'all'
        ? all
        : all.filter(p => p.status === statusFilter);
      setPrompts(filtered);
      setActivityTick(t => t + 1);

      if (selectedPromptRef.current) {
        const found = all.find(p => p.id === selectedPromptRef.current?.id);
        if (found) {
          selectedPromptRef.current = found;
          setSelectedPrompt(found);
          void loadVersions(found.id);
        }
      }
    } catch (e) {
      console.error('Failed to load prompts:', e);
    }
  }, [statusFilter, searchTerm, loadVersions]);

  // Load project details
  useEffect(() => {
    fetch('/api/project')
      .then(r => r.json())
      .then((d: { project: Project }) => setProject(d.project))
      .catch(e => console.error('Failed to load project details:', e));
  }, []);

  // Reload prompts list when filters change
  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  // Establish SSE Connection
  useEffect(() => {
    let sse: EventSource | null = null;

    const connectSse = () => {
      sse = new EventSource('/api/live');

      sse.onopen = () => {
        setSseStatus('active');
      };

      sse.onerror = () => {
        setSseStatus('error');
        sse?.close();
        // Attempt reconnect after 5s
        setTimeout(connectSse, 5000);
      };

      sse.addEventListener('scan_complete', () => {
        console.log('[SSE] Scan complete event received. Refreshing...');
        void loadPrompts();
      });

      sse.addEventListener('prompt_version_created', () => {
        console.log('[SSE] Prompt version created event received. Refreshing...');
        void loadPrompts();
      });
    };

    connectSse();

    return () => {
      if (sse) sse.close();
    };
  }, [loadPrompts]);

  return (
    <div className="app-shell">
      <TopPdfToolbar
        projectName={project ? project.name : ''}
        sseStatus={sseStatus}
        onTriggerExport={() => setShowExport(true)}
        onScanComplete={loadPrompts}
      />

      <div className="main-workspace">
        <PromptExplorer
          prompts={prompts}
          allPrompts={allPrompts}
          selectedPromptId={selectedPrompt ? selectedPrompt.id : null}
          onSelectPrompt={(p) => {
            selectedPromptRef.current = p;
            setSelectedPrompt(p);
            void loadVersions(p.id);
          }}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />

        {selectedPrompt ? (
          <PromptDocumentViewer
            prompt={selectedPrompt}
            versions={versions}
            onAddNote={() => setShowNotes(true)}
            onRollback={(vNum) => setRollbackVersion(vNum)}
            onClassificationChange={loadPrompts}
          />
        ) : (
          <EmptySystemState />
        )}
      </div>

      <ActivityFeed refreshTrigger={activityTick} />

      {/* Popups / Dialog overlays */}
      {showExport && (
        <ExportPanel onClose={() => setShowExport(false)} />
      )}

      {showNotes && selectedPrompt && (
        <NotesPanel
          promptId={selectedPrompt.id}
          versions={versions}
          onClose={() => setShowNotes(false)}
        />
      )}

      {rollbackVersion !== null && selectedPrompt && (
        <RollbackPanel
          promptId={selectedPrompt.id}
          promptName={selectedPrompt.display_name}
          toVersion={rollbackVersion}
          onClose={() => setRollbackVersion(null)}
          onSuccess={() => {
            void loadPrompts();
            if (selectedPrompt) {
              loadVersions(selectedPrompt.id);
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
