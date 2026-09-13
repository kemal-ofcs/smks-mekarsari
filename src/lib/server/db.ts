import "server-only";

import { type Client, createClient } from "@libsql/client";
import { initDatabaseSchema } from "@/lib/db-schema";
import { resolveServerDatabaseConfig } from "@/lib/server/database-config";

interface ServerDatabaseState {
  client: Client | null;
  initialization: Promise<void> | null;
}

const globalDatabase = globalThis as typeof globalThis & {
  __sppgServerDatabase?: ServerDatabaseState;
};

if (!globalDatabase.__sppgServerDatabase) {
  globalDatabase.__sppgServerDatabase = { client: null, initialization: null };
}
const state = globalDatabase.__sppgServerDatabase;

import { Agent, setGlobalDispatcher } from "undici";

// Atur timeout koneksi TCP/TLS menjadi 35 detik (default undici adalah 10 detik yang sering timeout ke AWS us-east-1)
try {
  setGlobalDispatcher(
    new Agent({
      connect: {
        timeout: 35_000,
      },
    }),
  );
} catch {
  // Abaikan jika sudah terpasang atau di environment non-Node
}

const resilientFetch = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(35_000),
      });
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * (attempt + 1)),
        );
      }
    }
  }
  throw lastError;
};

export function getServerDatabase() {
  if (!state.client) {
    const config = resolveServerDatabaseConfig(process.env);
    state.client = createClient({
      url: config.url,
      authToken: config.authToken,
      fetch: resilientFetch,
    });
  }

  return state.client;
}

export async function ensureServerDatabaseInitialized() {
  if (!state.initialization) {
    state.initialization = initDatabaseSchema(getServerDatabase()).catch(
      (error) => {
        state.initialization = null;
        throw error;
      },
    );
  }

  await state.initialization;
}
