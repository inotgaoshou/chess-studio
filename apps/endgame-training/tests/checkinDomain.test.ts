import { test } from "node:test";
import assert from "node:assert/strict";
import { beijingDate, beijingInstant, datesInStage, stagePreview, weekProgress, weekStart, canSubmitTask, copyCheckinDraft } from "../src/checkinDomain.ts";
import type { CheckinDetail, CheckinDraft } from "../src/checkinDomain.ts";
const draft: CheckinDraft = { clientId: "request", title: "阅读", startsAt: "2026-12-30T00:00:00+08:00", endsAt: "2027-01-05T23:59:00+08:00", classIds: [], studentIds: ["哥哥"], templates: [{id:"template",subject:"语文",instruction:"阅读20分钟",weekdays:[1,2,3,4,5,6,7],required:true,photoRequired:false}] };
function detail(): CheckinDetail { return { plan: { id:"plan",title:"哥哥计划",status:"published",phase:"active",startsAt:draft.startsAt,endsAt:draft.endsAt,supplementUntil:"2027-01-12T23:59:00+08:00" }, recipients:[{studentId:"哥哥",displayName:"哥哥"}], tasks: datesInStage(draft.startsAt,draft.endsAt).map(date => ({id:date,templateId:"template",localDate:date,subject:"语文",instruction:"阅读",required:true,photoRequired:false})),submissions:[],reviews:[],badges:[],serverNow:"2027-01-01T12:00:00+08:00" }; }
test("Beijing calendar is independent of device timezone and spans years",()=>{assert.equal(beijingDate("2026-12-31T16:00:00Z"),"2027-01-01");assert.equal(beijingInstant("2026-12-31T23:59"),"2026-12-31T15:59:00.000Z");assert.equal(weekStart("2027-01-01"),"2026-12-28");assert.equal(datesInStage(draft.startsAt,draft.endsAt).length,7);});
test("weekly templates expand into separate dates and split partial weeks",()=>{const preview=stagePreview(draft);assert.equal(preview.taskCount,7);assert.deepEqual(preview.weeks.map(w=>w.days),[5,2]);assert.deepEqual(preview.missing,[]);});
test("a stage day must have a required task, optional tasks do not fill the gap",()=>{const preview=stagePreview({...draft,templates:[{...draft.templates[0],required:false}]});assert.equal(preview.missing.length,7);assert.deepEqual(datesInStage(draft.endsAt,draft.startsAt),[]);});
test("two children and required/optional submissions have independent day counts",()=>{const d=detail();d.tasks.push({...d.tasks[0],id:"optional",required:false});d.submissions=[{taskId:d.tasks[0].id,studentId:"妹妹",status:"submitted",revision:1,note:"",photoIds:[],isLate:false}];assert.equal(weekProgress(d,"哥哥","2026-12-28").completed,0);assert.equal(weekProgress(d,"妹妹","2026-12-28").completed,1);d.submissions.push({...d.submissions[0],studentId:"哥哥"});assert.equal(weekProgress(d,"哥哥","2026-12-28").completed,1);d.submissions[1].status="returned";assert.equal(weekProgress(d,"哥哥","2026-12-28").completed,0);});
test("future dates are locked, grace boundary inclusive and archive rejects",()=>{const d=detail();assert.equal(canSubmitTask(d,d.tasks[0],"2026-12-29T23:59:59+08:00"),false);assert.equal(canSubmitTask(d,d.tasks[6],"2027-01-04T23:59:59+08:00"),false);assert.equal(canSubmitTask(d,d.tasks[0],d.plan.supplementUntil),true);assert.equal(canSubmitTask(d,d.tasks[0],"2027-01-12T23:59:01+08:00"),false);});

test("copy starts after the last plan for the same child, keeps duration and has independent template IDs", () => {
  const original = { ...detail().plan, draft };
  const later = { ...original, id: "later", endsAt: "2027-01-12T23:59:00+08:00" };
  const unrelated = { ...original, id: "other-child", endsAt: "2027-12-31T23:59:00+08:00", draft: { ...draft, studentIds: ["妹妹"] } };
  const copied = copyCheckinDraft(original, [original, later, unrelated], "2026-12-31");
  assert.equal(beijingDate(copied.startsAt), "2027-01-13");
  assert.equal(beijingDate(copied.endsAt), "2027-01-19");
  assert.notEqual(copied.clientId, draft.clientId); assert.notEqual(copied.templates[0].id, draft.templates[0].id);
  copied.templates[0].weekdays.pop(); assert.equal(draft.templates[0].weekdays.length, 7);
  assert.equal(beijingDate(copyCheckinDraft(original, [original], "2027-02-01").startsAt), "2027-02-01");
});

test("copy accounts for a class plan that also targets the selected child", () => {
  const original = { ...detail().plan, draft };
  const classPlan = { ...original, id: "class", endsAt: "2027-02-01T23:59:00+08:00", draft: { ...draft, studentIds: [], classIds: ["家庭班"] } };
  assert.equal(beijingDate(copyCheckinDraft(original, [original, classPlan], "2026-12-31", { "家庭班": ["哥哥", "妹妹"] }).startsAt), "2027-02-02");
});
