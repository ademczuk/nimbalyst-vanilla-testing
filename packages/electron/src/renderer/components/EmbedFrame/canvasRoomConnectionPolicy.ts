import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Canvas child-room ceiling, global across every open board in this renderer.
 * Parent canvas rooms are outside this count; at the ceiling, eight shared
 * cards plus one parent room means nine sockets for the active board, while
 * three background boards still share the same eight child slots.
 */
export const CANVAS_SHARED_ROOM_LIMIT = 8;

type Priority = "warm" | "hot";
type HolderStatus = "queued" | "active" | "revoking" | "releasing";

interface Holder {
  token: symbol;
  key: string;
  priority: Priority;
  order: number;
  status: HolderStatus;
  released: boolean;
  connectionReleased: boolean;
  onGranted(granted: boolean): void;
}

export interface CanvasRoomPolicySnapshot {
  limit: number;
  active: number;
  queued: number;
  hot: number;
  warm: number;
}

interface CanvasRoomLease {
  granted: boolean;
  acknowledgeConnectionReleased(): void;
}

class CanvasRoomConnectionPolicy {
  private readonly active = new Map<symbol, Holder>();
  private readonly queued: Holder[] = [];
  private order = 0;

  request(
    key: string,
    priority: Priority,
    onGranted: (granted: boolean) => void
  ): {
    updatePriority(priority: Priority): void;
    acknowledgeConnectionReleased(): void;
    release(): void;
  } {
    const holder: Holder = {
      token: Symbol(key),
      key,
      priority,
      order: this.order++,
      status: "queued",
      released: false,
      connectionReleased: false,
      onGranted,
    };
    this.queued.push(holder);
    this.pump();
    if (holder.status === "queued" && priority === "hot") this.preemptForHot();

    return {
      updatePriority: (next) => {
        if (holder.released || holder.priority === next) return;
        holder.priority = next;
        if (holder.status === "queued" && next === "hot") this.preemptForHot();
        this.pump();
      },
      acknowledgeConnectionReleased: () => this.acknowledgeReleased(holder),
      release: () => this.release(holder),
    };
  }

  snapshot(): CanvasRoomPolicySnapshot {
    const active = [...this.active.values()];
    return {
      limit: CANVAS_SHARED_ROOM_LIMIT,
      active: active.length,
      queued: this.queued.filter((holder) => !holder.released).length,
      hot: active.filter((holder) => holder.priority === "hot").length,
      warm: active.filter((holder) => holder.priority === "warm").length,
    };
  }

  private pump(): void {
    this.queued.sort(
      (left, right) =>
        Number(right.priority === "hot") - Number(left.priority === "hot") ||
        left.order - right.order
    );
    while (this.active.size < CANVAS_SHARED_ROOM_LIMIT) {
      const holder = this.queued.shift();
      if (!holder) return;
      if (holder.released) continue;
      holder.status = "active";
      this.active.set(holder.token, holder);
      holder.onGranted(true);
    }
  }

  private preemptForHot(): void {
    if (this.active.size < CANVAS_SHARED_ROOM_LIMIT) {
      this.pump();
      return;
    }
    const victim = [...this.active.values()]
      .filter(
        (holder) => holder.status === "active" && holder.priority === "warm"
      )
      .sort((left, right) => left.order - right.order)[0];
    if (!victim) return;
    victim.status = "revoking";
    victim.onGranted(false);
    // The slot stays occupied until CollaborativeEmbedEditor confirms its
    // provider released. Granting now would make the cap a bookkeeping fiction.
  }

  private acknowledgeReleased(holder: Holder): void {
    if (holder.status === "active") {
      holder.connectionReleased = true;
      return;
    }
    if (holder.status !== "revoking" && holder.status !== "releasing") return;
    this.active.delete(holder.token);
    if (!holder.released && holder.status === "revoking") {
      holder.status = "queued";
      holder.order = this.order++;
      this.queued.push(holder);
    }
    this.pump();
    if (this.queued.some((candidate) => candidate.priority === "hot")) {
      this.preemptForHot();
    }
  }

