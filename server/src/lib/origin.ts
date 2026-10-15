import { NextFunction, Request, Response } from 'express';

/**
 * The API serves personal data (profile, contacts, emails) on localhost with no login.
 * Only the dashboard's own origin may call it from a browser; any other website open in
 * the same browser is refused outright (not just denied CORS reads), which also blocks
 * cross-site form posts. Requests without an Origin header (curl, scripts, the Wellfound
 * agent) are unaffected.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const withLoopbackAliases = configured.flatMap((origin) => {
    if (origin.includes('://localhost')) return [origin, origin.replace('://localhost', '://127.0.0.1')];
    if (origin.includes('://127.0.0.1')) return [origin, origin.replace('://127.0.0.1', '://localhost')];
    return [origin];
  });
  return [...new Set(withLoopbackAliases)];
}

export function originGuard(origins: string[] = allowedOrigins()) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin || origins.includes(origin)) return next();
    res.status(403).json({ error: `Origin ${origin} is not allowed. Set FRONTEND_URL to allow it.` });
  };
}
