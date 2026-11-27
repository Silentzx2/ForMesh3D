import React from 'react';
import { useWorkspace } from '../store/WorkspaceContext';

import { HugeiconsIcon } from '@hugeicons/react';
import { FolderOpenIcon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons';
// Import panels
import { RightPropertyPanel } from './RightPropertyPanel';
import { RightAssetsPanel } from './RightAssetsPanel';

const RIGHT_PANEL_TABS: Array<{
  id: 'assets' | 'properties';
  label: string;
  icon: typeof FolderOpenIcon;
}> = [
  { id: 'assets', label: 'Assets', icon: FolderOpenIcon },
  { id: 'properties', label: 'Property', icon: SlidersHorizontalIcon },
];

export const RightWorkspacePanel: React.FC = () => {
  const {
    rightPanelMode,
    setRightPanelMode,
  } = useWorkspace();

  const currentActiveTab = rightPanelMode === 'assets' ? 'assets' : 'properties';

  return (
    <div id="right-workspace-panel" className="flex flex-col h-full w-full bg-[hsl(var(--surface-1))] text-xs select-none overflow-hidden">
      {/* Top Segmented Header (Assets / Property Switcher) */}
      <div className="h-11 px-2.5 flex items-center border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex gap-1 p-0.5 bg-[hsl(var(--surface-2))] border border-[hsl(var(--border))] rounded-xl">
            {RIGHT_PANEL_TABS.map((tab) => {
              const isActive = currentActiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRightPanelMode(tab.id)}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))] font-semibold shadow-sm'
                      : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-3))]/60'
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
