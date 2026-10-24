"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

type ShineBorderProps = {
  children: ReactNode;
  className?: string;
  /** Ring thickness in px (the gradient layer shows through it). */
  borderWidth?: number;
  /** Token gradient classes for the spotlight (defaults to the brand trio). */
  gradient?: string;
};

/**
 * Mouse-spotlight border (shine-border-03 reference block, owner ruling
 * 2026-10-24): a gradient layer sits under the content and is revealed only
 * through a radial mask that follows the cursor, so the border ring glows
 * around the pointer. The gradient stays on semantic chart tokens — the raw
 * palette classes of the reference block would fail the color-token gate.
 * The layer is pointer-events-none and opacity-0 until hover, so screenshots
 * and keyboard flows see the plain card.
 */
export function ShineBorder({
  children,
  className,
  borderWidth = 2,
  gradient = "from-chart-1 via-chart-3 to-chart-5",
}: ShineBorderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  return (
    <div
      ref={containerRef}
      onMouseMove={(event) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect === undefined) return;
        setPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      }}
      onMouseEnter={() => { setOpacity(1); }}
      onMouseLeave={() => { setOpacity(0); }}
      className={cn("relative overflow-hidden rounded-2xl p-(--bw)", className)}
      style={{ "--bw": `${borderWidth}px` } as CSSProperties}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 rounded-2xl bg-linear-to-r transition-opacity duration-300",
          gradient,
        )}
        style={{
          opacity,
          WebkitMaskImage: `radial-gradient(400px circle at ${position.x}px ${position.y}px, black 10%, transparent 60%)`,
          maskImage: `radial-gradient(400px circle at ${position.x}px ${position.y}px, black 10%, transparent 60%)`,
        }}
      />
      <div className="relative z-10 h-full rounded-2xl bg-card">
        {children}
      </div>
    </div>
  );
}
