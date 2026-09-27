/**
 * GitHub-native wiki commands (`NIM_GITHUB_NATIVE=on` only): per-wiki
 * membership, join secrets, and `wiki:<id>` addressing from the earlier design.
 * Off by default; Teams mode decides membership in Nimbalyst Teams instead.
 */
import type { ParsedArgs } from '../cli/parse.js';
import { flagStr } from '../cli/parse.js';
import { notFoundError, usageError } from '../cli/exitCodes.js';
import { outputOptions } from './common.js';
import { readWikiFile, resolveRepo, writeWikiFile } from '../cloud/repo.js';
import { renderObject } from '../cloud/wikiOutput.js';
import { resolveConsoleOrigin } from '../cloud/config.js';
import { operand, print, tool, type WikiCtx } from './wikiCtx.js';

export const GITHUB_NATIVE_VERBS = new Set(['create', 'invite', 'remove-member', 'rotate-secret']);

export function githubCtx(args: ParsedArgs, server: string, startDir: string): WikiCtx {
  const binding = resolveRepo(startDir, flagStr(args, 'repo'), { creating: args.verb === 'create' });
  const joinSecret = flagStr(args, 'join-secret') ?? binding.wikiFile?.joinSecret;
  let wikiId = binding.wikiFile?.wikiId;
  const ctx: WikiCtx = {
    args,
    server,
    root: binding.root,
    base: { repo: binding.repo },
    changesetsPath: async () => {
      if (!wikiId) {
        const status = await tool(ctx, 'wiki_status', { joinSecret });
        const id = status?.wiki?.id;
        if (typeof id !== 'string') throw notFoundError(`No wiki you can read for ${binding.repo} (state: ${status?.state ?? 'unknown'}).`);
        wikiId = id;
      }
      return `/api/wiki/${encodeURIComponent(wikiId)}/changesets`;
    },
    changesetPage: (changesetId) =>
      wikiId ? `${resolveConsoleOrigin()}/wiki/${encodeURIComponent(wikiId)}/changes/${encodeURIComponent(changesetId)}` : undefined,
  };
  // Only `status` presents the secret; it is what joins a repo-link wiki.
  if (args.verb === 'status') ctx.base = { ...ctx.base, joinSecret };
  return ctx;
}

/** Handles the GitHub-native verbs; returns undefined for any other verb. */
export async function runGithubVerb(ctx: WikiCtx): Promise<number | undefined> {
  const opts = outputOptions(ctx.args);
  switch (ctx.args.verb) {
    case 'status': {
      const res = await tool(ctx, 'wiki_status');
      const joinError = res?.joinError ? `${res.joinError.code ?? ''}${res.joinError.message ? `: ${res.joinError.message}` : ''}` : undefined;
      return print(ctx, res, () =>
        renderObject(
          {
            repo: ctx.base.repo,
            state: res?.state,
            wiki: res?.wiki?.id,
            role: res?.wiki?.role,
            policy: res?.wiki?.policy,
            url: res?.wiki?.url,
            joinError,
            createOptions: res?.createOptions,
          },
          opts,
          'wiki',
        ),
      );
    }
    case 'create': {
      const policy = flagStr(ctx.args, 'policy') ?? 'invite';
      if (policy !== 'invite' && policy !== 'repo-link') throw usageError(`--policy must be 'invite' or 'repo-link'.`);
      const res = await tool(ctx, 'wiki_create', { policy, changesetId: flagStr(ctx.args, 'changeset') });
      const id = res?.wiki?.id;
      if (typeof id === 'string') {
        writeWikiFile(ctx.root, { wikiId: id, ...(res?.joinSecret ? { joinSecret: res.joinSecret } : {}) });
      }
      // The join secret goes to wiki.json, not the terminal, unless --json asked for the raw result.
      return print(ctx, res, () => renderObject({ wiki: id, policy: res?.wiki?.policy, url: res?.wiki?.url }, opts, 'wiki'));
    }
    case 'invite':
    case 'remove-member': {
      const githubLogin = operand(ctx, 0, 'a GitHub login');
      const name = ctx.args.verb === 'invite' ? 'wiki_invite' : 'wiki_remove_member';
      const res = await tool(ctx, name, { githubLogin });
      return print(ctx, res, () => renderObject(res ?? {}, opts, 'githubLogin'));
    }
    case 'rotate-secret': {
      const res = await tool(ctx, 'wiki_rotate_secret');
      const hasFile = readWikiFile(ctx.root) !== undefined;
      if (typeof res?.joinSecret === 'string' && hasFile) {
        writeWikiFile(ctx.root, { joinSecret: res.joinSecret });
        process.stderr.write('Updated .nimbalyst/wiki.json with the new join secret. Commit it so teammates can rejoin.\n');
      }
      return print(ctx, res, () => (hasFile ? '' : renderObject(res ?? {}, opts, 'joinSecret')));
    }
    default:
      return undefined;
  }
}
