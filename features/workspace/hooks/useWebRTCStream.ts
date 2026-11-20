'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getApiClient } from '@/services/apiClient';
import { useViewerStore } from '@/stores/useViewerStore';

export interface UseWebRTCStreamOptions {
  workspaceId?: string | null;
  modelUrl?: string | null;
  enabled?: boolean;
  shadingMode?: string;
  showWireframe?: boolean;
}

export type StreamConnectionState = 'idle' | 'connecting' | 'streaming' | 'error';
export type StreamTransport = 'webrtc' | 'websocket' | 'none';

export function useWebRTCStream({
  workspaceId,
  modelUrl,
  enabled = true,
  shadingMode = 'clay',
  showWireframe = false,
}: UseWebRTCStreamOptions) {
  const [connectionState, setConnectionState] = useState<StreamConnectionState>('idle');
  const [streamTransport, setStreamTransport] = useState<StreamTransport>('none');
  const [fps, setFps] = useState<number>(0);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isConnectingRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Keep live refs for visual props so connect does not need to rebuild
  const shadingModeRef = useRef(shadingMode);
  shadingModeRef.current = shadingMode;
  const showWireframeRef = useRef(showWireframe);
  showWireframeRef.current = showWireframe;

  // Gesture state
  const isPointerDownRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isRightClickRef = useRef(false);

  // FPS calculation
  const frameCountRef = useRef(0);
  const lastFpsCalcRef = useRef(Date.now());
  const lastPingSentRef = useRef<number>(0);

  /**
   * Dispatch interaction command across whichever transport is active.
   */
  const sendCommand = useCallback((payload: Record<string, unknown>) => {
    const jsonStr = JSON.stringify(payload);
    // 1. Try WebRTC DataChannel
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      try {
        dataChannelRef.current.send(jsonStr);
        return;
      } catch (e) {
        console.debug('[WebRTCStream] DataChannel send failed, falling back:', e);
      }
    }

    // 2. Try WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(jsonStr);
        return;
      } catch (e) {
        console.debug('[WebRTCStream] WebSocket send failed:', e);
      }
    }

    // 3. Fallback to direct HTTP POST input
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

  // Sync shading & wireframe changes with server renderer
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

  /**
   * Pointer gesture handlers for fluid OrbitControls feel.
   */
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

  /**
   * Setup stream session and connect via WebRTC or WebSocket.
   */
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
      console.warn('[WebRTCStream] Session start failed:', err);
      setConnectionState('error');
      setErrorMessage(err?.message || 'Failed to start 3D streaming session');
      isConnectingRef.current = false;
      return;
    }

    const { session_id, ws_url, webrtc_supported } = sessionData;

    // Helper to connect over multiplexed WebSocket
    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // If client runs on Next.js dev port 3000, direct WebSocket to FastAPI port 7842
      const host = typeof window !== 'undefined' && window.location.port === '3000'
        ? `${window.location.hostname}:7842`
        : window.location.host;
      const fullWsUrl = `${protocol}//${host}${ws_url}`;

      const ws = new WebSocket(fullWsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        isConnectingRef.current = false;
        setConnectionState('streaming');
        setStreamTransport('websocket');
        // Initial sync of shading and wireframe using live refs
        sendCommand({ action: 'shading', mode: shadingModeRef.current });
        sendCommand({ action: 'wireframe', enabled: showWireframeRef.current });
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Render binary JPEG frame onto canvas
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

            // Live FPS & Latency stats
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
            console.debug('[WebRTCStream] Frame decode error:', decodeErr);
          }
        }
      };

      ws.onerror = (err) => {
        console.warn('[WebRTCStream] WebSocket error:', err);
      };

      ws.onclose = () => {
        setConnectionState((prev) => (prev === 'streaming' ? 'idle' : prev));
        setStreamTransport('none');
      };
    };

    // Only attempt WebRTC if the server explicitly supports it (aiortc installed)
    if (webrtc_supported === true && typeof RTCPeerConnection !== 'undefined') {
      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        pcRef.current = pc;

        // Create data channel for client input
        const dc = pc.createDataChannel('control');
        dataChannelRef.current = dc;

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            isConnectingRef.current = false;
            setConnectionState('streaming');
            setStreamTransport('webrtc');
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const answerRes: any = await api.post(`/api/v1/stream/session/${session_id}/offer`, {
          sdp: pc.localDescription?.sdp,
          type: pc.localDescription?.type,
        });

        const answerData = (answerRes && typeof answerRes === 'object' && 'sdp' in answerRes) ? answerRes : answerRes?.data;
        if (answerData && answerData.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(answerData));
          return;
        }
      } catch (webrtcErr) {
        console.warn('[WebRTCStream] WebRTC handshake failed, falling back to WebSocket:', webrtcErr);
        if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
        }
      }
    }

    // Connect via WebSocket
    connectWebSocket();
  }, [enabled, workspaceId, modelUrl, sendCommand]);

  /**
   * Clean up active connections on unmount or session stop.
   */
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

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
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
}
