declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    KEY_VAULT_SECRET?: string;
  }
}
