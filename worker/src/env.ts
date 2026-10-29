/**
 * Worker runtime bindings.
 *
 * ALLOWED_ORIGINS is a comma-separated list of permitted frontend origins.
 * FIREBASE_PROJECT_ID is the public Firebase project ID used to verify ID
 * tokens. STEAMGRIDDB_API_KEY enables the optional artwork proxy and is a
 * secret. Secret names stay declared here because `wrangler types` only emits
 * bindings present in local config or `.dev.vars`. Values are added with
 * `wrangler secret put` and are never committed.
 */
export interface Env {
  ALLOWED_ORIGINS: string;
  FIREBASE_PROJECT_ID?: string;
  STEAMGRIDDB_API_KEY?: string;
}
