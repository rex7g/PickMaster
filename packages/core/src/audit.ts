/**
 * Audit log (§40, AC-012): every administrative action produces an
 * AuditEvent. Events form a hash chain — each event's hash covers the
 * previous hash plus its own payload, so tampering with history is
 * detectable (immutability by verification; on-chain anchoring in Phase 2).
 */
import type { AuditEvent } from "./types";
import { evidenceHash } from "./oracle";

export class AuditLog {
  private events: AuditEvent[] = [];

  record(
    actor: string,
    action: string,
    entity: string,
    entityId: string,
    detail: string,
    timestamp: number,
  ): AuditEvent {
    const prev = this.events[this.events.length - 1];
    const prevHash = prev ? prev.hash : "0x00000000";
    const seq = this.events.length + 1;
    const hash = evidenceHash(
      `${prevHash}|${seq}|${actor}|${action}|${entity}|${entityId}|${detail}|${timestamp}`,
    );
    const event: AuditEvent = {
      seq,
      actor,
      action,
      entity,
      entityId,
      detail,
      timestamp,
      prevHash,
      hash,
    };
    this.events.push(event);
    return event;
  }

  all(): readonly AuditEvent[] {
    return this.events;
  }

  /** Recompute the chain; false if any event was altered. */
  verifyChain(): boolean {
    let prevHash = "0x00000000";
    for (const e of this.events) {
      if (e.prevHash !== prevHash) return false;
      const expected = evidenceHash(
        `${prevHash}|${e.seq}|${e.actor}|${e.action}|${e.entity}|${e.entityId}|${e.detail}|${e.timestamp}`,
      );
      if (e.hash !== expected) return false;
      prevHash = e.hash;
    }
    return true;
  }
}
