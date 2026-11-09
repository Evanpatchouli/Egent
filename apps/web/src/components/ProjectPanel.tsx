import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox } from '@material-tailwind/react';
import type { ProjectInfo, UserInfo } from '@egent/shared';
import { request } from '../api/client';

/** List server-filtered projects and expose visibility settings only to the Owner. */
export function ProjectPanel({ user }: { user: UserInfo }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProjects(await request<ProjectInfo[]>('/api/projects'));
    } catch (cause) {
      setProjects([]);
      setError(cause instanceof Error ? cause.message : '项目读取失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function visibility(project: ProjectInfo, colleagueVisible: boolean) {
    setSaving(project.path);
    setError('');
    setProjects((rows) =>
      rows.map((row) => (row.path === project.path ? { ...row, colleagueVisible } : row)),
    );
    try {
      const updated = await request<ProjectInfo>('/api/projects/visibility', {
        method: 'PUT',
        body: { projectPath: project.path, colleagueVisible },
      });
      setProjects((rows) => rows.map((row) => (row.path === updated.path ? updated : row)));
    } catch (cause) {
      setProjects((rows) => rows.map((row) => (row.path === project.path ? project : row)));
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(null);
    }
  }
  return (
    <section className="space-y-5" aria-label="项目可见性设置">
      <Button
        ripple
        variant="outline"
        color="secondary"
        disabled={loading || saving !== null}
        onClick={() => void refresh()}
      >
        刷新项目
      </Button>
      {loading && <p role="status">读取项目中…</p>}
      <p>勾选后对所有同事可见，修改立即保存。</p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="max-h-96 space-y-4 overflow-auto">
        {projects.map((project) => (
          <div key={project.path} className="flex items-start gap-3">
            <Checkbox
              className="egent-control mt-1 shrink-0"
              aria-label={project.name}
              checked={project.colleagueVisible ?? false}
              disabled={loading || saving !== null || user.role !== 'OWNER'}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                if (saving === null) void visibility(project, event.target.checked);
              }}
            >
              <Checkbox.Indicator />
            </Checkbox>
            <div>
              <strong>{project.name}</strong>
              <p className="break-all text-sm text-gray-600">{project.path}</p>
            </div>
          </div>
        ))}
      </div>
      {!loading && projects.length === 0 && <p>暂无项目</p>}
    </section>
  );
}
