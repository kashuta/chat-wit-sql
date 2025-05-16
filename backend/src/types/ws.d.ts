/**
 * Type declarations for WebSocket module
 */
declare module 'ws' {
  import { EventEmitter } from 'events';
  import { IncomingMessage } from 'http';
  import { Duplex } from 'stream';

  export class WebSocket extends EventEmitter {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    binaryType: string;
    readonly bufferedAmount: number;
    readonly extensions: string;
    readonly protocol: string;
    readonly readyState: number;
    readonly url: string;

    close(code?: number, reason?: string): void;
    ping(data?: any, mask?: boolean, cb?: (err: Error) => void): void;
    pong(data?: any, mask?: boolean, cb?: (err: Error) => void): void;
    send(data: any, cb?: (err?: Error) => void): void;
    send(data: any, options: { mask?: boolean; binary?: boolean; compress?: boolean; fin?: boolean }, cb?: (err?: Error) => void): void;
    terminate(): void;

    on(event: 'close', listener: (code: number, reason: string) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'message', listener: (data: Buffer) => void): this;
    on(event: 'open', listener: () => void): this;
    on(event: 'ping' | 'pong', listener: (data: Buffer) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export interface ServerOptions {
    host?: string;
    port?: number;
    backlog?: number;
    server?: any;
    verifyClient?: (info: { origin: string; secure: boolean; req: IncomingMessage }) => boolean | Promise<boolean>;
    handleProtocols?: (protocols: string[], request: IncomingMessage) => string | false;
    path?: string;
    noServer?: boolean;
    clientTracking?: boolean;
    perMessageDeflate?: boolean | object;
    maxPayload?: number;
  }

  export class WebSocketServer extends EventEmitter {
    options: ServerOptions;
    path: string;
    clients: Set<WebSocket>;

    constructor(options?: ServerOptions, callback?: () => void);

    close(cb?: (err?: Error) => void): void;
    handleUpgrade(request: IncomingMessage, socket: Duplex, upgradeHead: Buffer, callback: (client: WebSocket, request: IncomingMessage) => void): void;
    shouldHandle(request: IncomingMessage): boolean;

    on(event: 'connection', listener: (socket: WebSocket, request: IncomingMessage) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'headers', listener: (headers: string[], request: IncomingMessage) => void): this;
    on(event: 'listening', listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export function createWebSocketStream(websocket: WebSocket, options?: object): Duplex;
} 