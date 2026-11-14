'use client';

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import dynamic from 'next/dynamic';
import { useWorkspace } from './store/WorkspaceContext';
import { TopHeader } from './Header/TopHeader';
import { LeftNavigation } from './Navigation/LeftNavigation';


import { HugeiconsIcon } from '@hugeicons/react';
import {
  AlertCircle,
  BoneIcon,
  Cancel,
  CheckmarkCircle02Icon,
  CircleDashedIcon,
  FilmIcon,
  FolderOpenIcon,
  GridIcon,
  LayersIcon,
  ScissorsIcon,
  SlidersHorizontalIcon,
} from '@hugeicons/core-free-icons';
import { StudioToolTemplate } from './Panels/StudioToolTemplate';
import { settingsPersistence } from '@/services/settingsPersistence';
import { useUIStore } from '@/stores/useUIStore';
import { useAnimationStore } from '@/stores/useAnimationStore';
import { toast } from 'sonner';
// Dynamic imports for heavy 3D components and panels
const MeshViewer = dynamic(() => import('./Viewport/MeshViewer').then(mod => mod.MeshViewer), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-[hsl(var(--surface-0))] animate-pulse" />
});

import { MOTION_FAST, MOTION_SPRING } from '@/lib/motion';

import { GeneratePanel } from './Panels/GeneratePanel';
import { TexturePanel } from './Panels/TexturePanel';
import { SegmentationPanel } from './Panels/SegmentationPanel';
import { RemeshPanel } from './Panels/RemeshPanel';
import { UVPanel } from './Panels/UVPanel';
import { RiggingPanel } from './Panels/RiggingPanel';
import { AnimationPanel } from './Panels/AnimationPanel';
const JobDetailView = dynamic(() => import('./Jobs/JobDetailView').then(mod => mod.JobDetailView), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const ViewportToolOverlay = dynamic(() => import('./Viewport/ViewportToolOverlay').then(mod => mod.ViewportToolOverlay), {
  ssr: false,
});

import { RightWorkspacePanel } from './RightPanel/RightWorkspacePanel';

const OutputsPage = dynamic(() => import('./Dashboard/OutputsPage').then(mod => mod.OutputsPage), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const SystemPage = dynamic(() => import('./Dashboard/SystemPage').then(mod => mod.SystemPage), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});
const StudioDashboard = dynamic(() => import('./Dashboard/StudioDashboard').then(mod => mod.StudioDashboard), {
  ssr: false,
  loading: () => <div className="w-full h-full animate-pulse bg-[hsl(var(--surface-0))]" />,
});

const ExportModal = dynamic(() => import('./Modals/ExportModal').then(mod => mod.ExportModal), {
  ssr: false,
});
const SettingsModal = dynamic(() => import('./Modals/SettingsModal').then(mod => mod.SettingsModal), {
  ssr: false,
});
import type { ToolType } from './types';
import { SimpleTooltip } from '@/components/ui/simple-tooltip';

const ROUTE_SEGMENT_TO_TOOL: Record<string, ToolType> = {
  'generate': 'model',
  'generate-image': 'model',
  'model': 'model',
  '3d-gen': 'model',
  'retopology': 'remesh',
  'remesh': 'remesh',
  'texture': 'texture',
  'textures': 'texture',
  'texture-edit': 'texture',
  'texture-upscale': 'texture',
  'texture-pbr': 'pbr',
  'smart-uv': 'uv',
  'uv': 'uv',
  'segmentation': 'segment',
  'segment': 'segment',
  'edit': 'texture',
  'pbr': 'pbr',
  'animation': 'animation',
  'animate': 'animation',
  'rigging': 'rigging',
  'rig': 'rigging',
  'tools': 'tools',
};

export const WorkspaceShell: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();

  const {
    mainNav, setMainNav, activeTool, setActiveTool,
    isLeftPanelOpen, isRightPanelOpen,
    setIsLeftPanelOpen, setIsRightPanelOpen,
    navigateToTool, navigateToMainNav,
    runRemeshGeneration, runTextureGeneration,
    runUVUnwrapGeneration, runSegmentation,
    environmentSettings, currentAsset,
  } = useWorkspace();

  // Mobile menu state: left navigation drawer
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isMobileNavOpen) return;

    const drawer = mobileNavRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableElements = drawer?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements?.[0];
    const lastFocusable = focusableElements?.[focusableElements.length - 1];
    firstFocusable?.focus();

    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsMobileNavOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !firstFocusable || !lastFocusable) return;

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    document.addEventListener('keydown', handleDrawerKeyDown);
    return () => {
      document.removeEventListener('keydown', handleDrawerKeyDown);
      if (previouslyFocused?.isConnected) {
        if (previouslyFocused.getClientRects().length > 0) {
          previouslyFocused.focus();
        } else {
          document.querySelector<HTMLElement>('#left-tool-rail button')?.focus();
        }
      }
    };
  }, [isMobileNavOpen]);

  // Global Workspace Navigation Keyboard Shortcuts (⌘1, ⌘2, ⌘3, ⌘4→Logs, G, R, T, A, S, ⌘,)
  // Global Workspace Navigation Keyboard Shortcuts with Custom Remapping Support (T-04)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting keystrokes in inputs, textareas, or content-editable elements
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const isMac = typeof navigator !== 'undefined' && navigator.platform?.toUpperCase().includes('MAC');
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      const parts: string[] = [];
      if (cmdOrCtrl) parts.push('Ctrl/Cmd');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let mainKey = e.key;
      if (mainKey === ' ') mainKey = 'Space';
      else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
      parts.push(mainKey);
      const pressedCombo = parts.join(' + ').toLowerCase();

      // Read effective shortcuts (defaults + custom overrides)
      const shortcuts = settingsPersistence.getEffectiveShortcuts();

      const matches = (id: string, fallback: string) => {
        const bound = (shortcuts[id] || fallback).toLowerCase();
        return bound === pressedCombo;
      };

      if (matches('nav-dashboard', 'Ctrl/Cmd + 1')) {
        e.preventDefault();
        navigateToMainNav('dashboard');
      } else if (matches('nav-assets', 'Ctrl/Cmd + 2')) {
        e.preventDefault();
        navigateToMainNav('assets');
      } else if (matches('nav-jobs', 'Ctrl/Cmd + 3')) {
        e.preventDefault();
        navigateToMainNav('jobs');
      } else if (matches('nav-logs', 'Ctrl/Cmd + 4')) {
        e.preventDefault();
        router.push('/admin?tab=logs');
      } else if (matches('nav-settings', 'Ctrl/Cmd + ,')) {
        e.preventDefault();
        router.push('/admin?tab=settings');
      } else if (matches('tool-model', 'G')) {
        e.preventDefault();
        navigateToTool('model');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-remesh', 'R')) {
        e.preventDefault();
        navigateToTool('remesh');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-texture', 'T')) {
        e.preventDefault();
        navigateToTool('texture');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-uv', 'U')) {
        e.preventDefault();
        navigateToTool('uv');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-edit', 'E')) {
        e.preventDefault();
        navigateToTool('edit');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-animation', 'A')) {
        e.preventDefault();
        navigateToTool('animation');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-rigging', 'K')) {
        e.preventDefault();
        navigateToTool('rigging');
        setIsLeftPanelOpen(true);
      } else if (matches('tool-segment', 'S')) {
        e.preventDefault();
        navigateToTool('segment');
        setIsLeftPanelOpen(true);
      } else if (matches('command-palette', 'Ctrl/Cmd + K')) {
        e.preventDefault();
        useUIStore.getState().toggleCommandPalette();
      } else if (matches('quick-save', 'Ctrl/Cmd + S')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('saveWorkspaceSnapshotPrompt'));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateToMainNav, navigateToTool, router, setIsLeftPanelOpen]);

  useEffect(() => {
    const rawPath = pathname?.toLowerCase() ?? '';
    const cleanPath = rawPath.replace(/\/+$/, ''); // Strip trailing slashes

    // Bare /workspace always opens Generate; never an empty dashboard
    if (cleanPath === '/workspace') {
      router.replace('/workspace/generate');
      return;
    }

    // Outputs / Assets routes
    if (cleanPath === '/workspace/assets' || cleanPath === '/workspace/outputs' || cleanPath === '/outputs' || cleanPath === '/assets') {
      setMainNav('assets');
      return;
    }

    // Jobs routes: /workspace/jobs or /workspace/jobs/[id] or /jobs
    if (cleanPath.startsWith('/workspace/jobs') || cleanPath === '/jobs') {
      setMainNav('jobs');
      return;
    }

    // Models route: redirect to admin models tab
    if (cleanPath === '/workspace/models' || cleanPath === '/models') {
      router.push('/admin?tab=models');
      return;
    }

    // Rigging routes: /rigging or /workspace/rigging
    if (cleanPath === '/rigging' || cleanPath.startsWith('/rigging')) {
      setMainNav('workspace');
      setActiveTool('rigging');
      return;
    }

    // Animation routes: /animation or /workspace/animation
    if (cleanPath === '/animation' || cleanPath.startsWith('/animation')) {
      setMainNav('workspace');
      setActiveTool('animation');
      return;
    }

    // Workspace tool routes: /workspace/[tool]
    setMainNav('workspace');
    if (cleanPath.startsWith('/workspace/')) {
      const toolSegment = cleanPath.replace('/workspace/', '').split('/')[0];
      const matched = ROUTE_SEGMENT_TO_TOOL[toolSegment] || 'model';
      setActiveTool(matched);
    }
  }, [pathname, setMainNav, setActiveTool, router]);

  // Close mobile nav on tool change
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [activeTool]);

  // Responsive panel management: on tablet/mobile (< 1024px), keep right panel closed by default to give generous 3D canvas room
  useEffect(() => {
    const handleInitialResponsiveLayout = () => {
      if (typeof window !== 'undefined') {
        const width = window.innerWidth;
        if (width < 1024) {
          setIsRightPanelOpen(false);
        }
        if (width < 768) {
          // On mobile, start with clean viewport
          setIsLeftPanelOpen(false);
        }
      }
    };
    handleInitialResponsiveLayout();
  }, [setIsLeftPanelOpen, setIsRightPanelOpen]);

  // Ensure mobile nav resets on desktop resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768 && isMobileNavOpen) {
        setIsMobileNavOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobileNavOpen]);



  const renderToolPanel = () => {
    switch (activeTool) {
      case 'model':
      case 'tools':
        return <GeneratePanel />;
      case 'segment':
        return <SegmentationPanel />;
      case 'remesh':
        return <RemeshPanel />;
      case 'uv':
        return <UVPanel />;
      case 'texture':
      case 'pbr':
        return <TexturePanel />;
      case 'rigging':
        return <RiggingPanel />;
      case 'animation':
        return <AnimationPanel />;
      default:
        return <GeneratePanel />;
    }
  };

  return (
    <div id="forge3d-app-root" className="flex flex-col h-screen w-screen overflow-hidden bg-[#0c0d12] text-[#E0E2E8]">
      <div className="flex-shrink-0 relative z-50">
        <TopHeader onMobileMenuToggle={() => setIsMobileNavOpen(!isMobileNavOpen)} isMobileNavOpen={isMobileNavOpen} />
      </div>
      <div className="flex flex-1 overflow-hidden relative bg-[#0c0d12]">
        {/* Mobile navigation drawer overlay */}
        <AnimatePresence>
          {isMobileNavOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileNavOpen(false)}
                className="fixed inset-0 bg-black/60 z-40 md:hidden"
              />
              {/* Drawer */}
              <motion.aside
                ref={mobileNavRef}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={MOTION_SPRING}
                className="fixed left-0 top-0 bottom-0 w-[260px] max-w-[85vw] z-50 md:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Studio navigation"
              >
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between px-3 py-3 bg-[hsl(var(--surface-0))] border-b border-white/[0.08]">
                    <span className="font-extrabold text-xs tracking-wider text-white uppercase">Tools</span>
                    <button
                      type="button"
                      onClick={() => setIsMobileNavOpen(false)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[hsl(var(--surface-1))] transition-colors"
                      aria-label="Close navigation menu"
                    >
                      <HugeiconsIcon icon={Cancel} size={16} className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[hsl(var(--surface-0))]">
                    <LeftNavigation isMobileDrawer onToolSelect={() => setIsMobileNavOpen(false)} />
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Center Workspace & 3D Stage (Tripo-Style: Confined strictly between Left & Right Panels) */}
        <div className="flex-1 h-full relative overflow-hidden min-w-0 bg-[#090a0f]">
          {/* Center 3D Viewport Stage: Never bleeds or renders behind the side panels */}
          {mainNav === 'workspace' && (
            <main
              id="center-viewport-stage"
              className="absolute inset-0 md:left-[284px] md:right-[230px] lg:right-[270px] z-0 overflow-hidden bg-[#090a0f] md:rounded-2xl md:top-2 md:bottom-3 border md:border-white/[0.04]"
              style={{
                background: environmentSettings?.backgroundColor && environmentSettings.backgroundColor !== 'transparent'
                  ? environmentSettings.backgroundColor
                  : 'radial-gradient(ellipse 70% 65% at 50% 50%, #2e3036 0%, #202227 35%, #131418 70%, #090a0f 100%)',
              }}
            >
              <MeshViewer />
              <ViewportToolOverlay isRightPanelOpen={false} />
            </main>
          )}

          {/* Left Unified Studio Panel (Nav Rail 46px + Tool Content 228px Fused = 274px, Permanent / Non-Collapsible) */}
          {mainNav === 'workspace' && (
            <aside
              id="left-unified-studio-panel"
              aria-label="Studio tools"
              className="absolute left-2 top-2 bottom-3 z-20 hidden md:flex flex-row w-[274px] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden bg-[#0c0d12]"
            >
              {/* Left Rail Column: 46px */}
              <div className="w-[46px] h-full flex-shrink-0 bg-[hsl(var(--surface-1))] border-r border-[hsl(var(--border))]">
                <LeftNavigation />
              </div>

              {/* Right Tool Content Column: 228px */}
              <div
                id="tool-content-drawer"
                className="w-[228px] h-full flex flex-col overflow-hidden bg-[hsl(var(--surface-1))] relative"
              >
                {/* Immediate 0ms tool swap without blink */}
                <div className="h-full w-full flex flex-col overflow-hidden">
                  {renderToolPanel()}
                </div>
              </div>
            </aside>
          )}

          {/* Context-Aware Control & Property Panel (Right, Permanent / Non-Collapsible) */}
          {mainNav === 'workspace' && (
            <aside
              id="right-inspector-assets-column"
              aria-label="Inspector and assets"
              className="absolute inset-x-0 top-0 bottom-0 md:inset-auto md:right-2 md:top-2 md:bottom-3 w-full md:w-[220px] lg:w-[260px] md:rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden bg-[#0c0d12] flex flex-col z-20"
            >
              <RightWorkspacePanel />
            </aside>
          )}
        </div>

        {/* Dashboard/Assets/System overlays with smooth Framer Motion transition - matching exact workspace dimensions */}
        <AnimatePresence mode="wait" initial={false}>
          {mainNav === 'dashboard' && (
            <motion.div
              key="dashboard-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_FAST}
              className="absolute inset-0 left-0 md:left-[58px] z-[15] bg-[hsl(var(--surface-0))] overflow-auto flex flex-col"
            >
              <StudioDashboard />
            </motion.div>
          )}
          {mainNav === 'assets' && (
            <motion.div
              key="assets-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_FAST}
              className="absolute inset-0 left-0 md:left-[58px] z-[15] bg-[hsl(var(--surface-0))] overflow-auto flex flex-col"
            >
              <OutputsPage />
            </motion.div>
          )}
          {mainNav === 'system' && (
            <motion.div
              key="system-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_FAST}
              className="absolute inset-0 left-0 md:left-[58px] z-[15] bg-[hsl(var(--surface-0))] overflow-auto flex flex-col"
            >
              <SystemPage />
            </motion.div>
          )}
          {mainNav === 'jobs' && (
            <motion.div
              key="jobs-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MOTION_FAST}
              className="absolute inset-0 left-0 md:left-[58px] z-[15] bg-[hsl(var(--surface-0))] overflow-auto flex flex-col"
            >
              <JobDetailView onBack={() => setMainNav('workspace')} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <SettingsModal />
      <ExportModal />
    </div>
  );
};

export default WorkspaceShell;
