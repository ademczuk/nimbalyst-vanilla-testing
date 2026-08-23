import { net } from "electron";
import WebSocket from "ws";
import {
  OutboxDrainer,
  appendSyncClientParams,
  encodeDocumentRoomId,
  type DocServerMessage,
  type LocalReplicaIdentity,
  type OutboxDrainBatch,
  type OutboxDrainTransport,
  type StuckOutboxDocument,
} from "@nimbalyst/runtime/sync";
import { getCollabDocumentReplicaStore } from "./CollabDocumentReplicaStore";
import { getCollabSyncWsUrl } from "../utils/collabSyncUrl";
import { getOrgScopedJwt } from "./TeamService";
import {
  getPersonalUserId,
  onAuthStateChange,
} from "./StytchAuthService";
import { onNetworkAvailable } from "./NetworkAvailability";
import { logger } from "../utils/logger";
import {
  OutboxUpgradeRejectedError,
  retryOutboxConnectAfterAuthRejection,
} from "./OutboxTransportAuthRetry";
import { ProviderAttachmentRegistry } from "./ProviderAttachmentRegistry";

const PERIODIC_DRAIN_MS = 30_000;
/** Per-document ceiling on the not-converging warning, so it never floods. */
const STUCK_REPORT_INTERVAL_MS = 60 * 60_000;
const ACK_TIMEOUT_MS = 10_000;

class ElectronDocumentOutboxTransport implements OutboxDrainTransport {
  private constructor(private readonly socket: WebSocket) {}

  static async connect(
    identity: LocalReplicaIdentity
  ): Promise<ElectronDocumentOutboxTransport> {
    return retryOutboxConnectAfterAuthRejection((forceRefresh) =>
      ElectronDocumentOutboxTransport.connectOnce(identity, forceRefresh)
    );
  }

  private static async connectOnce(
    identity: LocalReplicaIdentity,
    forceRefresh: boolean
  ): Promise<ElectronDocumentOutboxTransport> {
    const jwt = await getOrgScopedJwt(identity.orgId, undefined, forceRefresh);
    const roomId = encodeDocumentRoomId(identity.orgId, identity.documentId);
    const url = appendSyncClientParams(
      `${getCollabSyncWsUrl()}/sync/${roomId}?token=${encodeURIComponent(jwt)}`
    );
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Outbox drain WebSocket open timed out"));
      }, ACK_TIMEOUT_MS);
      socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.once("unexpected-response", (_request, response) => {
        clearTimeout(timeout);
        response.resume();
        socket.close();
        reject(new OutboxUpgradeRejectedError(response.statusCode ?? 0));
      });
    });
    return new ElectronDocumentOutboxTransport(socket);
  }

  async send(batch: OutboxDrainBatch) {
    // The server encrypts at rest with the team DEK; send plaintext bytes
    // with the empty-iv sentinel.
    const encrypted = {
      encryptedUpdate: Buffer.from(batch.update).toString("base64"),
      iv: "",
    };

    return new Promise<
      | { status: "acknowledged"; sequence: number }
      | { status: "rejected"; errorCode: string }
    >((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("message", onMessage);
        this.socket.off("close", onClose);
        this.socket.off("error", onError);
      };
      const onMessage = (data: WebSocket.RawData) => {
        let message: DocServerMessage;
        try {
          message = JSON.parse(data.toString()) as DocServerMessage;
        } catch {
          return;
        }
        if (
          message.type === "docUpdateAck" &&
          message.clientUpdateId === batch.batchId
        ) {
          cleanup();
          resolve({ status: "acknowledged", sequence: message.sequence });
        } else if (
          message.type === "error" &&
          message.clientUpdateId === batch.batchId
        ) {
          cleanup();
          resolve({ status: "rejected", errorCode: message.code });
        }
      };
      const onClose = () => {
        cleanup();
        reject(
          new Error("Outbox drain WebSocket closed before acknowledgement")
        );
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Outbox drain acknowledgement timed out"));
      }, ACK_TIMEOUT_MS);
      this.socket.on("message", onMessage);
      this.socket.once("close", onClose);
      this.socket.once("error", onError);
      this.socket.send(
        JSON.stringify({
          type: "docUpdate",
          encryptedUpdate: encrypted.encryptedUpdate,
          iv: encrypted.iv,
          clientUpdateId: batch.batchId,
        })
      );
    });
  }

  close(): void {
    this.socket.close();
  }
}

export class CollabOutboxDrainCoordinator {
  private readonly providerAttachments = new ProviderAttachmentRegistry();
  private readonly drainer = new OutboxDrainer({
    store: getCollabDocumentReplicaStore(),
    createTransport: (identity) =>
      ElectronDocumentOutboxTransport.connect(identity),
    isLiveProviderAttached: (identity) => this.isLiveProviderAttached(identity),
  });
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private readonly stuckReportedAt = new Map<string, number>();
  private unsubscribeNetwork: (() => void) | null = null;
  private unsubscribeAuth: (() => void) | null = null;

  start(): void {
    if (this.periodicTimer) return;
    this.unsubscribeNetwork = onNetworkAvailable(() =>
      this.trigger("network-restored")
    );
    this.unsubscribeAuth = onAuthStateChange((state) => {
      if (state.isAuthenticated) this.trigger("auth-restored");
    });
    this.periodicTimer = setInterval(
      () => this.trigger("periodic"),
      PERIODIC_DRAIN_MS
    );
    this.trigger("startup");
  }

