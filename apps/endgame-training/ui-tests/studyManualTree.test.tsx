import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StudyManualTree, type StudyManualBranch } from '../src/StudyManualTree';
import { manualContinuations } from '../src/manualContinuation';

beforeAll(()=>{HTMLElement.prototype.scrollIntoView=vi.fn();HTMLElement.prototype.scrollTo=vi.fn();});
const main=['h2e2','h9g7'];
const notation=['炮二平五','马8进7'];
const branches:StudyManualBranch[]=[
 {id:'horse',parentCursor:0,parentPath:[],moves:['b0c2','b9c7'],notation:['马八进七','马2进3'],branchOrder:0,createdAt:1},
 {id:'pawn',parentCursor:0,parentPath:[],moves:['c3c4','c6c5'],notation:['兵七进一','卒3进1'],branchOrder:1,createdAt:2},
];
function props(extra:Record<string,unknown>={}){return {moves:branches[0].moves,notation:branches[0].notation,cursor:0,branches,canonicalMoves:main,canonicalNotation:notation,comments:{},onCommentChange:vi.fn(),onNavigate:vi.fn(),onAdopt:vi.fn(),onSelectContinuation:vi.fn(),onDelete:vi.fn(),onDiscardCurrent:vi.fn(),onMove:vi.fn(),...extra};}
function options(){fireEvent.click(document.querySelector('.study-branch-picker-trigger')!);return within(screen.getByRole('listbox',{name:'选择变招'}));}
describe('variation manager shares board continuation numbering',()=>{
 it('includes the canonical line while browsing a variation, and selects the same numbered move',()=>{
  const p=props();render(<StudyManualTree {...p}/>);
  const expected=manualContinuations(main,notation,branches,[],p.moves,p.notation);
  const menu=options();expect(menu.getAllByRole('option').map(n=>n.textContent?.replace('✓','').trim())).toEqual(expected.map((c,i)=>`${i+1}. ${c.notation}`));
  expect(menu.getByRole('option',{name:/1\. 马八进七/}).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(menu.getByRole('option',{name:/3\. 炮二平五/}));expect(p.onSelectContinuation).toHaveBeenCalledWith(expected[2]);
 });
 it('uses the exact current fork, including inherited and nested children',()=>{
  const nested={id:'nested',parentCursor:1,parentPath:['b0c2'],moves:['h9g7'],notation:['马8进7'],createdAt:3,branchOrder:0};
  const p=props({cursor:1,branches:[...branches,nested]});render(<StudyManualTree {...p}/>);
  const expected=manualContinuations(main,notation,p.branches,['b0c2'],p.moves,p.notation);
  expect(options().getAllByRole('option').map(n=>n.textContent?.replace('✓','').trim())).toEqual(expected.map((c,i)=>`${i+1}. ${c.notation}`));
 });
 it('renumbers after sorting or deletion without stale choices',()=>{
  const p=props();const view=render(<StudyManualTree {...p}/>);
  const reordered=[{...branches[0],branchOrder:3},{...branches[1],branchOrder:0}];
  view.rerender(<StudyManualTree {...p} branches={reordered}/>);
  expect(options().getAllByRole('option')[0].textContent).toContain('1. 兵七进一');
  fireEvent.click(document.querySelector('.study-branch-picker-trigger')!);
  view.rerender(<StudyManualTree {...p} moves={main} notation={notation} branches={[reordered[0]]}/>);
  expect(options().getAllByRole('option').map(n=>n.textContent?.replace('✓','').trim())).toEqual(['1. 马八进七','2. 炮二平五']);
 });
});
