type ServerLogLevel = "info" | "error";

export type ServerLogEntry = {
  timestamp: string;
  level: ServerLogLevel;
  message: string;
  method?: string;
  path?: string;
  statusCode?: number;
};

const MAX_SERVER_LOGS = 200;
const serverLogs: ServerLogEntry[] = [];

export function appendServerLog(entry: Omit<ServerLogEntry, "timestamp"> & { timestamp?: string }): void {
  const logEntry = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: entry.level,
    message: entry.message,
    method: entry.method,
    path: entry.path,
    statusCode: entry.statusCode,
  } satisfies ServerLogEntry;

  serverLogs.push(logEntry);

  const request = logEntry.method && logEntry.path
    ? ` ${logEntry.method} ${logEntry.path}${logEntry.statusCode === undefined ? "" : ` -> ${logEntry.statusCode}`}`
    : "";
  console.log(`[habitat-api]${request} ${logEntry.message}`);

  if (serverLogs.length > MAX_SERVER_LOGS) {
    serverLogs.splice(0, serverLogs.length - MAX_SERVER_LOGS);
  }
}

export function listServerLogs(): ServerLogEntry[] {
  return [...serverLogs];
}