  stop(): void {
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.periodicTimer = null;
    this.unsubscribeNetwork?.();
    this.unsubscribeAuth?.();
    this.unsubscribeNetwork = null;
    this.unsubscribeAuth = null;
    for (const identity of this.providerAttachments.clear()) {
      this.drainer.resumeAfterLiveProvider(identity);
    }
  }

  async setProviderAttached(
    senderId: number,
    identity: LocalReplicaIdentity,
    attachmentId: string,
    attached: boolean
  ): Promise<void> {
    if (attached) {
      this.providerAttachments.attach(senderId, identity, attachmentId);
      // Mark attached first, then abort/settle the headless sender. The IPC
      // attach handshake does not resolve until the durable claim is safe for
      // the live provider to resume.
      await this.drainer.yieldToLiveProvider(identity);
    } else {
      this.providerAttachments.detach(senderId, identity, attachmentId);
      if (!this.isLiveProviderAttached(identity)) {
        this.drainer.resumeAfterLiveProvider(identity);
        this.trigger("provider-detached");
      }
    }
  }

  clearSender(senderId: number): void {
    const identities = this.providerAttachments.clearSender(senderId);
    if (identities.length === 0) return;
    for (const identity of identities) {
      if (!this.isLiveProviderAttached(identity)) {
        this.drainer.resumeAfterLiveProvider(identity);
      }
    }
    this.trigger("renderer-destroyed");
  }

  getAttachedSenderIds(
    identity: LocalReplicaIdentity,
    excludeSenderId?: number
  ): number[] {
    return this.providerAttachments.attachedSenderIds(identity, excludeSenderId);
  }

  isProviderAttached(identity: LocalReplicaIdentity): boolean {
    return this.providerAttachments.isAttached(identity);
  }

  private isLiveProviderAttached(identity: LocalReplicaIdentity): boolean {
    return this.providerAttachments.isAttached(identity);
  }

  /**
   * Report documents whose upload is not converging, at most hourly each.
   *
   * The counterpart to silencing the idle heartbeat: with that line gone, a
   * document that has never reached the server would otherwise leave no trace
   * at all. 22 batches sat inflight for 17 days without a single log line
   * naming them, because every failure was handled inside `drainDocument` and
   * the only guard that fired keyed on "we looked at something".
   */
  private reportStuckDocuments(stuck: StuckOutboxDocument[]): void {
    const now = Date.now();
    for (const document of stuck) {
      const key = `${document.identity.orgId}\x00${document.identity.documentId}`;
      const lastReported = this.stuckReportedAt.get(key) ?? 0;
      if (now - lastReported < STUCK_REPORT_INTERVAL_MS) continue;
      this.stuckReportedAt.set(key, now);
      logger.main.warn("[CollabOutboxDrainer] Document is not converging", {
        orgId: document.identity.orgId,
        documentId: document.identity.documentId,
        batchCount: document.batchCount,
        attemptCount: document.attemptCount,
        lastErrorCode: document.lastErrorCode,
        strandedSince: document.oldestCreatedAt
          ? new Date(document.oldestCreatedAt).toISOString()
          : null,
      });
    }
  }

  private trigger(source: string): void {
    if (!net.isOnline()) return;
    const accountId = getPersonalUserId();
    if (!accountId) {
      logger.main.error(
        "[CollabOutboxDrainer] Personal account identity unavailable; refusing org-scoped fallback",
        { source }
      );
      return;
    }
    const startedAt = Date.now();
    void this.drainer
      // Only the unconditional 30s tick honours the retry backoff. Every other
      // source is an event that changes the odds — the network came back, auth
      // was restored, a live provider let go — so those still retry at once.
      .drainOnce(accountId, { respectBackoff: source === "periodic" })
      .then((result) => {
        // Only log drains that did WORK. The previous guard keyed on
        // `documentsExamined > 0`, and examining is not doing anything: one
        // permanently-stuck document made this the single most frequent line
        // in main.log (1,011 blocks, ~8,000 lines in eight hours) while
        // reporting `batchesUploaded: 0` every time.
        const didWork = result.batchesUploaded > 0 || result.rejectedBatches > 0;
        if (didWork) {
          logger.main.info("[CollabOfflineMetric]", {
            metric: "background_drain",
            source,
            durationMs: Date.now() - startedAt,
            documentsDrained: result.documentsExamined,
            documentsDeferred: result.documentsDeferred,
            batchesUploaded: result.batchesUploaded,
            rejectedBatches: result.rejectedBatches,
          });
          logger.main.info("[CollabOutboxDrainer] Drain completed", {
            source,
            documentsExamined: result.documentsExamined,
            batchesUploaded: result.batchesUploaded,
            rejectedBatches: result.rejectedBatches,
          });
        }
        this.reportStuckDocuments(result.stuck);
      })
      .catch((error) => {
        logger.main.warn("[CollabOutboxDrainer] Drain failed", {
          source,
          error,
        });
      });
  }
}

let coordinator: CollabOutboxDrainCoordinator | null = null;

export function getCollabOutboxDrainCoordinator(): CollabOutboxDrainCoordinator {
  coordinator ??= new CollabOutboxDrainCoordinator();
  return coordinator;
}
