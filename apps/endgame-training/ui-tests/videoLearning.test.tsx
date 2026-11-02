import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoLearning } from '../src/video/VideoLearning';
import { VideoPlayer } from '../src/video/VideoPlayer';
import { chapterVideos, resumableVideo, videoGroups, progressFor } from '../src/video/model';
import type { VideoSnapshot } from '../src/video/types';
const api = vi.hoisted(() => ({addListener:vi.fn(),snapshot:vi.fn(),receiveProvisioned:vi.fn(),playback:vi.fn(),saveProgress:vi.fn(),bookmark:vi.fn(),pick:vi.fn(),update:vi.fn(),cancel:vi.fn(),retry:vi.fn(),deleteSeries:vi.fn(),deleteContent:vi.fn()}));
vi.mock('../src/video/library', () => ({VideoLibrary:api,nativeVideoAvailable:()=>true,localVideoUrl:(s:string)=>s}));
function fixture(): VideoSnapshot {return {
  categories:[{id:'category-other',title:'其他',order:0}],series:[{id:'s',categoryId:'category-other',title:'学习课',order:0}],
  chapters:[{id:'a',seriesId:'s',title:'上篇',path:'上篇',order:0},{id:'b',seriesId:'s',title:'下篇',path:'下篇',order:1}],
  videos:Array.from({length:30},(_,i)=>({id:`v${i}`,chapterId:'a',title:`${i+1}-1讲`,hash:`h${i}`,size:2000,order:i})).concat([{id:'b1',chapterId:'b',title:'1-1讲',hash:'hb',size:2000,order:0}]),
  progress:[{id:'v0',position:32,duration:600,viewed:false,updatedAt:10},{id:'b1',position:60,duration:600,viewed:true,updatedAt:20}],bookmarks:[],tasks:[]};}
beforeEach(()=> {vi.clearAllMocks();localStorage.clear();api.addListener.mockResolvedValue({remove:vi.fn()});api.snapshot.mockResolvedValue(fixture());api.receiveProvisioned.mockResolvedValue({});api.playback.mockResolvedValue({path:'file:///video.mp4'});api.saveProgress.mockResolvedValue({});api.bookmark.mockResolvedValue({});api.deleteContent.mockResolvedValue({});vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});});
describe('video library',()=>{
 it('groups 25 items and keeps repeated lesson numbers in different chapters independent',()=>{const data=fixture();expect(videoGroups(30)).toEqual([{start:0,end:25},{start:25,end:30}]);expect(chapterVideos(data,'a')).toHaveLength(30);expect(chapterVideos(data,'b')[0].id).toBe('b1');expect(resumableVideo(data)?.id).toBe('v0');expect(progressFor('v0',Infinity,NaN,false).position).toBe(0);});
 it('shows 25 numbers, switches groups, and preserves the original segment title',async()=>{render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);await screen.findByText('学习课');fireEvent.click(screen.getByText('学习课'));fireEvent.click(screen.getByText('上篇 · 30段'));expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(25);fireEvent.change(screen.getByLabelText('视频分组'),{target:{value:'1'}});expect(screen.getAllByRole('button',{name:/^第\d+段/})).toHaveLength(5);fireEvent.click(screen.getByRole('button',{name:'第26段 26-1讲'}));await screen.findByRole('heading',{name:'26-1讲'});expect(api.playback).toHaveBeenCalledWith({id:'v25'});});
 it('restores paused, saves progress before practice and on unmount, leaves viewed independent',async()=>{
  const data=fixture(),practice=vi.fn(),saved=vi.fn();const view=render(<VideoPlayer video={data.videos[0]} progress={data.progress[0]} bookmarks={[]} onSaved={saved} onPractice={practice}/>);
  await waitFor(()=>expect(view.container.querySelector('video')?.getAttribute('src')).toContain('video.mp4'));
  const media=view.container.querySelector('video')!;Object.defineProperty(media,'duration',{value:600,configurable:true});Object.defineProperty(media,'readyState',{value:1,configurable:true});fireEvent.loadedMetadata(media);expect(media.currentTime).toBe(32);expect(media.pause).toHaveBeenCalled();media.currentTime=91;
  fireEvent.click(screen.getByText('去练棋'));await waitFor(()=>expect(practice).toHaveBeenCalled());expect(api.saveProgress).toHaveBeenLastCalledWith(expect.objectContaining({id:'v0',position:91,viewed:false}));
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
  render(<VideoLearning onBack={()=>{}} onPractice={()=>{}}/>);await screen.findByText('学习课');fireEvent.click(screen.getByText('管理'));fireEvent.click(screen.getByText('学习课'));fireEvent.click(screen.getByText('上篇 · 30段'));
  fireEvent.click(screen.getByRole('button',{name:'删除视频 1-1讲'}));expect(api.deleteContent).not.toHaveBeenCalled();expect(screen.getByRole('alertdialog')).toBeTruthy();fireEvent.click(screen.getByText('取消，保留内容'));expect(api.deleteContent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'删除视频 1-1讲'}));fireEvent.click(screen.getByText('确认删除'));await waitFor(()=>expect(api.deleteContent).toHaveBeenCalledWith({kind:'video',id:'v0'}));
 });
 it('can mark viewed even when the file cannot load',async()=>{api.playback.mockRejectedValueOnce(new Error('missing'));render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);await screen.findByRole('alert');fireEvent.click(screen.getByText('标记看过'));await waitFor(()=>expect(api.saveProgress).toHaveBeenCalledWith(expect.objectContaining({id:'v0',viewed:true})));});
 it('keeps the player open when saving progress fails',async()=>{api.saveProgress.mockRejectedValue(new Error('空间不足'));const practice=vi.fn();const view=render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={practice}/>);const media=view.container.querySelector('video')!;Object.defineProperty(media,'readyState',{value:1,configurable:true});Object.defineProperty(media,'duration',{value:100,configurable:true});media.currentTime=20;fireEvent.click(screen.getByText('去练棋'));await screen.findByRole('alert');expect(practice).not.toHaveBeenCalled();});
 it('reports a missing file and offers retry',async()=>{api.playback.mockRejectedValueOnce(new Error('视频文件缺失，请重新导入'));render(<VideoPlayer video={fixture().videos[0]} bookmarks={[]} onSaved={()=>{}} onPractice={()=>{}}/>);await screen.findByRole('alert');fireEvent.click(screen.getByText('重试'));await waitFor(()=>expect(api.playback).toHaveBeenCalledTimes(2));});
});
