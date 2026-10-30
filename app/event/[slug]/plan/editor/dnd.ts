import type { ImageElement } from './types';

/**
 * What a sidebar item does when dropped on the canvas. HTML drag-and-drop
 * can only carry strings, so the action is parked here during the drag.
 */
type DropAction = (at: { x: number; y: number }, target: ImageElement | null) => void;

let payload: DropAction | null = null;

export function setDragPayload(fn: DropAction | null) {
  payload = fn;
}

export function takeDragPayload(): DropAction | null {
  const p = payload;
  payload = null;
  return p;
}

/** Props that make a sidebar item draggable onto the canvas. */
export function draggableItem(fn: DropAction) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', 'plan-item');
      e.dataTransfer.effectAllowed = 'copy';
      setDragPayload(fn);
    },
    onDragEnd: () => setTimeout(() => setDragPayload(null), 0),
  };
}
