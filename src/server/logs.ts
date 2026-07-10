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
  serverLogs.push({
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: entry.level,
    message: entry.message,
    method: entry.method,
    path: entry.path,
    statusCode: entry.statusCode,
  });

  if (serverLogs.length > MAX_SERVER_LOGS) {
    serverLogs.splice(0, serverLogs.length - MAX_SERVER_LOGS);
  }
}

export function listServerLogs(): ServerLogEntry[] {
  return [...serverLogs];
}
