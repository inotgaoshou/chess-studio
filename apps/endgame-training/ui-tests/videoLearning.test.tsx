import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { VideoLearning, VideoLearningEntry } from '../src/video/VideoLearning';
import { VideoPlayer } from '../src/video/VideoPlayer';
import { chapterVideos, resumableVideo, videoGroups, progressFor } from '../src/video/model';
import type { VideoSnapshot } from '../src/video/types';
const orientation = vi.hoisted(() => ({set:vi.fn()}));
vi.mock('../src/orientation',()=>({setPreferredOrientation:orientation.set}));
const api = vi.hoisted(() => ({addListener:vi.fn(),snapshot:vi.fn(),receiveProvisioned:vi.fn(),playback:vi.fn(),saveProgress:vi.fn(),bookmark:vi.fn(),pick:vi.fn(),update:vi.fn(),cancel:vi.fn(),retry:vi.fn(),deleteSeries:vi.fn(),deleteContent:vi.fn()}));
vi.mock('../src/video/library', () => ({VideoLibrary:api,nativeVideoAvailable:()=>true,localVideoUrl:(s:string)=>s}));
function fixture(): VideoSnapshot {return {
  categories:[{id:'category-other',title:'其他',order:0}],series:[{id:'s',categoryId:'category-other',title:'学习课',order:0}],
  chapters:[{id:'a',seriesId:'s',title:'上篇',path:'上篇',order:0},{id:'b',seriesId:'s',title:'下篇',path:'下篇',order:1}],
  videos:Array.from({length:30},(_,i)=>({id:`v${i}`,chapterId:'a',title:`${i+1}-1讲`,hash:`h${i}`,size:2000,order:i})).concat([{id:'b1',chapterId:'b',title:'1-1讲',hash:'hb',size:2000,order:0}]),
  progress:[{id:'v0',position:32,duration:600,viewed:false,updatedAt:10},{id:'b1',position:60,duration:600,viewed:true,updatedAt:20}],bookmarks:[],tasks:[]};}
