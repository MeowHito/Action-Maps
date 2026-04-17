'use client';
import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return socket;
}

/** Join an event room; returns a cleanup that leaves the room. */
export function joinEvent(slug: string): () => void {
  const s = getSocket();
  const send = () => s.emit('join', { slug });
  if (s.connected) send();
  else s.once('connect', send);
  return () => {
    try {
      s.emit('leave', { slug });
    } catch {
      /* no-op */
    }
  };
}
