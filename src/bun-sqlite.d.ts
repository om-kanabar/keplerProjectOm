declare module "bun:sqlite" {
  export type SqliteBindings = Record<string, unknown> | unknown[] | undefined;

  export interface DatabaseOptions {
    readonly?: boolean;
    create?: boolean;
    strict?: boolean;
  }

  export class Statement<T = Record<string, unknown>> {
    all(bindings?: SqliteBindings): T[];
    get(bindings?: SqliteBindings): T | null;
    run(bindings?: SqliteBindings): { lastInsertRowid: number; changes: number };
    finalize(): void;
  }

  export class Database {
    constructor(filename?: string, options?: DatabaseOptions);
    query<T = Record<string, unknown>>(sql: string): Statement<T>;
    close(throwOnError?: boolean): void;
  }
}

declare namespace Bun {
  interface Server {
    hostname: string;
    port: number;
    stop(closeActiveConnections?: boolean): void;
  }

  interface ServeOptions {
    hostname?: string;
    port?: number;
    fetch(request: Request): Response | Promise<Response>;
  }
}

declare const Bun: {
  serve(options: Bun.ServeOptions): Bun.Server;
};
