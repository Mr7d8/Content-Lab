import { createPrivateKey } from 'node:crypto';
import { decryptInputSecrets } from '@apify/input_secrets';

export type ActorInput = { runId?: string; mode?: string } & Record<string, unknown>;

type Env = Record<string, string | undefined>;

// Reads the actor input without the Apify SDK, to keep the image small: the
// platform injects the token and the default key-value store that holds INPUT.
export async function readActorInput(env: Env, fetchImpl: typeof fetch = fetch): Promise<ActorInput> {
  if (env.CONTENT_LAB_RUN_ID) return { runId: env.CONTENT_LAB_RUN_ID };
  const store = env.ACTOR_DEFAULT_KEY_VALUE_STORE_ID ?? env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
  const key = env.ACTOR_INPUT_KEY ?? env.APIFY_INPUT_KEY ?? 'INPUT';
  if (!store || !env.APIFY_TOKEN) throw new Error('Not running on Apify: use pnpm worker:dev --run <id> locally');
  const res = await fetchImpl(`https://api.apify.com/v2/key-value-stores/${store}/records/${key}`, {
    headers: { Authorization: `Bearer ${env.APIFY_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Could not read actor input (HTTP ${res.status})`);
  return decryptActorInput((await res.json()) as ActorInput, env);
}

// Apify stores secret input fields encrypted with the actor's public key and
// gives each run the matching private key, as the Apify SDK expects.
export function decryptActorInput(input: ActorInput, env: Env): ActorInput {
  const keyFile = env.APIFY_INPUT_SECRETS_PRIVATE_KEY_FILE ?? env.ACTOR_INPUT_SECRETS_PRIVATE_KEY_FILE;
  const passphrase = env.APIFY_INPUT_SECRETS_PRIVATE_KEY_PASSPHRASE ?? env.ACTOR_INPUT_SECRETS_PRIVATE_KEY_PASSPHRASE;
  if (!keyFile || !passphrase) return input;
  const privateKey = createPrivateKey({ key: Buffer.from(keyFile, 'base64'), passphrase });
  return decryptInputSecrets({ input, privateKey });
}
