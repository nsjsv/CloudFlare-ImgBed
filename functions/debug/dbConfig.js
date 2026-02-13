import { checkDatabaseConfig as checkDbConfig } from "../utils/databaseAdapter.js";

function normalizeValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();

  if (typeof value === "object") {
    if (typeof value.value === "string") return value.value.trim();
    if (typeof value.secret === "string") return value.secret.trim();
    if (typeof value.text === "string") return value.text.trim();
  }

  try {
    const str = String(value).trim();
    if (str && str !== "[object Object]") return str;
  } catch {
    // ignore
  }

  return "";
}

export async function onRequest(context) {
  const env = context.env || {};

  const remoteUrlRaw = env.REMOTE_DB_URL;
  const remoteKeyRaw =
    env.REMOTE_DB_API_KEY ||
    env.REMOTE_DB_APIKEY ||
    env.REMOTE_DB_KEY ||
    env.REMOTE_DB_API_SECRET ||
    env.REMOTE_DB_API_TOKEN ||
    env.REMOTE_DB_TOKEN;

  const remoteUrl = normalizeValue(remoteUrlRaw);
  const remoteKey = normalizeValue(remoteKeyRaw);

  const dbConfig = checkDbConfig(env);

  return new Response(
    JSON.stringify(
      {
        success: true,
        now: new Date().toISOString(),
        dbConfig,
        remote: {
          remoteUrlPresent: !!remoteUrl,
          remoteUrlType: remoteUrlRaw == null ? "null" : typeof remoteUrlRaw,
          remoteUrl,
          remoteKeyPresent: !!remoteKey,
          remoteKeyType: remoteKeyRaw == null ? "null" : typeof remoteKeyRaw,
          remoteKeyLen: remoteKey.length,
          envHasRemoteUrlKey: "REMOTE_DB_URL" in env,
          envHasRemoteKeyKey: "REMOTE_DB_API_KEY" in env,
        },
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}

