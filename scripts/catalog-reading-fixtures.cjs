// Captured published rows, replayed only by isolated UI/simulator acceptance.
const rows = require('./fixtures/catalog-reading-duplicates.json');
const base = {id:'e0c0221d-1b02-5f2c-9122-a7b0821f2603',name:'基础杀法',kind:'category',teachingEntry:'basic_mates',displayOrder:0,active:true,confirmed:true,itemCount:6,materialCount:0};
const chapter = {...base,id:'selected',parentId:base.id,name:'两步杀基础精选',kind:'chapter',teachingEntry:undefined};
const auth = {token:'reading-fixture',refreshToken:'reading-refresh',expiresAt:'2099-01-01T00:00:00Z',user:{id:'reading-student',orgId:'school',role:'student',vipActive:true,organizations:[]}};
function responseFor(u) {
 if (/\/auth\/(refresh|login)$/.test(u.pathname)) return auth;
 if (u.pathname.endsWith('/auth/me')) return auth.user;
 if (u.pathname.endsWith('/teaching-catalog/browse')) {
  const id=u.searchParams.get('nodeId'),current=id===base.id?base:id===chapter.id?chapter:null;
  return {currentNode:current,breadcrumbs:!current?[]:current===base?[base]:[base,chapter],children:!id?[base]:id===base.id?[chapter]:[],learningMaterials:[],statisticsReady:true,statisticsRevision:'1',statisticsSnapshotRevision:'1',availabilitySnapshotRevision:'1'};
 }
 if (u.pathname.endsWith('/problems')&&u.pathname.includes('/teaching-catalog/')) return u.searchParams.has('cursor')?{items:rows.slice(4),nextCursor:null}:{items:rows.slice(0,4),nextCursor:'4'};
 if (u.pathname.endsWith('/practice/dashboard')) return {topics:[],studyTopics:[],history:[]};
 if (u.pathname.endsWith('/student/assignments') || u.pathname.endsWith('/admin/problem-libraries/page')) return {items:[]};
 return [];
}
module.exports={rows,base,chapter,auth,responseFor};
