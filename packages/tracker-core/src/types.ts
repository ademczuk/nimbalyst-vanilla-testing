export interface ExternalSourceRef {
  providerId: string;
  externalId: string;
  urn: string;
  url: string;
  titleSnapshot: string;
  stateSnapshot?: string;
  importedAt: string;
  lastSyncedAt: string;
  bodyHash?: string;
  upstreamBodyChanged?: boolean;
}

/**
 * How a local tracker item entered Nimbalyst. Replaces the loose
 * `source`/`sourceRef` pair (kept deprecated for one release for back-compat).
 * Absent on legacy items — default to `{ kind: 'native' }` at read time via
 * {@link normalizeTrackerOrigin}.
 */
export type TrackerOrigin =
  | { kind: 'native' }
  | { kind: 'inline'; filePath: string }
  | { kind: 'frontmatter'; filePath: string }
  | { kind: 'external'; external: ExternalSourceRef };

/**
 * Identity record for tracker item authorship and attribution.
 * Email is the canonical key for matching users across orgs and login states.
 * Display info is snapshotted at write time for offline rendering.
 */
export interface TrackerIdentity {
  /** Email -- stable cross-org identifier, canonical key for "is this the same person?" */
  email: string | null;
  /** Display name snapshotted at write time */
  displayName: string;
  /** Git user.name (fallback matching when no email) */
  gitName: string | null;
  /** Git user.email (fallback matching when no email) */
  gitEmail: string | null;
}

/**
 * Activity log entry for tracker item mutations.
 * Stored as a JSONB array on the tracker item's data.activity field.
 */
export interface TrackerActivity {
  id: string;
  authorIdentity: TrackerIdentity;
  action: 'created' | 'updated' | 'commented' | 'comment_updated' | 'comment_deleted' | 'status_changed' | 'assigned' | 'archived' | 'type_changed';
  /** Which field changed (for 'updated' actions) */
  field?: string;
  /** Previous value */
  oldValue?: string;
  /** New value */
  newValue?: string;
  /** Epoch ms */
  timestamp: number;
  /** Free-text context for the change, e.g. which commit closed the item */
  note?: string;
}

export interface TrackerComment {
  id: string;
  authorIdentity: TrackerIdentity;
  body: string;
  createdAt: number;
  serverOrdinal?: number;
  deleted?: boolean;
  updatedAt?: number;
}

export type TrackerItemSource = "native" | "inline" | "frontmatter" | "import";

/** Structural legacy item seam used while runtime callers finish migrating to TrackerRecord. */
export interface LegacyTrackerItem {
  id: string;
  issueNumber?: number;
  issueKey?: string;
  localKey?: string;
  type: string;
  typeTags?: string[];
  title: string;
  description?: string;
  status: string;
  priority?: "low" | "medium" | "high" | "critical";
  owner?: string;
  module: string;
  lineNumber?: number;
  workspace: string;
  tags?: string[];
  created?: string;
  updated?: string;
  dueDate?: string;
  progress?: number;
  lastIndexed: Date;
  customFields?: Record<string, any>;
  content?: any;
  archived?: boolean;
  archivedAt?: string;
  origin?: TrackerOrigin;
  source?: TrackerItemSource;
  sourceRef?: string;
  authorIdentity?: TrackerIdentity | null;
  lastModifiedBy?: TrackerIdentity | null;
  createdByAgent?: boolean;
  assigneeEmail?: string;
  reporterEmail?: string;
  assigneeId?: string;
  reporterId?: string;
  labels?: string[];
  linkedSessions?: string[];
  linkedCommitSha?: string;
  linkedCommits?: Array<{
    sha: string;
    message: string;
    sessionId?: string;
    timestamp: string;
  }>;
  documentId?: string;
  syncStatus?: "local" | "synced" | "pending";
}
