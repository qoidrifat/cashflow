const isDevelopment = import.meta.env.DEV;

function sanitize(value: unknown): unknown {
  if (!isDevelopment) return undefined;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'string') {
    return value.replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted-token]');
  }
  return value;
}

export const logger = {
  info(message: string, detail?: unknown) {
    if (isDevelopment) console.info(message, sanitize(detail));
  },
  warn(message: string, detail?: unknown) {
    if (isDevelopment) console.warn(message, sanitize(detail));
  },
  error(message: string, detail?: unknown) {
    if (isDevelopment) console.error(message, sanitize(detail));
  },
};
