// Deterministic, synthetic source data for browser and disposable native simulator acceptance.
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const basic={id:'e0c0221d-1b02-5f2c-9122-a7b0821f2603',name:'基础杀法',kind:'category',teachingEntry:'basic_mates',active:true,confirmed:true,displayOrder:0,itemCount:30};
const node=(id,name,parentId=basic.id,count=2)=>({id,name,parentId,kind:'chapter',active:true,confirmed:true,displayOrder:0,itemCount:count});
const hidden=[node('90134f10-dc44-4b4e-b203-992af2d4c73c','翔宇 象棋绝杀108招'),node('38f0967a-3b69-4fa5-9834-534959af52ed','象棋绝杀108招翔宇')];
const endgame={...basic,id:'endgame',name:'残局杀法',teachingEntry:'endgame_mates'};
const complete=node('a2d70c8b-ff66-444d-80cd-e1803daa336a','象棋绝杀108招','endgame',108);
const retained=node('small-retained','应保留的两题章节');
const games=Array.from({length:20},(_,i)=>({id:'g'+i,sourceIndex:i,title:'棋谱学习 '+(i+1)+(i===19?'：长标题与完整赛事说明测试，保留题名阅读空间且不可横向溢出':''),redPlayer:'红方棋手',blackPlayer:'黑方棋手',eventName:'学习赛事',moveCount:3}));
const gameBooks=n=>Array.from({length:n},(_,i)=>({id:'gb'+i,title:'学习教材 '+(i+1),gameCount:20,folderPath:'M 棋谱学习'}));
const problem=i=>({id:'p'+i,libraryId:'lib',sourceIndex:i,title:'局面训练 '+(i+1)+(i===19?'：长题名与单独看题解按钮测试，保留原始题序':''),category:'训练教材',startingFen:fen,sideToMove:'red',solutionLength:3,note:'题解说明',trainingGoal:{kind:'gain_material',solverSide:'w',reviewMethod:'reviewed_solution'},solution:[{iccs:'a0a1',children:[{iccs:'a9a8',children:[{iccs:'a1a2',children:[]}]}]}]});
const detail={startingFen:fen,metadata:{title:'棋谱学习'},tree:{rootId:'root',nodes:[{id:'n1',parentId:'root',mv:'a0a1'},{id:'n2',parentId:'n1',mv:'a9a8'},{id:'n3',parentId:'n2',mv:'a1a2'}]}};
function responseFor(u,method='GET',state={}){
 const p=u.pathname;const role=state.role||'student';const user={id:state.owner||role,orgId:'fixture-school',role,displayName:'模拟器验收',vipActive:state.vip!==false};
 if(p.endsWith('/auth/refresh'))return {token:'library-fixture',refreshToken:'library-refresh',expiresAt:'2099-01-01T00:00:00Z',user};
 if(p.endsWith('/auth/me'))return user;
 if(p.endsWith('/platform-game-libraries'))return gameBooks(state.bookCount??56);
 if(/\/platform-game-libraries\/[^/]+\/games$/.test(p))return {items:games};
 if(/\/(platform-games|games)\/g\d+$/.test(p))return detail;
 if(p.endsWith('/platform-libraries'))return [{id:'lib',title:'训练教材',publishedCount:20,problemCount:20,folderPath:'C 残局'}];
 if(p.endsWith('/platform-libraries/lib/problems'))return {items:Array.from({length:20},(_,i)=>problem(i))};
 if(p.endsWith('/teaching-catalog/browse')){const id=u.searchParams.get('nodeId');const current=[basic,endgame,complete,...hidden,retained].find(n=>n.id===id);return {currentNode:current||null,breadcrumbs:!id?[]:id===basic.id?[basic]:id==='endgame'?[endgame]:id===complete.id?[endgame,complete]:[basic,current].filter(Boolean),children:!id?[basic,endgame]:id===basic.id?[...hidden,retained]:id==='endgame'?[complete]:[],learningMaterials:[],statisticsReady:true,statisticsRevision:'1',availabilitySnapshotRevision:'1'};}
 if(/\/teaching-catalog\/[^/]+\/problems$/.test(p))return {items:[problem(0),problem(1)]};
 if(/\/problems\/p\d+$/.test(p))return problem(Number(p.split('/').at(-1).slice(1)));
 if(p.endsWith('/practice/dashboard'))return {topics:[],studyTopics:[],history:[]};
 if(p.endsWith('/practice/sessions')&&method==='POST')return {id:'s1',mode:'solver',sourceKind:'random',status:'active',items:[{id:'i1',ordinal:0,status:'pending',problem:problem(0)}]};
 if(p.endsWith('/student/assignments')||p.endsWith('/admin/problem-libraries/page'))return {items:[]};
 return [];
}
module.exports={basic,hidden,retained,responseFor};