beforeEach(()=> {vi.clearAllMocks();localStorage.clear();sessionStorage.clear();orientation.set.mockReset().mockResolvedValue({requiresPhysicalRotation:false});api.addListener.mockResolvedValue({remove:vi.fn()});api.snapshot.mockResolvedValue(fixture());api.receiveProvisioned.mockResolvedValue({});api.playback.mockResolvedValue({path:'file:///video.mp4'});api.saveProgress.mockResolvedValue({});api.bookmark.mockResolvedValue({});api.deleteContent.mockResolvedValue({});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});});
describe('video library',()=>{
 it('pages forward and backward at the bottom without changing the playing lesson',async()=>{
  localStorage.setItem('qixi.video.selected','v0');render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  await screen.findByRole('heading',{name:'1-1讲'});
  expect(screen.queryByText('每组25集 · 点击继续学习')).toBeNull();
  expect(screen.queryByRole('button',{name:'上一页选集'})).toBeNull();
  fireEvent.click(await screen.findByRole('button',{name:'下一页选集'}));
  expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(5);
  expect(screen.queryByRole('button',{name:'下一页选集'})).toBeNull();
  expect(screen.getByRole('heading',{name:'1-1讲'})).toBeTruthy();expect(api.playback).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'上一页选集'}));
  expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(25);
 });

 it('starts with series and chapter controls collapsed and expands them without changing the playing lesson',async()=>{
  localStorage.setItem('qixi.video.selected','v0');render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  await screen.findByRole('heading',{name:'1-1讲'});
  expect(screen.queryByLabelText('快速切换系列')).toBeNull();expect(screen.queryByLabelText('快速切换章节')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'展开系列与章节'}));
  expect(screen.getByLabelText('快速切换系列')).toBeTruthy();expect(screen.getByLabelText('快速切换章节')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'收起系列与章节'}));
  expect(screen.queryByLabelText('快速切换系列')).toBeNull();expect(api.playback).toHaveBeenCalledTimes(1);
 });

 it('restores the initial misplaced layout course once without changing lesson identities or later manual categorization',async()=>{
  const data=fixture(),sid='c750b8c89eea3a4830b60e067d9717915127226f14955e06cfe261821cb0b495';
  data.categories.unshift({id:'category-opening',title:'布局',order:-1});
  data.series[0]={...data.series[0],id:sid,title:'01赵鑫鑫布局棋理48讲'};data.chapters.forEach(c=>c.seriesId=sid);
  api.snapshot.mockImplementation(async()=>structuredClone(data));api.update.mockImplementation(async({id,categoryId})=>{data.series.find(s=>s.id===id)!.categoryId=categoryId});
  localStorage.setItem('qixi.video.selected','v0');const before=structuredClone({videos:data.videos,progress:data.progress,bookmarks:data.bookmarks});
  const view=render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  await waitFor(()=>expect(api.update).toHaveBeenCalledWith({kind:'series',id:sid,categoryId:'category-opening'}));
  fireEvent.click(await screen.findByRole('button',{name:'布局',exact:true}));
  expect(screen.queryByText('此分类还没有课程，可在顶部导入。')).toBeNull();expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(25);
  expect({videos:data.videos,progress:data.progress,bookmarks:data.bookmarks}).toEqual(before);
  view.unmount();data.series[0].categoryId='category-other';const calls=api.update.mock.calls.length;
  render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);await screen.findByRole('heading',{name:'1-1讲'});
  expect(api.update).toHaveBeenCalledTimes(calls);expect(data.series[0].categoryId).toBe('category-other');
 });
 it('shows each episode only once in the course browser and keeps directory editing in management',async()=>{
  localStorage.setItem('qixi.video.selected','v0');render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  const browser=await screen.findByLabelText('选集与课程目录');await screen.findByRole('button',{name:'第1段 1-1讲'});
  expect(within(browser).getAllByText('1-1讲')).toHaveLength(1);
  expect(screen.queryByLabelText('课程分类')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'管理',exact:true}));expect(await screen.findByRole('tab',{name:'目录管理'})).toBeTruthy();
 });
 it('groups 25 items and keeps repeated lesson numbers in different chapters independent',()=>{const data=fixture();expect(videoGroups(30)).toEqual([{start:0,end:25},{start:25,end:30}]);expect(chapterVideos(data,'a')).toHaveLength(30);expect(chapterVideos(data,'b')[0].id).toBe('b1');expect(resumableVideo(data)?.id).toBe('v0');expect(progressFor('v0',Infinity,NaN,false).position).toBe(0);});
 it('shows 25 numbers, switches groups, and preserves the original segment title',async()=>{render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'展开系列与章节'}));fireEvent.change(screen.getByLabelText('快速切换系列'),{target:{value:'s'}});expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(25);expect(screen.queryByRole('combobox',{name:'视频分组'})).toBeNull();expect(screen.getByRole('button',{name:'上一组选集'}).hasAttribute('disabled')).toBe(true);fireEvent.click(screen.getByRole('button',{name:'下一组选集'}));expect(screen.getByRole('button',{name:'下一组选集'}).hasAttribute('disabled')).toBe(true);expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(5);fireEvent.click(screen.getByRole('button',{name:'第26段 26-1讲'}));await screen.findByRole('heading',{name:'26-1讲'});await waitFor(()=>expect(api.playback).toHaveBeenCalledWith({id:'v25'}));});
 it('restores paused, saves progress before practice and on unmount, leaves viewed independent',async()=>{
  const data=fixture(),practice=vi.fn(),saved=vi.fn();const view=render(<VideoPlayer video={data.videos[0]} progress={data.progress[0]} bookmarks={[]} onSaved={saved} onPractice={practice}/>);
  await waitFor(()=>expect(view.container.querySelector('video')?.getAttribute('src')).toContain('video.mp4'));
  const media=view.container.querySelector('video')!;Object.defineProperty(media,'duration',{value:600,configurable:true});Object.defineProperty(media,'readyState',{value:1,configurable:true});fireEvent.loadedMetadata(media);expect(media.currentTime).toBe(32);expect(media.pause).toHaveBeenCalled();media.currentTime=91;
  fireEvent.click(screen.getByLabelText('更多播放操作',{selector:'summary'}));fireEvent.click(screen.getByText('去练棋'));await waitFor(()=>expect(practice).toHaveBeenCalled());expect(api.saveProgress).toHaveBeenLastCalledWith(expect.objectContaining({id:'v0',position:91,viewed:false}));
  fireEvent.click(screen.getByLabelText('更多播放操作',{selector:'summary'}));
  fireEvent.click(screen.getByText('标记看过'));await waitFor(()=>expect(api.saveProgress).toHaveBeenLastCalledWith(expect.objectContaining({id:'v0',position:91,viewed:true})));
  media.currentTime=95;view.unmount();await act(async()=>{});expect(api.saveProgress).toHaveBeenLastCalledWith(expect.objectContaining({id:'v0',position:95}));
 });
 it('pauses and saves from native background notification when document visibility stays unchanged',async()=>{
  const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  const media=view.container.querySelector('video')!;Object.defineProperty(media,'readyState',{value:1,configurable:true});Object.defineProperty(media,'duration',{value:600,configurable:true});media.currentTime=233;
  expect(document.hidden).toBe(false);expect(api.addListener).toHaveBeenCalledWith('background',expect.any(Function));
  act(()=>api.addListener.mock.calls[0][1]());
  await waitFor(()=>expect(api.saveProgress).toHaveBeenCalledWith(expect.objectContaining({position:233})));
  expect(media.pause).toHaveBeenCalled();
 });
 it('requires a second confirmation and cancel never deletes a video',async()=>{
  render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);fireEvent.click(await screen.findByRole('button',{name:'管理',exact:true}));await screen.findByRole('region',{name:'视频与目录管理'});fireEvent.click(screen.getByText('学习课'));fireEvent.click(screen.getByText('上篇 · 30段'));
  fireEvent.click(screen.getByRole('button',{name:'删除视频 1-1讲'}));expect(api.deleteContent).not.toHaveBeenCalled();expect(screen.getByRole('alertdialog')).toBeTruthy();fireEvent.click(screen.getByText('取消，保留内容'));expect(api.deleteContent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'删除视频 1-1讲'}));fireEvent.click(screen.getByText('确认删除'));await waitFor(()=>expect(api.deleteContent).toHaveBeenCalledWith({kind:'video',id:'v0'}));
 });
 it('can mark viewed even when the file cannot load',async()=>{api.playback.mockRejectedValueOnce(new Error('missing'));render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);await screen.findByRole('alert');fireEvent.click(screen.getByText('标记看过'));await waitFor(()=>expect(api.saveProgress).toHaveBeenCalledWith(expect.objectContaining({id:'v0',viewed:true})));});
 it('keeps the player open when saving progress fails',async()=>{api.saveProgress.mockRejectedValue(new Error('空间不足'));const practice=vi.fn();const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={practice}/>);const media=view.container.querySelector('video')!;Object.defineProperty(media,'readyState',{value:1,configurable:true});Object.defineProperty(media,'duration',{value:100,configurable:true});media.currentTime=20;fireEvent.click(screen.getByText('去练棋'));await screen.findByRole('alert');expect(practice).not.toHaveBeenCalled();});
 it('reports a missing file and offers retry',async()=>{api.playback.mockRejectedValueOnce(new Error('视频文件缺失，请重新导入'));render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);await screen.findByRole('alert');fireEvent.click(screen.getByText('重试'));await waitFor(()=>expect(api.playback).toHaveBeenCalledTimes(2));});
 it('renames the current video without replacing its identity, playback or a lesson with the same name',async()=>{
  const data=fixture();api.snapshot.mockImplementation(async()=>structuredClone(data));
  api.update.mockImplementation(async({id,title})=>{data.videos.find(v=>v.id===id)!.title=title});
  localStorage.setItem('qixi.video.selected','v0');const view=render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  await screen.findByRole('heading',{name:'1-1讲'});const media=view.container.querySelector('video')!;
  Object.defineProperty(media,'readyState',{value:1,configurable:true});Object.defineProperty(media,'duration',{value:600,configurable:true});media.currentTime=93;
  fireEvent.click(screen.getByRole('button',{name:'重命名当前视频'}));await screen.findByRole('dialog');
  await waitFor(()=>expect(api.saveProgress).toHaveBeenCalledWith(expect.objectContaining({id:'v0',position:93})));
  fireEvent.change(screen.getByLabelText('名称'),{target:{value:'2-1讲'}});fireEvent.click(screen.getByRole('button',{name:'保存',exact:true}));
  await screen.findByRole('heading',{name:'2-1讲'});expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button',{name:'第1段 2-1讲'})).toBeTruthy();expect(screen.getByRole('button',{name:'第2段 2-1讲'})).toBeTruthy();
  expect(localStorage.getItem('qixi.video.selected')).toBe('v0');expect(media.currentTime).toBe(93);expect(api.playback).toHaveBeenCalledTimes(1);expect(data.videos).toHaveLength(31);
 });
 it('opens directory management directly from the account entry',async()=>{
  const entry=render(<VideoLearningEntry management onOpen={()=>{}}/>);await screen.findByText('视频与目录管理');fireEvent.click(screen.getByRole('button'));
  entry.unmount();render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  await screen.findByRole('region',{name:'视频与目录管理'});expect(screen.getByRole('tab',{name:'目录管理'}).getAttribute('aria-selected')).toBe('true');
 });
 it('filters video maintenance by title and still confirms the exact video before deleting',async()=>{
  sessionStorage.setItem('qixi.video.manage','1');render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  await screen.findByRole('region',{name:'视频与目录管理'});fireEvent.click(screen.getByRole('tab',{name:'视频管理'}));
  fireEvent.change(screen.getByLabelText('搜索视频'),{target:{value:'26-1'}});
  expect(screen.getAllByRole('button',{name:/^删除视频 /})).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'删除视频 26-1讲'}));expect(api.deleteContent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'确认删除'}));await waitFor(()=>expect(api.deleteContent).toHaveBeenCalledWith({kind:'video',id:'v25'}));
 });
 it('searches all courses by chapter or title and opens the matching chapter without entering management',async()=>{
  render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);expect(screen.queryByLabelText('搜索课程')).toBeNull();fireEvent.click(await screen.findByRole('button',{name:'展开课程搜索'}));let input=await screen.findByLabelText('搜索课程');
  fireEvent.change(input,{target:{value:'下篇'}});const results=screen.getByLabelText('课程搜索结果');
  expect(results.querySelectorAll('button')).toHaveLength(1);fireEvent.click(results.querySelector('button')!);
  await waitFor(()=>expect(api.playback).toHaveBeenCalledWith({id:'b1'}));expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(1);
  await waitFor(()=>expect(screen.queryByLabelText('搜索课程')).toBeNull());fireEvent.click(screen.getByRole('button',{name:'展开课程搜索'}));input=await screen.findByLabelText('搜索课程');
  fireEvent.change(input,{target:{value:'26-1'}});fireEvent.click(screen.getByLabelText('课程搜索结果').querySelector('button')!);
  await waitFor(()=>expect(api.playback).toHaveBeenCalledWith({id:'v25'}));expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(5);
 });
 it('switches category, series and chapter quickly without replacing the playing lesson until an episode is selected',async()=>{
  const data=fixture();data.categories.push({id:'endings',title:'残局',order:1},{id:'empty',title:'空分类',order:2});
  data.series.push({id:'s2',categoryId:'endings',title:'另一套课',order:1});data.chapters.push({id:'c',seriesId:'s2',title:'第一章',path:'',order:0});
  data.videos.push({id:'c1',chapterId:'c',title:'1-1讲',hash:'hc1',size:2000,order:0});api.snapshot.mockResolvedValue(data);
  localStorage.setItem('qixi.video.selected','v0');const view=render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  await screen.findByRole('heading',{name:'1-1讲'});const media=view.container.querySelector('video')!;
  Object.defineProperty(media,'readyState',{value:1,configurable:true});Object.defineProperty(media,'duration',{value:600,configurable:true});media.currentTime=43;
  fireEvent.click(await screen.findByRole('button',{name:'下一组选集'}));
  fireEvent.click(screen.getByRole('button',{name:'展开系列与章节'}));fireEvent.change(screen.getByLabelText('快速切换章节'),{target:{value:'b'}});expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(1);
  expect(screen.getByRole('status').textContent).toBe('1–1 / 1');expect(api.playback).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'残局',exact:true}));expect((screen.getByLabelText('快速切换系列') as HTMLSelectElement).value).toBe('s2');
  expect((screen.getByLabelText('快速切换章节') as HTMLSelectElement).value).toBe('c');expect(media.currentTime).toBe(43);expect(api.playback).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button',{name:'第1段 1-1讲'}));await waitFor(()=>expect(api.playback).toHaveBeenLastCalledWith({id:'c1'}));
  expect(api.saveProgress).toHaveBeenCalledWith(expect.objectContaining({id:'v0',position:43}));expect(localStorage.getItem('qixi.video.selected')).toBe('c1');
  fireEvent.click(screen.getByRole('button',{name:'空分类',exact:true}));expect(screen.getByText('此分类还没有课程，可在顶部导入。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'全部',exact:true}));expect((screen.getByLabelText('快速切换系列') as HTMLSelectElement).value).toBe('s');
 });
 it('offers explicit play and pause controls without relying on native overlay coordinates',async()=>{
  vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(function(this:HTMLMediaElement){fireEvent.play(this);return Promise.resolve()});
  render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'播放',exact:true}));await screen.findByRole('button',{name:'暂停',exact:true});expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
 });
 it('uses landscape fullscreen and restores the portrait preference without resetting playback',async()=>{
  localStorage.setItem('xiangqi-training-orientation','portrait');
  const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  const media=view.container.querySelector('video')!;Object.defineProperty(media,'readyState',{value:1,configurable:true});media.currentTime=96;
  fireEvent.click(screen.getByRole('button',{name:'全屏播放'}));await waitFor(()=>expect(orientation.set).toHaveBeenCalledWith('landscape'));
  expect(view.container.querySelector('.vl-immersive')).toBeTruthy();expect(media.currentTime).toBe(96);
  fireEvent.click(screen.getByRole('button',{name:'退出全屏'}));await waitFor(()=>expect(orientation.set).toHaveBeenLastCalledWith('portrait'));
  expect(localStorage.getItem('xiangqi-training-orientation')).toBe('portrait');expect(media.currentTime).toBe(96);expect(view.container.querySelector('.vl-immersive')).toBeNull();
 });
 it('restores auto rotation after leaving native iPhone fullscreen',async()=>{
  const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  const media=view.container.querySelector('video')! as HTMLVideoElement & {webkitEnterFullscreen:()=>void};Object.defineProperty(media,'readyState',{value:1,configurable:true});media.webkitEnterFullscreen=vi.fn();
  fireEvent.click(screen.getByRole('button',{name:'全屏播放'}));expect(media.webkitEnterFullscreen).toHaveBeenCalled();await waitFor(()=>expect(orientation.set).toHaveBeenCalledWith('landscape'));
  fireEvent(document,new Event('webkitfullscreenchange'));await act(async()=>{});expect(orientation.set).toHaveBeenLastCalledWith('landscape');
  fireEvent(media,new Event('webkitendfullscreen'));await waitFor(()=>expect(orientation.set).toHaveBeenLastCalledWith('auto','landscape'));expect(view.container.querySelector('.vl-immersive')).toBeNull();
 });
 it('restores portrait when Android WebView only emits prefixed fullscreen events',async()=>{
  localStorage.setItem('xiangqi-training-orientation','portrait');
  const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  const media=view.container.querySelector('video')!;Object.defineProperty(media,'readyState',{value:1,configurable:true});
  Object.defineProperty(media,'requestFullscreen',{value:vi.fn().mockResolvedValue(undefined),configurable:true});
  fireEvent.click(screen.getByRole('button',{name:'全屏播放'}));await waitFor(()=>expect(orientation.set).toHaveBeenCalledWith('landscape'));
  Object.defineProperty(document,'fullscreenElement',{value:media,configurable:true});fireEvent(document,new Event('webkitfullscreenchange'));
  Object.defineProperty(document,'fullscreenElement',{value:null,configurable:true});fireEvent(document,new Event('webkitfullscreenchange'));
  await waitFor(()=>expect(orientation.set).toHaveBeenLastCalledWith('portrait'));expect(localStorage.getItem('xiangqi-training-orientation')).toBe('portrait');
 });
 it.each(['portrait','auto'])('remembers the %s fullscreen direction independently of the app preference',async(direction)=>{
  localStorage.setItem('xiangqi-training-orientation','portrait');
  const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  fireEvent.change(screen.getByLabelText('全屏方向'),{target:{value:direction}});
  expect(localStorage.getItem('qixi.video.fullscreenOrientation')).toBe(direction);expect(orientation.set).not.toHaveBeenCalled();
  const media=view.container.querySelector('video')!;Object.defineProperty(media,'readyState',{value:1,configurable:true});fireEvent.click(screen.getByRole('button',{name:'全屏播放'}));
  await waitFor(()=>expect(orientation.set).toHaveBeenCalledWith(direction));fireEvent.click(screen.getByRole('button',{name:'退出全屏'}));
  await waitFor(()=>expect(orientation.set).toHaveBeenLastCalledWith('portrait'));view.unmount();
  render(<VideoPlayer video={fixture().videos[1]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  expect((screen.getByLabelText('全屏方向') as HTMLSelectElement).value).toBe(direction);expect(localStorage.getItem('xiangqi-training-orientation')).toBe('portrait');
 });
 it('restores the screen lock on navigation even if landscape is still being applied',async()=>{
  localStorage.setItem('xiangqi-training-orientation','portrait');let complete!:()=>void;orientation.set.mockImplementationOnce(()=>new Promise<void>(resolve=>{complete=resolve}));
  const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  const media=view.container.querySelector('video')!;Object.defineProperty(media,'readyState',{value:1,configurable:true});fireEvent.click(screen.getByRole('button',{name:'全屏播放'}));
  await waitFor(()=>expect(orientation.set).toHaveBeenCalledWith('landscape'));view.unmount();await act(async()=>complete());
  await waitFor(()=>expect(orientation.set).toHaveBeenLastCalledWith('portrait'));
 });

 it('synchronizes the chapter when management reopens an already-selected video',async()=>{
  localStorage.setItem('qixi.video.selected','v0');render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);
  await screen.findByRole('heading',{name:'1-1讲'});fireEvent.click(screen.getByRole('button',{name:'展开系列与章节'}));fireEvent.change(screen.getByLabelText('快速切换章节'),{target:{value:'b'}});
  expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'管理',exact:true}));await screen.findByRole('region',{name:'视频与目录管理'});
  fireEvent.click(screen.getByText('学习课'));fireEvent.click(screen.getByText('上篇 · 30段'));fireEvent.click(screen.getByRole('button',{name:'观看 1-1讲'}));
  await screen.findByRole('heading',{name:'1-1讲'});expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(25);
 });
 it('also applies temporary landscape when entering through the native video controls',async()=>{
  localStorage.setItem('xiangqi-training-orientation','portrait');
  const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);
  const media=view.container.querySelector('video')!;fireEvent(media,new Event('webkitbeginfullscreen'));
  await waitFor(()=>expect(orientation.set).toHaveBeenCalledWith('landscape'));
  fireEvent(media,new Event('webkitendfullscreen'));await waitFor(()=>expect(orientation.set).toHaveBeenLastCalledWith('portrait'));
 });

});
