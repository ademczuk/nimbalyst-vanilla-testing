import type { PermissionDecision } from '../providers/ProviderPermissionMixin';

export interface OpenCodePermissionRequest {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  always: string[];
  title?: string;
  tool?: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface OpenCodePermissionReply {
  id: string;
  sessionId?: string;
  response: 'once' | 'always' | 'reject';
}

export interface OpenCodePermissionContext {
  sessionId: string;
  workspacePath: string;
  permissionsPath: string;
  signal: AbortSignal;
}

export interface OpenCodePermissionHost {
  resolvePermission(
    request: OpenCodePermissionRequest,
    context: OpenCodePermissionContext
  ): Promise<PermissionDecision>;
}

export function normalizeOpenCodePermissionRequest(
  properties: Record<string, unknown>
): OpenCodePermissionRequest | null {
  const id =
    stringField(properties, 'id') ?? stringField(properties, 'permissionID') ?? stringField(properties, 'requestID');
  const sessionId = stringField(properties, 'sessionID') ?? stringField(properties, 'sessionId');
  const permission = stringField(properties, 'permission') ?? stringField(properties, 'type');
  if (!id || !sessionId || !permission) return null;

  const patterns = stringList(properties.patterns ?? properties.pattern);
  const always = stringList(properties.always);
  const metadata = isRecord(properties.metadata) ? properties.metadata : {};
  const tool = isRecord(properties.tool) ? properties.tool : undefined;
  const title = stringField(properties, 'title');

  return {
    id,
    sessionId,
    permission,
    patterns,
    always,
    ...(title ? { title } : {}),
    ...(tool ? { tool } : {}),
    metadata,
  };
}

export function normalizeOpenCodePermissionReply(properties: Record<string, unknown>): OpenCodePermissionReply | null {
  const id =
    stringField(properties, 'permissionID') ?? stringField(properties, 'requestID') ?? stringField(properties, 'id');
  if (!id) return null;

  const rawResponse = stringField(properties, 'response') ?? stringField(properties, 'reply');
  const response = normalizeReplyValue(rawResponse);
  if (!response) return null;

  const sessionId = stringField(properties, 'sessionID') ?? stringField(properties, 'sessionId');
  return { id, ...(sessionId ? { sessionId } : {}), response };
}

export function mapPermissionDecisionToOpenCode(decision: PermissionDecision): 'once' | 'always' | 'reject' {
  if (decision.decision === 'deny') return 'reject';
  return decision.scope === 'always' ? 'always' : 'once';
}

export function openCodePermissionPattern(request: OpenCodePermissionRequest): string {
  const reusablePatterns = request.always.length > 0 ? request.always : request.patterns;
  return `OpenCode(${request.permission}:${reusablePatterns.join('|') || request.id})`;
}

export function openCodePermissionDisplayName(request: OpenCodePermissionRequest): string {
  const targets = request.patterns.length > 0 ? request.patterns.join(', ') : request.permission;
  return request.title ?? `${request.permission}: ${targets}`;
}

function normalizeReplyValue(value: string | undefined): OpenCodePermissionReply['response'] | null {
  if (value === 'once' || value === 'always' || value === 'reject') return value;
  if (value === 'deny' || value === 'denied') return 'reject';
  if (value === 'allow') return 'once';
  return null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.length > 0 ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
