import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { ok } from "../../lib/http";
import { getSettings, currencyConfig } from "../../lib/settings";
import { getContentVersion } from "../../lib/contentVersion";
import { setContentCache } from "../../middleware/cache";
import { serializeSettings } from "../../serializers";
import { PUBLIC_SETTINGS_KEYS } from "../../../shared/settingsKeys.js";

const app = new Hono<AppEnv>();

/** Public-safe settings for the storefront (no secrets). */
app.get("/", async (c) => {
  const version = await getContentVersion(c.env);
  if (setContentCache(c, version)) return c.body(null, 304);

  const settings = await getSettings(c.env, PUBLIC_SETTINGS_KEYS);
  const publicSettings = serializeSettings(settings);
  const currency = currencyConfig(c.env, settings);

  return ok(c, {
    version,
    currency: currency.code,
    currencyLocale: currency.locale,
    ...publicSettings,
    store: { ...publicSettings.store, currency: currency.code },
    sizePresets: settings.size_presets ?? null,
    sizeMeta: settings.size_meta ?? null,
  });
});

export default app;