  private release(holder: Holder): void {
    if (holder.released) return;
    holder.released = true;
    if (holder.status === "queued") {
      const index = this.queued.indexOf(holder);
      if (index >= 0) this.queued.splice(index, 1);
      return;
    }
    if (holder.status === "active" || holder.status === "revoking") {
      if (holder.connectionReleased) {
        this.active.delete(holder.token);
        this.pump();
        return;
      }
      holder.status = "releasing";
      // The mounted child calls acknowledgeConnectionReleased after its cache
      // acquisition has released, which is the actual socket-lifetime seam.
    }
  }
}

const canvasRoomConnectionPolicy = new CanvasRoomConnectionPolicy();

export function getCanvasRoomPolicySnapshot(): CanvasRoomPolicySnapshot {
  return canvasRoomConnectionPolicy.snapshot();
}

type CanvasRoomHandle = ReturnType<CanvasRoomConnectionPolicy["request"]>;

/**
 * A slot for one card's room, released when the card stops needing it.
 *
 * The subtle part is `acknowledgeConnectionReleased`, and it is subtle because
 * the acknowledgement is *late by construction*: the mounted child confirms its
 * provider let go only after `CollaborativeEmbedProviderCache.acquire` settles,
 * which can be after this hook has already released that lease and taken out a
 * new one for a different room. An acknowledgement that resolved "which lease?"
 * at call time would then credit the new lease and leave the old slot stuck in
 * `releasing` forever -- the 8-room ceiling would quietly lose a slot per
 * reference change, and the measurement that says this policy works (16 sockets
 * for 10 shared cards) would stop meaning anything.
 *
 * So the callback is **bound to its handle** and its identity changes with the
 * handle. `CollaborativeEmbedEditor` captures the callback at the start of the
 * acquisition it is confirming, so a late confirmation still names the lease
 * that authorized it.
 */
export function useCanvasRoomConnectionLease(
  key: string,
  priority: Priority,
  enabled: boolean
): CanvasRoomLease {
  const [lease, setLease] = useState<{
    handle: CanvasRoomHandle | null;
    granted: boolean;
  }>({ handle: null, granted: false });
  const handleRef = useRef<CanvasRoomHandle | null>(null);

  useEffect(() => {
    if (!enabled) {
      handleRef.current = null;
      setLease((previous) =>
        previous.handle === null && !previous.granted
          ? previous
          : { handle: null, granted: false }
      );
      return;
    }
    // `request` can grant synchronously, before `handle` is even bound, so the
    // grant callback routes through a box and the synchronous grant is folded
    // into the single `setLease` below rather than being overwritten by it.
    const box: { handle: CanvasRoomHandle | null } = { handle: null };
    let grantedSynchronously = false;
    let published = false;
    const handle = canvasRoomConnectionPolicy.request(key, priority, (granted) => {
      if (!published) {
        grantedSynchronously = granted;
        return;
      }
      setLease((previous) =>
        previous.handle === box.handle ? { ...previous, granted } : previous
      );
    });
    box.handle = handle;
    handleRef.current = handle;
    published = true;
    setLease({ handle, granted: grantedSynchronously });
    return () => {
      handle.release();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [enabled, key]);

  useEffect(() => {
    handleRef.current?.updatePriority(priority);
  }, [priority]);

  const leaseHandle = lease.handle;
  const acknowledgeConnectionReleased = useCallback(() => {
    leaseHandle?.acknowledgeConnectionReleased();
  }, [leaseHandle]);

  return { granted: lease.granted, acknowledgeConnectionReleased };
}

if (typeof window !== "undefined") {
  (
    window as unknown as {
      __NIMBALYST_CANVAS_ROOM_POLICY__?: {
        snapshot(): CanvasRoomPolicySnapshot;
      };
    }
  ).__NIMBALYST_CANVAS_ROOM_POLICY__ = {
    snapshot: getCanvasRoomPolicySnapshot,
  };
}
