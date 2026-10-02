import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { encryptInputSecrets } from '@apify/input_secrets';
import { envWithWorkerInput, WORKER_INPUT_FIELDS } from '@content-lab/core';
import { describe, expect, it, vi } from 'vitest';
import { decryptActorInput, readActorInput } from '../src/input';

const schema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8'));

// A throwaway key pair in the shape Apify hands a run: a passphrase-protected
// private key, base64 encoded.
function runKeys() {
  const passphrase = 'test-passphrase';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
  });
  return {
    publicKey: createPublicKey(publicKey),
    env: { APIFY_INPUT_SECRETS_PRIVATE_KEY_FILE: Buffer.from(privateKey).toString('base64'), APIFY_INPUT_SECRETS_PRIVATE_KEY_PASSPHRASE: passphrase },
  };
}

describe('actor input', () => {
  it('declares every dashboard setting, with the keys as secret fields', () => {
    for (const [field, { secret }] of Object.entries(WORKER_INPUT_FIELDS)) {
      expect(schema.properties[field], field).toBeDefined();
      expect(Boolean(schema.properties[field].isSecret), field).toBe(secret);
    }
  });

  it('decrypts what Apify encrypted and applies it over the actor environment', () => {
    const { publicKey, env } = runKeys();
    const sent = { runId: 'r1', supabaseUrl: 'https://abc.supabase.co', supabaseServiceRoleKey: 'service-role', groqApiKey: 'gsk_test' };
    const stored = encryptInputSecrets({ input: sent, inputSchema: schema, publicKey });
    expect(stored.supabaseServiceRoleKey).toMatch(/^ENCRYPTED_VALUE:/);
    expect(stored.supabaseUrl).toBe('https://abc.supabase.co');

    const input = decryptActorInput(stored, env);
    expect(input).toEqual(sent);
    expect(envWithWorkerInput(input, { GROQ_API_KEY: 'old' })).toMatchObject({
      SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role', GROQ_API_KEY: 'gsk_test',
    });
  });

  it('leaves the input alone when the run has no key, and never uses encrypted text as a key', () => {
    const { publicKey } = runKeys();
    const stored = encryptInputSecrets({ input: { runId: 'r1', groqApiKey: 'gsk_test' }, inputSchema: schema, publicKey });
    const input = decryptActorInput(stored, {});
    expect(input).toEqual(stored);
    expect(envWithWorkerInput(input, {}).GROQ_API_KEY).toBeUndefined();
  });

  it('reads INPUT from the run key-value store and decrypts it', async () => {
    const { publicKey, env } = runKeys();
    const stored = encryptInputSecrets({ input: { mode: 'sweep', typesafeApiKey: 'ts_test' }, inputSchema: schema, publicKey });
    const fetchImpl = vi.fn(async () => Response.json(stored));
    const input = await readActorInput({ ...env, ACTOR_DEFAULT_KEY_VALUE_STORE_ID: 'kv1', APIFY_TOKEN: 't' }, fetchImpl as unknown as typeof fetch);
    expect(input).toEqual({ mode: 'sweep', typesafeApiKey: 'ts_test' });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.apify.com/v2/key-value-stores/kv1/records/INPUT');
  });
});
