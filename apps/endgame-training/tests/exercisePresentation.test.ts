import assert from "node:assert/strict";
import { test } from "node:test";
import { canViewExerciseSolutions, exerciseMode, hasQuestionNavigation, ownsAnswerAccess } from "../src/exercisePresentation.ts";

test("answer access depends on current role, never student VIP or an old teacher login", () => {
  for (const vipActive of [false, true]) {
    const auth = {user:{role:"student",vipActive,isPlatformAdmin:true}};
    assert.equal(canViewExerciseSolutions(auth), false);
  }
  assert.equal(canViewExerciseSolutions(), false);
  assert.equal(canViewExerciseSolutions({user:{role:"user"}}), false);
  for (const role of ["coach", "admin"]) assert.equal(canViewExerciseSolutions({user:{role}}), true);
  assert.equal(canViewExerciseSolutions({user:{role:"user",isPlatformAdmin:true}}), true);
});

test("late answer responses cannot survive account, institution or role changes", () => {
  const owner={scope:"teacher:org-a",allowed:true,generation:1};
  assert.equal(ownsAnswerAccess(owner,{...owner}),true);
  for(const current of [{scope:"student:org-a",allowed:false},{scope:"teacher:org-b",allowed:true},{scope:owner.scope,allowed:false},{scope:"anonymous",allowed:false}]) {
    assert.equal(ownsAnswerAccess(owner,{generation:1,...current}),false);
  }
  assert.equal(ownsAnswerAccess(owner,{...owner,generation:3}),false); // Switched away, then back.
});

test("old learning/replay preferences restore to training without changing historic outcomes", () => {
  for(const mode of ["learning","replay"]) {
    assert.equal(exerciseMode(mode,false),"solver");
    assert.equal(exerciseMode(mode,true),mode);
  }
  for(const mode of ["solver","cloud","ai","free"])assert.equal(exerciseMode(mode,false),mode);
});

test("only multi-question practice has a bottom question navigator", () => {
  for(const total of [0,1])assert.equal(hasQuestionNavigation(total),false);
  for(const total of [2,20,100])assert.equal(hasQuestionNavigation(total),true);
});
