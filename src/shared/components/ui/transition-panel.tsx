"use client";

import type * as React from "react";
import {
  AnimatePresence,
  motion,
  type MotionProps,
  type Transition,
  type Variant,
} from "motion/react";

import { cn } from "@/shared/lib/utils";

type TransitionPanelProps = {
  children: React.ReactNode[];
  className?: string;
  transition?: Transition;
  activeIndex: number;
  variants?: { enter: Variant; center: Variant; exit: Variant };
} & MotionProps;

/**
 * Animated panel switcher for controlled tab surfaces (tabs-02 reference
 * block, owner ruling 2026-10-24): the active child slides in from the
 * switch direction under a 4px blur while the previous one exits the other
 * way — 200ms easeInOut, opacity/transform/filter only (no layout
 * properties; motion discipline rules 1/2/4/5). jsdom renders the active
 * child statically (animations are skipped under prefers-reduced-motion).
 */
export function TransitionPanel({
  children,
  className,
  transition,
  variants,
  activeIndex,
  ...motionProps
}: TransitionPanelProps) {
  return (
    <div className={cn("relative", className)}>
      <AnimatePresence
        initial={false}
        mode="popLayout"
        custom={motionProps.custom}
      >
        <motion.div
          key={activeIndex}
          variants={variants}
          transition={transition}
          initial="enter"
          animate="center"
          exit="exit"
          {...motionProps}
        >
          {children[activeIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** The tabs-02 enter/center/exit trio, parameterized for reuse. */
export const TAB_PANEL_VARIANTS = {
  enter: { opacity: 0, y: -50, filter: "blur(4px)" },
  center: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: 50, filter: "blur(4px)" },
} satisfies { enter: Variant; center: Variant; exit: Variant };
