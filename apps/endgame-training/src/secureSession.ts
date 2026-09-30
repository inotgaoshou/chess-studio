import { Capacitor, registerPlugin } from "@capacitor/core";

export type SecureTeachingSession = {
  serverUrl?: string;
  token: string;
  expiresAt: string;
  refreshToken: string;
  deviceId: string;
  auth?: unknown;
};

type NativeSecureSession = {
  load(): Promise<{ session?: string }>;
  save(options: { session: string }): Promise<void>;
  clear(): Promise<void>;
};

const nativeSession = registerPlugin<NativeSecureSession>("SecureSession");
const BROWSER_DEVICE_KEY = "xiangqi-teaching-device-id";
let pendingWrite: Promise<unknown> = Promise.resolve();

function writeSession(operation: () => Promise<void>) {
  const result = pendingWrite.then(operation);
  pendingWrite = result.catch(() => undefined);
  return result;
}

function deviceId() {
  let value = localStorage.getItem(BROWSER_DEVICE_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(BROWSER_DEVICE_KEY, value);
  }
  return value;
}

export function isNativeSessionStore() {
  return Capacitor.isNativePlatform();
}

export const secureSession = {
  deviceId,
  async load(): Promise<SecureTeachingSession | undefined> {
    if (!isNativeSessionStore()) return undefined;
    await pendingWrite;
    const raw = (await nativeSession.load()).session;
    if (!raw) return undefined;
    try { return JSON.parse(raw) as SecureTeachingSession; }
    catch { await writeSession(() => nativeSession.clear()); return undefined; }
  },
  async save(session: SecureTeachingSession) {
    if (isNativeSessionStore()) await writeSession(() => nativeSession.save({ session: JSON.stringify(session) }));
  },
  async clear() {
    if (isNativeSessionStore()) await writeSession(() => nativeSession.clear());
  },
};
