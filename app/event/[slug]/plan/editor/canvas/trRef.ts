import type Konva from 'konva';

/** The canvas's Transformer, so text nodes can ask which anchor is dragged. */
export const trRef: { current: Konva.Transformer | null } = { current: null };
