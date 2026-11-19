import React, { useEffect } from 'react';
import { useWorkspace } from '../store/WorkspaceContext';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';


import { HugeiconsIcon } from '@hugeicons/react';
import { FolderOpenIcon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons';
// Import panels
import { RightPropertyPanel } from './RightPropertyPanel';
import { RightAssetsPanel } from './RightAssetsPanel';

export const RightWorkspacePanel: React.FC = () => {
  const {
    rightPanelMode,
    setRightPanelMode,
    activeTool,
    currentAsset,
  } = useWorkspace();

  // Context-aware auto-switching:
  // When Smart UV tool is selected -> automatically load properties inspector
  const prevActiveTool = React.useRef(activeTool);
  useEffect(() => {
    if (activeTool === 'uv' && prevActiveTool.current !== 'uv') {
      setRightPanelMode('properties');
    }
    prevActiveTool.current = activeTool;
  }, [activeTool, setRightPanelMode]);

  const currentActiveTab = rightPanelMode === 'assets' ? 'assets' : 'properties';

  return (
    <div id="right-workspace-panel" className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
      {/* Top Segmented Header (Matching Reference Assets / Property Switcher) */}
      <div className="h-11 px-2.5 flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <div className="flex-1 min-w-0 mr-2">
          <div className="flex gap-1 p-0.5 bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] rounded-xl">
            {[
              { id: 'assets', label: 'Assets', icon: FolderOpenIcon },
              { id: 'properties', label: 'Property', icon: SlidersHorizontalIcon },
            ].map((tab) => {
              const isActive = currentActiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRightPanelMode(tab.id as any)}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white text-black font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <HugeiconsIcon icon={tab.icon} size={15} className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 overflow-hidden bg-transparent">
        {rightPanelMode === 'assets' ? (
          <RightAssetsPanel />
        ) : (
          <RightPropertyPanel />
        )}
      </div>
    </div>
  );
};
