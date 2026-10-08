'use client';
// Bộ đo (không thuộc pattern): ghi mỗi lần danh sách đổi thứ đang hiện vào window.__LAB__.events, để test và script
// đo biết lúc nào có vòng xoay, dữ liệu đang hiện chụp lúc nào (generatedAt), và component có bị dựng lại hay không.
import { useEffect, useRef } from 'react';
import type { LabEvent, LabWindow, ListEvent } from './lab-types';

export function lab(): LabWindow | null {
  if (typeof window === 'undefined') return null;
  return (window.__LAB__ ??= { events: [] });
}

export function labEvent(e: Omit<LabEvent, 't'>): void {
  lab()?.events.push({ t: Date.now(), ...e } as LabEvent);
}

export function useListProbe(s: Omit<ListEvent, 't' | 'type'>): void {
  // Mỗi lần dựng component có một mã riêng: quay lại trang mà mã đổi = component đã bị unmount rồi dựng lại.
  const instance = useRef<string | null>(null);
  instance.current ??= Math.random().toString(36).slice(2, 10);
  useEffect(() => {
    labEvent({ type: 'list-show', variant: s.variant, instance: instance.current });
    return () => labEvent({ type: 'list-hide', variant: s.variant, instance: instance.current });
  }, [s.variant]);
  useEffect(() => {
    labEvent({ type: 'list', ...s });
    // Chỉ ghi khi thứ đang hiện đổi (liệt kê từng trường thay vì cả object s).
  }, [s.variant, s.key, s.dataKey, s.generatedAt, s.seq, s.spinner, s.fetching, s.placeholder, s.error, s.rows]);
}
