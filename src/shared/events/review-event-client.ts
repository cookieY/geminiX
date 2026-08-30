import { useEffect, useRef } from "react";
import {
  parseDomainEvent,
  type YearningDomainEvent,
  type YearningEventType,
} from "./domain-event";

/**
 * The single domain-event fan-out point (frontend PRD §10.5/§10.6): one
 * client instance feeds every subscriber, so no component ever opens its own
 * WebSocket or stream. Transport is injected — the api-conventions contract
 * makes HTTP polling the first-release baseline and allows SSE later, so the
 * client only owns the transport-independent semantics:
 *
 * - contract validation: a payload that fails the domain-event schema never
 *   reaches consumers (schema 校验);
 * - at-least-once delivery: duplicates are recognized by event.id and
 *   dropped, so a reconnect never re-consumes an event (断线续传);
 * - per-subject ordering: `sequence` must strictly increase per subject; a
 *   jump signals lost events and fires the refetch callback — consumers
 *   re-read the HTTP resource instead of waiting for the gap (events README).
 */

export type DomainEventHandler = (event: YearningDomainEvent) => void;

/** A transport yields events from a resume point: { subject: lastSequence }. */
export type EventTransportFactory = (
  resume: Record<string, number>,
) => AsyncIterable<unknown>;

export interface ReviewEventClientOptions {
  /** Fired when a sequence jump is detected on a subscribed subject. */
  onSequenceGap?: (subject: string) => void;
  /** Fired when a payload fails schema validation. */
  onInvalidEvent?: () => void;
}

const SEEN_IDS_CAPACITY = 4096;

export class ReviewEventClient {
  private readonly options: ReviewEventClientOptions;
  private readonly handlers = new Map<string, Set<DomainEventHandler>>();
  private readonly sequences = new Map<string, number>();
  private readonly seenIds = new Set<string>();
  private seenIdsOrder: string[] = [];
  private running = false;
  private stopped = false;
  private abort: AbortController | null = null;

  /** Indirection keeps stop() observable; CFA cannot narrow through it. */
  private isStopped(): boolean {
    return this.stopped;
  }

  constructor(options: ReviewEventClientOptions = {}) {
    this.options = options;
  }

  subscribe(subject: string, handler: DomainEventHandler): () => void {
    let set = this.handlers.get(subject);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(subject, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(subject);
    };
  }

  /** Last sequence consumed per subject — the resume point for reconnects. */
  resumePoint(): Record<string, number> {
    return Object.fromEntries(this.sequences);
  }

  /**
   * Ingests one raw payload. Returns true when the event was delivered.
   * Invalid, duplicated or stale events are dropped silently from the
   * consumer's point of view (callbacks observe the reasons).
   */
  ingest(raw: unknown): boolean {
    const event = parseDomainEvent(raw);
    if (event === null) {
      this.options.onInvalidEvent?.();
      return false;
    }
    if (this.seenIds.has(event.id)) {
      return false;
    }
    this.rememberId(event.id);
    const last = this.sequences.get(event.subject);
    if (last !== undefined) {
      if (event.sequence <= last) {
        // Out-of-order or duplicate delivery of an already-consumed sequence.
        return false;
      }
      if (event.sequence > last + 1) {
        this.options.onSequenceGap?.(event.subject);
      }
    }
    this.sequences.set(event.subject, event.sequence);
    const handlers = this.handlers.get(event.subject);
    if (handlers === undefined) {
      return false;
    }
    for (const handler of handlers) handler(event);
    return true;
  }

  /**
   * Runs the injected transport until stopped, reconnecting with the latest
   * resume point. Reconnection re-feeds only unseen events because both the
   * id set and the per-subject sequences survive across iterations.
   */
  async run(transport: EventTransportFactory): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.abort = new AbortController();
    try {
      while (!this.isStopped()) {
        try {
          const stream = transport(this.resumePoint());
          for await (const raw of stream) {
            if (this.isStopped()) break;
            this.ingest(raw);
          }
        } catch {
          // Transport failure: fall through and reconnect from the resume
          // point — the delivery semantics above make this idempotent.
        }
        if (this.isStopped()) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      this.running = false;
      this.abort = null;
    }
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
  }

  private rememberId(id: string): void {
    if (this.seenIds.size >= SEEN_IDS_CAPACITY) {
      const evicted = this.seenIdsOrder.shift();
      if (evicted !== undefined) this.seenIds.delete(evicted);
    }
    this.seenIds.add(id);
    this.seenIdsOrder.push(id);
  }
}

let singleton: ReviewEventClient | null = null;

/** Application-wide instance: one feed, many subscribers. */
export function getReviewEventClient(): ReviewEventClient {
  singleton ??= new ReviewEventClient();
  return singleton;
}

/** Test seam: replaces the singleton and returns the previous one. */
export function setReviewEventClient(client: ReviewEventClient | null): ReviewEventClient | null {
  const previous = singleton;
  singleton = client;
  return previous;
}

/**
 * React binding: subscribes to one subject for the component's lifetime.
 * The handler ref stays current through an effect so no stale closure runs
 * and no resubscription churn happens across renders.
 */
export function useDomainEvent(
  subject: string | null,
  eventType: YearningEventType | "any",
  handler: DomainEventHandler,
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    if (subject === null) return;
    return getReviewEventClient().subscribe(subject, (event) => {
      if (eventType === "any" || event.type === eventType) {
        handlerRef.current(event);
      }
    });
  }, [subject, eventType]);
}
