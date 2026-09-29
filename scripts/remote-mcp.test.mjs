import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('remote MCP is a first-class connector runtime', async () => {
  const types = await source('src/tools/connectors/types.ts');
  const integrations = await source('src/tools/integrations.ts');
  assert.match(types, /"internal" \| "child_worker" \| "remote_mcp"/u);
  assert.match(integrations, /mode: z\.enum\(\["internal", "child_worker", "remote_mcp"\]\)/u);
  assert.match(integrations, /connector\.mode === "remote_mcp"/u);
  assert.match(integrations, /syncRemoteMcpConnector/u);
  assert.match(integrations, /refreshStaleRemoteMcpConnectors/u);
  assert.match(integrations, /REMOTE_MCP_CATALOG_TTL_SECONDS/u);
});

test('remote MCP preserves upstream schemas and safety annotations', async () => {
  const integrations = await source('src/tools/integrations.ts');
  const registry = await source('src/w-gateway/registry.ts');
  assert.match(integrations, /remote_tool_name/u);
  assert.match(integrations, /readOnlyHint/u);
  assert.match(integrations, /destructiveHint/u);
  assert.match(integrations, /idempotentHint/u);
  assert.match(integrations, /row\.read_only_override != null/u);
  assert.match(registry, /action\.output_schema_json/u);
  assert.match(registry, /action\.idempotent_override/u);
});

test('remote MCP transport uses native initialize, discovery and tool calls with limits', async () => {
  const client = await source('src/remote-mcp/client.ts');
  assert.match(client, /"initialize"/u);
  assert.match(client, /"notifications\/initialized"/u);
  assert.match(client, /"tools\/list"/u);
  assert.match(client, /"tools\/call"/u);
  assert.match(client, /mcp-session-id/u);
  assert.match(client, /MAX_RPC_RESPONSE_BYTES/u);
  assert.match(client, /MAX_TOOL_CATALOG_CHARS/u);
});

test('remote MCP OAuth is outbound DCR + PKCE and tokens stay in encrypted profiles', async () => {
  const oauth = await source('src/remote-mcp/oauth.ts');
  const vault = await source('src/vault.ts');
  assert.match(oauth, /registration_endpoint/u);
  assert.match(oauth, /code_challenge_method/u);
  assert.match(oauth, /S256/u);
  assert.match(oauth, /storeCredentialProfile/u);
  assert.match(oauth, /refresh_token/u);
  assert.match(vault, /managed\?: boolean/u);
});

test('remote MCP safety hints cannot bypass OneAIWorkers confirmation policy', async () => {
  const integrations = await source('src/tools/integrations.ts');
  assert.match(integrations, /if \(row\.remote_tool_name\) return false;/u);
  assert.match(integrations, /Never use readOnlyHint to bypass confirmation/u);
  assert.match(integrations, /Boolean\(remoteResult\.ok\)/u);
});

test('remote MCP OAuth rejects mismatched authorization-server issuer metadata', async () => {
  const oauth = await source('src/remote-mcp/oauth.ts');
  assert.match(oauth, /metadata\.issuer/u);
  assert.match(oauth, /oauthIssuerMatches\(metadata\.issuer, issuer\.toString\(\)\)/u);
  assert.match(oauth, /issuer does not match the discovered authorization server/u);
});

test('marketplace and signed installer receipts accept remote MCP targets', async () => {
  const marketplace = await source('src/marketplace.ts');
  const installation = await source('src/connector-installation.ts');
  assert.match(marketplace, /\["cloudflare-worker", "remote_mcp"\]/u);
  assert.match(installation, /runtime: z\.literal\("remote_mcp"\)/u);
  assert.match(installation, /mode: "remote_mcp"/u);
  assert.match(installation, /catalogEntry\.target\.runtime !== expectedRuntime/u);
});
