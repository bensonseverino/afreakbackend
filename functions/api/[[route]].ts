import { handle } from "hono/cloudflare-pages";
import { buildApp } from "../../server/app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const onRequest: any = handle(buildApp());
