// Isolated simulator fixtures. These are never bundled into production assets.
const rows=require('./fixtures/catalog-reading-duplicates.json');
const auth={token:'mate-step-fixture',refreshToken:'mate-step-refresh',expiresAt:'2099-01-01T00:00:00Z',user:{id:'mate-step-student',orgId:'school',role:'student',vipActive:true,organizations:[]}};
const topics=['基础杀法','杀法练习系列','连将杀','非连将杀'].map((name,i)=>({id:'topic-'+i,name,teachingEntry:['basic_mates','mate_series','checking_mates','quiet_mates'][i],kind:'category',displayOrder:i,itemCount:407,active:true,confirmed:true}));
const book={...topics[3],id:'quiet-book',parentId:'topic-3',name:'法题精选-缓杀一',kind:'series',teachingEntry:undefined};
const chapter={...book,id:'quiet-chapter',parentId:book.id,name:'按原书题序',kind:'chapter'};
const steps=[{mateMoves:2,itemCount:2},{mateMoves:4,itemCount:1},{mateMoves:5,itemCount:1},{mateMoves:12,itemCount:1}];
function responseFor(u){
 if(/\/auth\/(login|refresh)$/.test(u.pathname))return auth;
 if(u.pathname.endsWith('/auth/me'))return auth.user;
 if(u.pathname.endsWith('/teaching-catalog/browse')){const id=u.searchParams.get('nodeId'),current=topics.find(t=>t.id===id)||[book,chapter].find(t=>t.id===id);return {currentNode:current||null,breadcrumbs:!current?[]:topics.includes(current)?[current]:current===book?[topics[3],book]:[topics[3],book,chapter],children:!id?topics:id==='topic-3'?[book]:id===book.id?[chapter]:[],learningMaterials:[],availabilitySnapshotRevision:'2',statisticsSnapshotRevision:'2',statisticsRevision:'2',statisticsReady:true,mateStepCounts:steps};}
 if(u.pathname.includes('/teaching-catalog/')&&u.pathname.endsWith('/problems')){const n=u.searchParams.get('mateMoves');return {items:n==='1'||n==='3'?[]:[{...rows[0],id:'p-'+(n||'unknown'),title:n?`${n}步验证题`:'原书缓杀题',verifiedMateMoves:n?Number(n):null}],nextCursor:null};}
 if(u.pathname.endsWith('/practice/dashboard'))return {topics:[],studyTopics:[],history:[]};
 if(u.pathname.endsWith('/student/assignments')||u.pathname.endsWith('/admin/problem-libraries/page'))return {items:[]};
 return [];
}
module.exports={auth,topics,book,chapter,steps,responseFor};
