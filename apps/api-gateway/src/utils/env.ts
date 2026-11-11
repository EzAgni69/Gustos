/**
 * Gusto API Gateway — Environment helpers
 */

/**
 * True when running as a real deployment. NODE_ENV=production is the normal
 * signal; a Railway environment is also treated as production so a deploy
 * that forgot NODE_ENV still gets the strict security checks.
 */
export function isProduction(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") return false;
  return Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);
}
