import sentryPlugin from "@cloudflare/pages-plugin-sentry";
import '@sentry/tracing';
import { fetchOthersConfig } from "./sysConfig";
import { checkDatabaseConfig as checkDbConfig } from './databaseAdapter.js';

let disableTelemetry = false;

export async function errorHandling(context) {
  // 读取KV中的设置
  const othersConfig = await fetchOthersConfig(context.env);
  disableTelemetry = !othersConfig.telemetry.enabled;

  const env = context.env;
  if (!disableTelemetry) {
    context.data.telemetry = true;
    let remoteSampleRate = 0.001;
    try {
      const sampleRate = await fetchSampleRate(context)
      //check if the sample rate is not null
      if (sampleRate) {
        remoteSampleRate = sampleRate;
      }
    } catch (e) { console.log(e) }
    const sampleRate = env.sampleRate || remoteSampleRate;
    return sentryPlugin({
      dsn: "https://44b7b443108ec6d298044b125ff89d28@o4507644548022272.ingest.us.sentry.io/4507644555100160",
      tracesSampleRate: sampleRate,
    })(context);;
  }

  return context.next();
}

export async function telemetryData(context) {
  // 读取KV中的设置
  const othersConfig = await fetchOthersConfig(context.env);
  disableTelemetry = !othersConfig.telemetry.enabled;
  
  if (!disableTelemetry) {
    try {
      const parsedHeaders = {};
      context.request.headers.forEach((value, key) => {
        parsedHeaders[key] = value
        //check if the value is empty
        if (value.length > 0) {
          context.data.sentry.setTag(key, value);
        }
      });
      const CF = JSON.parse(JSON.stringify(context.request.cf));
      const parsedCF = {};
      for (const key in CF) {
        if (typeof CF[key] == "object") {
          parsedCF[key] = JSON.stringify(CF[key]);
        } else {
          parsedCF[key] = CF[key];
          if (CF[key].length > 0) {
            context.data.sentry.setTag(key, CF[key]);
          }
        }
      }
      const data = {
        headers: parsedHeaders,
        cf: parsedCF,
        url: context.request.url,
        method: context.request.method,
        redirect: context.request.redirect,
      }
      //get the url path
      const urlPath = new URL(context.request.url).pathname;
      const hostname = new URL(context.request.url).hostname;
      context.data.sentry.setTag("path", urlPath);
      context.data.sentry.setTag("url", data.url);
      context.data.sentry.setTag("method", context.request.method);
      context.data.sentry.setTag("redirect", context.request.redirect);
      context.data.sentry.setContext("request", data);
      const transaction = context.data.sentry.startTransaction({ name: `${context.request.method} ${hostname}` });
      //add the transaction to the context
      context.data.transaction = transaction;
      return await context.next();
    } catch (e) {
      console.log(e);
    } finally {
      context.data.transaction.finish();
    }
  }

  return context.next();
}

export async function traceData(context, span, op, name) {
  const data = context.data
  if (data.telemetry) {
    if (span) {
      console.log("span finish")
      span.finish();
    } else {
      console.log("span start")
      span = await context.data.transaction.startChild(
        { op: op, name: name },
      );
    }
  }
}

async function fetchSampleRate(context) {
  const data = context.data
  if (data.telemetry) {
    const url = "https://frozen-sentinel.pages.dev/signal/sampleRate.json";
    const response = await fetch(url);
    const json = await response.json();
    return json.rate;
  }
}

// 检查数据库是否配置
export async function checkDatabaseConfig(context) {
  var env = context.env;

  var dbConfig = checkDbConfig(env);

  if (!dbConfig.configured) {
    try {
      const remoteUrlRaw = env && env.REMOTE_DB_URL;
      const remoteKeyRaw =
        env &&
        (env.REMOTE_DB_API_KEY ||
          env.REMOTE_DB_APIKEY ||
          env.REMOTE_DB_KEY ||
          env.REMOTE_DB_API_SECRET ||
          env.REMOTE_DB_API_TOKEN ||
          env.REMOTE_DB_TOKEN);

      const remoteUrl = remoteUrlRaw == null ? '' : String(remoteUrlRaw).trim();
      const remoteKey = remoteKeyRaw == null ? '' : String(remoteKeyRaw).trim();

      console.log('[DBCFG] not configured', {
        hasKV: !!dbConfig.hasKV,
        hasD1: !!dbConfig.hasD1,
        hasRemote: !!dbConfig.hasRemote,
        remoteUrlPresent: !!remoteUrl,
        remoteUrlType: remoteUrlRaw == null ? 'null' : typeof remoteUrlRaw,
        remoteKeyPresent: !!remoteKey,
        remoteKeyType: remoteKeyRaw == null ? 'null' : typeof remoteKeyRaw,
        remoteKeyLen: remoteKey.length,
        envHasRemoteUrlKey: !!(env && 'REMOTE_DB_URL' in env),
        envHasRemoteKeyKey: !!(env && 'REMOTE_DB_API_KEY' in env),
        envKeysRemote: env
          ? Object.keys(env).filter((k) => k.startsWith('REMOTE_') || k.startsWith('img_'))
          : null,
      });
    } catch (e) {
      console.log('[DBCFG] debug log failed', e);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "数据库未配置 / Database not configured",
        message: "请配置 KV 存储 (env.img_url) / D1 数据库 (env.img_d1) / 远程 DB (env.REMOTE_DB_URL + env.REMOTE_DB_API_KEY)。 / Please configure KV storage (env.img_url), D1 database (env.img_d1), or Remote DB (env.REMOTE_DB_URL + env.REMOTE_DB_API_KEY)."
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  // 继续执行
  return await context.next();
}
