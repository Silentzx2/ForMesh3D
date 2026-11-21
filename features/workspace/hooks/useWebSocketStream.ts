'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getApiClient } from '@/services/apiClient';
import { useViewerStore } from '@/stores/useViewerStore';

export interface UseWebSocketStreamOptions {
  workspaceId?: string | null;
  modelUrl?: string | null;
  enabled?: boolean;
  shadingMode?: string;
  showWireframe?: boolean;
}

export type StreamConnectionState = 'idle' | 'connecting' | 'streaming' | 'error';
export type StreamTransport = 'websocket' | 'none';

export function useWebSocketStream({
  workspaceId,
  modelUrl,
  enabled = true,
  shadingMode = 'clay',
  showWireframe = false,
}: UseWebSocketStreamOptions) {
  const [connectionState, setConnectionState] = useState<StreamConnectionState>('idle');
  const [streamTransport, setStreamTransport] = useState<StreamTransport>('none');
  const [fps, setFps] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isConnectingRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);

  const shadingModeRef = useRef(shadingMode);
  shadingModeRef.current = shadingMode;
  const showWireframeRef = useRef(showWireframe);
  showWireframeRef.current = showWireframe;

  const isPointerDownRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isRightClickRef = useRef(false);

  const frameCountRef = useRef(0);
  const lastFpsCalcRef = useRef(Date.now());
  const lastPingSentRef = useRef<number>(0);

  const sendCommand = useCallback((payload: Record<string, unknown>) => {
    const jsonStr = JSON.stringify(payload);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(jsonStr);
        return;
      } catch (e) {
        console.debug('[WebSocketStream] WebSocket send failed:', e);
      }
    }

    if (sessionIdRef.current) {
      const api = getApiClient();
      api.post(`/api/v1/stream/session/${sessionIdRef.current}/input`, payload).catch(() => {});
    }
  }, []);

  const sendPreset = useCallback((preset: string) => {
    sendCommand({ action: 'set_view', preset });
  }, [sendCommand]);

  const sendShading = useCallback((mode: string) => {
    sendCommand({ action: 'shading', mode });
  }, [sendCommand]);

  const sendWireframe = useCallback((wireframeEnabled: boolean) => {
    sendCommand({ action: 'wireframe', enabled: wireframeEnabled });
  }, [sendCommand]);

  useEffect(() => {
    if (connectionState === 'streaming') {
      sendShading(shadingMode);
    }
  }, [shadingMode, connectionState, sendShading]);

  useEffect(() => {
    if (connectionState === 'streaming') {
      sendWireframe(showWireframe);
    }
  }, [showWireframe, connectionState, sendWireframe]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isPointerDownRef.current = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    isRightClickRef.current = e.button === 2 || e.shiftKey;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPointerDownRef.current) return;
    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    if (isRightClickRef.current) {
      sendCommand({ action: 'pan', dx, dy });
    } else {
      sendCommand({ action: 'rotate', dx, dy });
    }
  }, [sendCommand]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    sendCommand({ action: 'end_drag' });
  }, [sendCommand]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    sendCommand({ action: 'zoom', delta: e.deltaY });
  }, [sendCommand]);

  const connect = useCallback(async () => {
    if (!enabled || (!workspaceId && !modelUrl)) return;
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;

    setConnectionState('connecting');
    setErrorMessage(null);

    const api = getApiClient();
    const width = canvasRef.current?.clientWidth || 800;
    const height = canvasRef.current?.clientHeight || 600;

    let sessionData: any;
    try {
      const res: any = await api.post('/api/v1/stream/session/start', {
        workspace_id: workspaceId || undefined,
        model_url: modelUrl || undefined,
        width,
        height,
      });
      sessionData = (res && typeof res === 'object' && 'session_id' in res) ? res : res?.data;
      if (!sessionData || !sessionData.session_id) {
        throw new Error('Streaming server did not return a valid session ID');
      }
      sessionIdRef.current = sessionData.session_id;
      if (sessionData.stats) {
        useViewerStore.getState().setModelStats(sessionData.stats);
      }
    } catch (err: any) {
      console.warn('[WebSocketStream] Session start failed:', err);
      setConnectionState('error');
      setErrorMessage(err?.message || 'Failed to start 3D streaming session');
      isConnectingRef.current = false;
      return;
    }

    const { session_id, ws_url } = sessionData;

    const connectWebSocket = () => {
      // Always route WebSocket through the same-origin Next.js API proxy
      // (/api/v1/stream/.../ws) so it works behind reverse proxies, tunnels,
      // and Cloudflare where direct host:port WebSocket is not forwarded.
      const fullWsUrl = `${window.location.origin}${ws_url}`;

      const ws = new WebSocket(fullWsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        isConnectingRef.current = false;
        setConnectionState('streaming');
        setStreamTransport('websocket');
        sendCommand({ action: 'shading', mode: shadingModeRef.current });
        sendCommand({ action: 'wireframe', enabled: showWireframeRef.current });
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          const blob = new Blob([event.data], { type: 'image/jpeg' });
          try {
            const bitmap = await createImageBitmap(blob);
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
              }
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(bitmap, 0, 0);
              }
            }
            bitmap.close();

            frameCountRef.current += 1;
            const now = Date.now();
            if (now - lastFpsCalcRef.current >= 1000) {
              setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsCalcRef.current)));
              frameCountRef.current = 0;
              lastFpsCalcRef.current = now;
            }
            if (lastPingSentRef.current > 0) {
              setLatencyMs(Date.now() - lastPingSentRef.current);
            }
          } catch (decodeErr) {
            console.debug('[WebSocketStream] Frame decode error:', decodeErr);
          }
        }
      };

      ws.onerror = (err) => {
        console.warn('[WebSocketStream] WebSocket error:', err);
      };

      ws.onclose = () => {
        setConnectionState((prev) => (prev === 'streaming' ? 'idle' : prev));
        setStreamTransport('none');
      };
    };

    connectWebSocket();
  }, [enabled, workspaceId, modelUrl, sendCommand]);

  const disconnect = useCallback(() => {
    isConnectingRef.current = false;
    if (sessionIdRef.current) {
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      getApiClient().post(`/api/v1/stream/session/${sid}/stop`).catch(() => {});
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionState('idle');
    setStreamTransport('none');
  }, []);

  useEffect(() => {
    if (enabled && (workspaceId || modelUrl)) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, workspaceId, modelUrl, connect, disconnect]);

  return {
    videoRef,
    canvasRef,
    connectionState,
    streamTransport,
    fps,
    latencyMs,
    errorMessage,
    sendPreset,
    sendShading,
    sendWireframe,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    retry: connect,
  };
};
