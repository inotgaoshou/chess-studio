import type { CheckinApi, CheckinDraft, CheckinPlan, CheckinDetail, CheckinClass, CheckinStudent } from "./checkinDomain";
export function makeCheckinApi(request: <T>(path: string, init?: RequestInit) => Promise<T>, readPhoto: (path: string) => Promise<Blob>, classes: () => Promise<CheckinClass[]>, students: (id: string) => Promise<CheckinStudent[]>): CheckinApi {
  const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });
  return {
    list: () => request<CheckinPlan[]>("/api/v1/checkin/plans"),
    detail: id => request<CheckinDetail>(`/api/v1/checkin/plans/${id}`),
    create: (draft: CheckinDraft) => request<CheckinPlan>("/api/v1/admin/checkin/plans", json(draft)),
    save: (id, draft, edit) => request<CheckinPlan>(`/api/v1/admin/checkin/plans/${id}`, json({ ...draft, ...edit }, "PUT")),
    remove: (id, expectedRevision, reason) => request(`/api/v1/admin/checkin/plans/${id}`, json({ expectedRevision, reason }, "DELETE")),
    publish: id => request<CheckinPlan>(`/api/v1/admin/checkin/plans/${id}/publish`, { method: "POST" }),
    submit: (id, body) => request(`/api/v1/student/checkin/tasks/${id}/submit`, json(body)),
    review: (id, student, body) => request(`/api/v1/admin/checkin/tasks/${id}/students/${student}/review`, json(body)),
    upload: (task, id, blob) => { const form = new FormData(); form.append("id", id); form.append("file", blob, "homework.jpg"); return request(`/api/v1/student/checkin/tasks/${task}/photos`, { method: "POST", body: form }); },
    photo: id => readPhoto(`/api/v1/checkin/photos/${id}`), classes, students,
  };
}
