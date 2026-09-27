/**
 * `nim login`, `nim logout`, `nim whoami`: Nimbalyst Teams sign-in for the
 * hosted wiki (GitHub sign-in when `NIM_GITHUB_NATIVE=on`). Separate from the
 * desktop-loopback tracker commands; nothing here touches the Nimbalyst app.
 */
import type { ParsedArgs } from '../cli/parse.js';
import { flagBool } from '../cli/parse.js';
import { ExitCode } from '../cli/exitCodes.js';
import { safeText } from '../cli/output.js';
import { githubNativeEnabled, resolveServer } from '../cloud/config.js';
import { clearCredentials, loadCredentials } from '../cloud/credentials.js';
import {
  exchangeGithubToken,
  fetchUserInfo,
  githubDeviceFlow,
  nimbalystDeviceLogin,
  notLoggedInError,
  revokeRefreshToken,
  type UserInfo,
} from '../cloud/auth.js';

function describe(info: UserInfo): string {
  if (info.email) return safeText(info.email);
  return info.login ? `${safeText(info.login)} (${safeText(info.sub)})` : safeText(info.sub);
}

async function loginGithub(server: string): Promise<void> {
  let githubToken: string | undefined = await githubDeviceFlow((userCode, uri) => {
    process.stderr.write(`To sign in with GitHub, open ${uri} and enter the code ${userCode}\nWaiting for approval...\n`);
  });
  await exchangeGithubToken(server, githubToken);
  // Our own tokens are what we keep; the GitHub token has done its job.
  githubToken = undefined;
}

export async function runLogin(_args: ParsedArgs): Promise<number> {
  const server = resolveServer();
  if (githubNativeEnabled()) {
    await loginGithub(server);
  } else {
    await nimbalystDeviceLogin(server, (userCode, uri, completeUri) => {
      const code = safeText(String(userCode));
      process.stderr.write(
        completeUri
          ? `To sign in, open:\n\n  ${safeText(completeUri)}\n\nand confirm the code ${code}. (Or open ${safeText(String(uri))} and enter it.)\nWaiting for approval...\n`
          : `To sign in, open ${safeText(String(uri))} and enter the code ${code}\nWaiting for approval...\n`,
      );
    });
  }
  // The tokens are saved at this point; a userinfo failure must not report the login as failed.
  const info = await fetchUserInfo(server).catch(() => undefined);
  process.stdout.write(info ? `Logged in to ${server} as ${describe(info)}\n` : `Logged in to ${server}\n`);
  return ExitCode.OK;
}

export async function runLogout(_args: ParsedArgs): Promise<number> {
  const server = resolveServer();
  // Revoke first so a leaked copy of the file stops working; a failure only warns.
  const refreshToken = loadCredentials(server)?.refreshToken;
  if (refreshToken) {
    const warning = await revokeRefreshToken(server, refreshToken);
    if (warning) process.stderr.write(`nim: warning: ${safeText(warning)}. Local credentials are removed anyway.\n`);
  }
  const removed = await clearCredentials(server);
  process.stdout.write(removed ? `Logged out of ${server}\n` : `Not logged in to ${server}\n`);
  return ExitCode.OK;
}

export async function runWhoami(args: ParsedArgs): Promise<number> {
  const server = resolveServer();
  const creds = loadCredentials(server);
  if (!creds) throw notLoggedInError();
  // Older servers have no userinfo; then all we can say is where and until when.
  const info = await fetchUserInfo(server);
  const expiresAt = loadCredentials(server)?.expiresAt;
  const expires = expiresAt ? new Date(expiresAt).toISOString() : null;
  if (flagBool(args, 'json')) {
    process.stdout.write(JSON.stringify({ server, user: info ?? null, expiresAt: expires }, null, 2) + '\n');
    return ExitCode.OK;
  }
  if (flagBool(args, 'quiet')) {
    process.stdout.write(`${safeText(info?.email ?? info?.login ?? info?.sub ?? '')}\n`);
    return ExitCode.OK;
  }
  process.stdout.write(
    info
      ? `${describe(info)} on ${server}\n`
      : `Logged in to ${server} (identity unavailable from this server)${expires ? `; token expires ${expires}` : ''}\n`,
  );
  return ExitCode.OK;
}
