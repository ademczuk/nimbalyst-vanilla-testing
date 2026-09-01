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

export type TrackerOrigin =
  | { kind: "native" }
  | { kind: "inline"; filePath: string }
  | { kind: "frontmatter"; filePath: string }
  | { kind: "external"; external: ExternalSourceRef };

export interface TrackerIdentity {
  email: string | null;
  displayName: string;
  gitName: string | null;
  gitEmail: string | null;
}

export interface TrackerActivity {
  id: string;
  authorIdentity: TrackerIdentity;
  action:
    | "created"
    | "updated"
    | "commented"
    | "comment_updated"
    | "comment_deleted"
    | "status_changed"
    | "assigned"
    | "archived"
    | "type_changed";
  field?: string;
  oldValue?: string;
  newValue?: string;
  timestamp: number;
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
