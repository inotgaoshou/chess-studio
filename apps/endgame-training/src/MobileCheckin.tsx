import { useEffect, useMemo } from "react";
import { CheckinStudentWorkspace, CheckinTeacherWorkspace } from "./LearningCheckin";
import { CheckinStudentClient, IndexedCheckinPersistence } from "./checkinOffline";
import { checkinSession, teachingClient, type TeachingAuth } from "./teaching";
function useClient(auth: TeachingAuth) {
  return useMemo(() => { const session = checkinSession(auth); return new CheckinStudentClient(session.api, session.scope, new IndexedCheckinPersistence(), session.isCurrent); }, [auth.user.id, auth.user.orgId, auth.expiresAt]);
}
export function MobileStudentCheckin({ auth, onBack }: { auth: TeachingAuth; onBack(): void }) {
  const client = useClient(auth);
  return <div className="mobile-checkin-page"><CheckinStudentWorkspace key={client.scope} client={client} studentId={auth.user.id} onBack={onBack} /></div>;
}
export function MobileTeacherCheckin({ auth, onBack }: { auth: TeachingAuth; onBack(): void }) {
  const api = useMemo(() => checkinSession(auth).api, [auth.user.id, auth.user.orgId, auth.expiresAt]);
  return <CheckinTeacherWorkspace key={`${auth.user.id}:${auth.user.orgId}`} api={api} onBack={onBack} />;
}
export function CheckinSyncBridge({ auth }: { auth: TeachingAuth }) {
  const client = useClient(auth);
  useEffect(() => {
    let active = true;
    const sync = async () => { try { if (!active || teachingClient.auth()?.user.id !== auth.user.id) return;
      const before = await client.pending(); if (!before.some(p => !p.blocked)) return;
      await client.flush(); const after = await client.pending();
      if (active && (before.length !== after.length || JSON.stringify(before.map(p => p.error)) !== JSON.stringify(after.map(p => p.error)))) window.dispatchEvent(new Event("qixi-checkin-synced"));
    } catch { /* Pending records remain durable; the workspace exposes errors. */ } };
    void sync(); window.addEventListener("online", sync); const timer = window.setInterval(() => void sync(), 30_000);
    return () => { active = false; window.removeEventListener("online", sync); window.clearInterval(timer); };
  }, [client, auth.user.id]);
  return null;
}
