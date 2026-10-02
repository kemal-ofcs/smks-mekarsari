import "server-only";

import { type Client, createClient } from "@libsql/client";
import { initDatabaseSchema } from "@/lib/db-schema";
import {
  fileDatabaseOptions,
  resolveServerDatabaseConfig,
} from "@/lib/server/database-config";

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
      ...fileDatabaseOptions(config),
    });
  }

  return state.client;
}

async function siapkanDatabase() {
  const client = getServerDatabase();
  // WAL membuat pembaca tidak menghalangi penulis, dan sebaliknya. Tanpa itu,
  // setiap halaman situs publik yang sedang dibaca menahan login di aplikasi
  // admin. Setelannya tersimpan di berkas database, jadi cukup disetel di sini:
  // situs publik tidak pernah menyiapkan database, hanya membacanya.
  if (!resolveServerDatabaseConfig(process.env).isRemote) {
    await client.execute("PRAGMA journal_mode = WAL;");
  }
  await initDatabaseSchema(client);
}

export async function ensureServerDatabaseInitialized() {
  if (!state.initialization) {
    state.initialization = siapkanDatabase().catch((error) => {
      state.initialization = null;
      throw error;
    });
  }

  await state.initialization;
}
