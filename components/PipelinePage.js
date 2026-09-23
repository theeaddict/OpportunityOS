'use client';

import { useState } from 'react';
import PipelineMetrics from '@/components/PipelineMetrics';
import PipelineKanban from '@/components/PipelineKanban';
import PipelineList from '@/components/PipelineList';

export default function PipelinePage({ kanban, metrics }) {
  const [view, setView] = useState('kanban');

  return (
    <>
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Pipeline</h1>
            <p className="mt-1 text-sm text-gray-500">Track opportunities from first contact to close. Project value is what you could charge — separate from business impact.</p>
          </div>
          <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
            <button onClick={() => setView('kanban')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${view === 'kanban' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              Kanban
            </button>
            <button onClick={() => setView('list')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              List
            </button>
          </div>
        </div>
      </header>

      <PipelineMetrics metrics={metrics} />

      {view === 'kanban'
        ? <PipelineKanban kanban={kanban} />
        : <PipelineList kanban={kanban} />
      }
    </>
  );
}
