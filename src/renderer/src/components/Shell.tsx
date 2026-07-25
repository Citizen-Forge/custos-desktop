import { useCallback, useEffect, useState } from 'react'
import type { CustosProject } from '@shared/types'
import { ApiContext, type Call } from '../api'
import ProjectView from './ProjectView'
import SettingsView from './SettingsView'
import PromptModal, { PromptRequest } from './PromptModal'

const SETTINGS_VIEW = '__settings__'

/**
 * Projects down the side, one project's four tabs in the middle. A project
 * is the unit of everything now -- its own steering conversations, roadmap,
 * board, agents and budget -- so the sidebar selects a project rather than
 * an individual chat.
 */
export default function Shell({ onSessionExpired }: { onSessionExpired: () => void }): React.JSX.Element {
  const [projects, setProjects] = useState<CustosProject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [promptState, setPromptState] = useState<{ request: PromptRequest; resolve: (v: string | null) => void } | null>(null)

  const askText = useCallback((title: string, opts: Omit<PromptRequest, 'title'> = {}): Promise<string | null> => {
    return new Promise((resolve) => setPromptState({ request: { title, ...opts }, resolve }))
  }, [])

  const call = useCallback<Call>(
    async <T,>(method: string, path: string, body?: unknown): Promise<T | null> => {
      const result = await window.custos.api<T>(method, path, body)
      if (!result.ok) {
        if (result.status === 401) {
          onSessionExpired()
          return null
        }
        alert(result.error || 'Request failed')
        return null
      }
      return result.data
    },
    [onSessionExpired]
  )

  const refresh = useCallback(async () => {
    const res = await call<{ projects: CustosProject[] }>('GET', '/admin/api/projects')
    if (!res) return
    setProjects(res.projects)
    setSelected((current) => current ?? res.projects[0]?.id ?? null)
    setLoading(false)
  }, [call])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function newProject(): Promise<void> {
    const name = await askText('Project name')
    if (!name?.trim()) return
    const res = await call<{ project: CustosProject }>('POST', '/admin/api/projects', { name: name.trim() })
    await refresh()
    if (res) setSelected(res.project.id)
  }

  async function renameProject(p: CustosProject): Promise<void> {
    const name = await askText('Project name', { defaultValue: p.name })
    if (!name?.trim() || name.trim() === p.name) return
    await call('PATCH', `/admin/api/projects/${p.id}`, { name: name.trim() })
    refresh()
  }

  async function deleteProject(p: CustosProject): Promise<void> {
    if (!confirm(`Delete "${p.name}"? Its board, roadmap, agents and discussions go with it. Files on disk are untouched.`)) return
    await call('DELETE', `/admin/api/projects/${p.id}`)
    setSelected((current) => (current === p.id ? null : current))
    refresh()
  }

  const project = projects.find((p) => p.id === selected)

  return (
    <ApiContext.Provider value={call}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h1>Custos</h1>
            <button className="icon" onClick={newProject} title="New project">
              +
            </button>
          </div>
          {loading && <p className="empty-state">Loading…</p>}
          {!loading && projects.length === 0 && <p className="hint">No projects yet. Create one to get started.</p>}
          {projects.map((p) => (
            <div
              key={p.id}
              className={`project-row${selected === p.id ? ' selected' : ''}`}
              onClick={() => setSelected(p.id)}
            >
              <span className="project-name">{p.name}</span>
              <span className="project-actions">
                <button
                  className="icon"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation()
                    renameProject(p)
                  }}
                >
                  ✎
                </button>
                <button
                  className="icon danger"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteProject(p)
                  }}
                >
                  ×
                </button>
              </span>
            </div>
          ))}
          <div className="sidebar-footer">
            <div className={`project-row${selected === SETTINGS_VIEW ? ' selected' : ''}`} onClick={() => setSelected(SETTINGS_VIEW)}>
              <span className="project-name">⚙ Settings</span>
            </div>
          </div>
        </aside>

        <div className="main-area">
          {selected === SETTINGS_VIEW && <SettingsView />}
          {project && <ProjectView key={project.id} project={project} askText={askText} />}
          {!project && selected !== SETTINGS_VIEW && <div className="empty-state">Select a project.</div>}
        </div>

        {promptState && (
          <PromptModal
            request={promptState.request}
            onSubmit={(value) => {
              promptState.resolve(value)
              setPromptState(null)
            }}
            onCancel={() => {
              promptState.resolve(null)
              setPromptState(null)
            }}
          />
        )}
      </div>
    </ApiContext.Provider>
  )
}
