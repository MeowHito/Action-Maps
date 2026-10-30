'use client';

/** Small UI kit for the editor chrome, themed via the --pe-* CSS variables. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SWATCHES } from './constants';

export const headlineFont = { fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' };

// ---- Tooltips ---------------------------------------------------------------------
// Any element with data-tip gets a tooltip. One global layer so tooltips are
// never clipped by scrolling panels.

export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; side: string } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
      if (timer) clearTimeout(timer);
      if (!el) return setTip(null);
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const side = el.dataset.tipSide ?? 'bottom';
        const x = side === 'right' ? r.right + 8 : side === 'left' ? r.left - 8 : r.left + r.width / 2;
        const y = side === 'top' ? r.top - 8 : side === 'bottom' ? r.bottom + 8 : r.top + r.height / 2;
        setTip({ text: el.dataset.tip ?? '', x, y, side });
      }, 350);
    };
    const hide = () => {
      if (timer) clearTimeout(timer);
      setTip(null);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);
  if (!tip || !tip.text) return null;
  const transform =
    tip.side === 'right'
      ? 'translate(0,-50%)'
      : tip.side === 'left'
        ? 'translate(-100%,-50%)'
        : tip.side === 'top'
          ? 'translate(-50%,-100%)'
          : 'translate(-50%,0)';
  return createPortal(
    <div
      className="pointer-events-none fixed z-[10000] whitespace-nowrap rounded-md bg-[#191b24] px-2 py-1 text-[11px] font-medium text-white shadow-lg"
      style={{ left: tip.x, top: tip.y, transform }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}

// ---- Buttons ------------------------------------------------------------------------

export function Icon({ name, size = 20, filled = false, className = '' }: { name: string; size?: number; filled?: boolean; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontSize: size, fontVariationSettings: filled ? "'FILL' 1" : undefined }}
      aria-hidden
    >
      {name}
    </span>
  );
}

export function IconBtn({
  icon,
  tip,
  onClick,
  active,
  disabled,
  side,
  size = 20,
  className = '',
  children,
}: {
  icon: string;
  tip: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  side?: 'top' | 'bottom' | 'left' | 'right';
  size?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={tip}
      aria-pressed={active}
      data-tip={tip}
      data-tip-side={side}
      className={`flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-[var(--pe-text-soft)] transition-colors hover:bg-[var(--pe-hover)] disabled:pointer-events-none disabled:opacity-35 ${
        active ? 'bg-[var(--pe-primary-soft)] !text-[var(--pe-primary)]' : ''
      } ${className}`}
    >
      <Icon name={icon} size={size} />
      {children}
    </button>
  );
}

export function PrimaryBtn({
  children,
  onClick,
  icon,
  disabled,
  tip,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: string;
  disabled?: boolean;
  tip?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
      className={`kinetic-gradient flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white shadow-md shadow-[#004cca]/20 transition-transform active:scale-[0.98] disabled:opacity-50 ${className}`}
      style={headlineFont}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function SoftBtn({
  children,
  onClick,
  icon,
  disabled,
  tip,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: string;
  disabled?: boolean;
  tip?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
      className={`flex items-center justify-center gap-1.5 rounded-lg border border-[var(--pe-border)] bg-[var(--pe-panel)] px-3 py-2 text-xs font-semibold text-[var(--pe-text)] transition-colors hover:bg-[var(--pe-hover)] disabled:opacity-40 ${className}`}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

// ---- Form controls ----------------------------------------------------------------------

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--pe-border-soft)] px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="eyebrow !text-[10px] !text-[var(--pe-muted)]" style={{ fontFamily: 'var(--font-sans)' }}>
          {title}
        </h3>
        {right}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-[var(--pe-text-soft)]">
      <span className="shrink-0">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-1.5">{children}</div>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(Math.round(v * 100) / 100),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="text-xs text-[var(--pe-text-soft)]">
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--pe-muted)]">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="pe-range w-full"
        aria-label={label}
      />
    </div>
  );
}

/** Number input that commits on blur / Enter so typing isn't interrupted. */
export function NumField({
  value,
  onChange,
  tip,
  prefix,
  step = 1,
  min,
  className = 'w-16',
}: {
  value: number;
  onChange: (v: number) => void;
  tip: string;
  prefix?: string;
  step?: number;
  min?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(value * 10) / 10);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (Number.isFinite(n)) onChange(min !== undefined ? Math.max(min, n) : n);
    setDraft(null);
  };
  return (
    <div
      data-tip={tip}
      className={`flex h-8 items-center rounded-md border border-[var(--pe-border)] bg-[var(--pe-input)] px-1.5 text-xs ${className}`}
    >
      {prefix && <span className="mr-1 text-[10px] font-bold text-[var(--pe-muted)]">{prefix}</span>}
      <input
        type="number"
        step={step}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
        className="w-full min-w-0 bg-transparent text-[var(--pe-text)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        aria-label={tip}
      />
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-[var(--pe-text-soft)]">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-[var(--pe-primary)]' : 'bg-[var(--pe-border)]'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label?: string; icon?: string; tip: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg bg-[var(--pe-hover)] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-tip={o.tip}
          aria-label={o.tip}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex h-7 min-w-7 flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors ${
            value === o.value ? 'bg-[var(--pe-panel)] text-[var(--pe-primary)] shadow-sm' : 'text-[var(--pe-text-soft)]'
          }`}
        >
          {o.icon && <Icon name={o.icon} size={17} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  tip,
  className = '',
  style,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; style?: React.CSSProperties }[];
  tip: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      data-tip={tip}
      aria-label={tip}
      style={style}
      className={`h-8 rounded-md border border-[var(--pe-border)] bg-[var(--pe-input)] px-2 text-xs text-[var(--pe-text)] outline-none focus:border-[var(--pe-primary)] ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} style={o.style}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---- Colour picker -------------------------------------------------------------------------

