'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

export type SSEConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export function useSSE<T>(url: string, fallbackPollMs = 30000) {
  const [data, setData] = useState<T | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<SSEConnectionStatus>('connecting');
  const connected = connectionStatus === 'connected';
  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reconnectAttemptsRef = useRef(0);
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    // Clean up any existing connection before creating a new one
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setConnectionStatus(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting');
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setConnectionStatus('connected');
      reconnectAttemptsRef.current = 0;
    };
    es.onmessage = (e) => {
      try { setData(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      setConnectionStatus('reconnecting');
      es.close();
      esRef.current = null;
      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      reconnectAttemptsRef.current++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);
      retryRef.current = setTimeout(() => connectRef.current(), delay);
    };
  }, [url]);

  connectRef.current = connect;

  useEffect(() => {
    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setConnectionStatus('disconnected');
    };
  }, [connect]);

  // Fallback polling when SSE disconnected
  useEffect(() => {
    if (connected) return;
    let active = true;
    const poll = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const endpoint = url.replace(/\/stream\/?$/, '');
        const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
        if (!active) return;
        const json = await res.json();
        setData(json.data ?? json);
      } catch { /* ignore poll errors */ }
    }, fallbackPollMs);
    return () => { active = false; clearInterval(poll); };
  }, [connected, url, fallbackPollMs]);

  return { data, connected, connectionStatus };
}