export function ColorField({
  value,
  onChange,
  tip,
  allowNone,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  tip: string;
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const toggle = () => {
    const r = btn.current!.getBoundingClientRect();
    const w = 232;
    setPos({ x: Math.min(window.innerWidth - w - 8, Math.max(8, r.left)), y: Math.min(window.innerHeight - 260, r.bottom + 6) });
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        data-tip={tip}
        aria-label={tip}
        className="pe-checker relative h-8 w-8 shrink-0 overflow-hidden rounded-md border border-[var(--pe-border)]"
      >
        <span className="absolute inset-0" style={{ background: value ?? 'transparent' }} />
        {!value && <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 rotate-45 bg-red-500" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="pe-root fixed z-[9000] w-[232px] rounded-xl border border-[var(--pe-border)] bg-[var(--pe-panel)] p-3 shadow-2xl"
            data-theme={document.querySelector('.pe-root')?.getAttribute('data-theme') ?? 'light'}
            style={{ left: pos.x, top: pos.y }}
          >
            <div className="grid grid-cols-7 gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-tip={c}
                  onClick={() => onChange(c)}
                  className={`h-6 w-6 rounded-md border ${value?.toLowerCase() === c ? 'ring-2 ring-[var(--pe-primary)] ring-offset-1' : 'border-black/10'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="color"
                value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 w-10 cursor-pointer rounded border border-[var(--pe-border)] bg-transparent"
                aria-label="เลือกสีเอง"
                data-tip="เลือกสีเอง"
              />
              <input
                type="text"
                defaultValue={value ?? ''}
                key={value ?? 'none'}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    const v = (e.target as HTMLInputElement).value.trim();
                    if (/^#?[0-9a-f]{6}$/i.test(v)) onChange(v.startsWith('#') ? v : `#${v}`);
                  }
                }}
                placeholder="#RRGGBB"
                className="h-8 min-w-0 flex-1 rounded-md border border-[var(--pe-border)] bg-[var(--pe-input)] px-2 text-xs text-[var(--pe-text)] outline-none"
                aria-label="รหัสสี"
              />
              {allowNone && (
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  data-tip="ไม่มีสี"
                  className="pe-checker relative h-8 w-8 overflow-hidden rounded-md border border-[var(--pe-border)]"
                  aria-label="ไม่มีสี"
                >
                  <span className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 rotate-45 bg-red-500" />
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
