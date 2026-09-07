import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { planEstimate, callCost } from '../build/lib/domain/pricing.js';
import { estimatePresentation } from '../build/lib/format.js';
import { boardPayload, defaultBoard } from '../build/lib/boards/codec.js';
import { conditionalCandidates } from '../build/lib/domain/decision.js';

const models = JSON.parse(readFileSync(new URL('../data/api-models.json', import.meta.url))).models;
const plans = JSON.parse(readFileSync(new URL('../data/plans.json', import.meta.url))).plans;
test('credit capacity is valued in API dollars for monthly and conditional windows', () => {
  const plan = plans.find(p => p.quotaDetail?.kind === 'credit-allowance' && p.creditMultipliers);
  const model = models.find(m => plan.creditMultipliers[m.id]);
  const settings = {input: 6000, output: 1000, cacheRatio: 0.2};
  for (const resetWindow of ['monthly', 'weekly']) {
    const copy = {...plan, conditionalLimits: [], quotaDetail: {...plan.quotaDetail, resetWindow}};
    const estimate = planEstimate(copy, settings, model, model);
    assert.ok(estimate.callsHigh > 0);
    assert.equal(estimate.valueHigh, estimate.callsHigh * callCost(model, settings, plan.cacheRatio));
    if (resetWindow === 'weekly') assert.equal(estimate.valueLow, 0);
    else assert.equal(estimate.valueLow, estimate.valueHigh);
  }
});
test('capacity presentation separates unknown, parity, conditional, zero and invalid numbers', () => {
  const base = {callsLow: 0, callsHigh: 0, valueLow: 0, valueHigh: 0};
  for (const kind of ['unknown-quota', 'free']) {
    assert.equal(estimatePresentation({...base, basis: {kind}}).calls, 'Unknown capacity');
    assert.equal(estimatePresentation({...base, basis: {kind}}).score, null);
  }
  assert.equal(estimatePresentation({...base, basis:{kind:'allowance'}}).calls, '0 calls');
  assert.match(estimatePresentation({...base, basis:{kind:'break-even'}}).calls, /parity/);
  assert.equal(estimatePresentation({...base, basis:{kind:'break-even'}}).score, null);
  assert.match(estimatePresentation({...base, callsHigh: 100, basis:{kind:'conditional'}}).calls, /Up to 100.*conditional/);
  assert.equal(estimatePresentation({...base, callsHigh: Infinity, basis:{kind:'allowance'}}).score, null);
});
test('conditional shortlist excludes known failures and sorts by fee then id', () => {
  const row = (id, monthly, extra = {}) => ({plan:{id, monthly}, eligible:true, withinBudget:true, sufficientCoverage:null, estimate:{basis:{kind:'unknown-quota'}}, ...extra});
  const candidates = conditionalCandidates([row('b', 10),row('a',10),row('c',5),row('bad',0,{eligible:false}),row('expensive',0,{withinBudget:false}),row('small',0,{sufficientCoverage:false,estimate:{basis:{kind:'conditional'},callsHigh:9}}),row('unsupported',0,{estimate:null})],10);
  assert.deepEqual(candidates.map(r=>r.plan.id),['c','a','b']);
});
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64');
const browserUrl = moduleUrl(readFileSync(new URL('../lib/browser/storage.ts',import.meta.url),'utf8'));
const source = readFileSync(new URL('../features/tier-list/storage.ts',import.meta.url),'utf8').replaceAll('@/lib/browser/storage',browserUrl).replaceAll('@/lib/boards/codec',new URL('../build/lib/boards/codec.js',import.meta.url).href);
const storage = await import(moduleUrl(source));
const {storageKeys} = await import(browserUrl);
test('unreadable boards survive hydration and writes; replacement preserves exact backup', () => {
  const map = new Map();
  globalThis.window = {localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};
  const board = defaultBoard(); board.title = 'New work';
  const valid = boardPayload(board,'plans');
  const inputs = ['{broken', 'null', JSON.stringify({v:99,data:{precious:'work'}}), JSON.stringify({v:1,data:{subject:'plans',boards:{plans:{...valid,v:99}}}}), JSON.stringify({v:1,data:{subject:'plans',boards:{plans:valid,models:{...valid,o:[['s',[42]]]}}}})];
  try {
    for (const raw of inputs) {
      map.clear();map.set(storageKeys.boards,raw);
      assert.equal(storage.readBoards({plans:[],models:[]}).blocked,true);
      assert.equal(storage.writeBoards('plans',{plans:board,models:defaultBoard()}),false);
      assert.equal(map.get(storageKeys.boards),raw);
      assert.equal(storage.replaceUnreadableBoards('plans',{plans:board,models:defaultBoard()}),true);
      assert.equal(map.get(storageKeys.boardBackup),raw);
      assert.equal(storage.readBoards({plans:[],models:[]}).boards.plans.title,'New work');
    }
    map.set(storageKeys.boards,'{another');
    assert.equal(storage.replaceUnreadableBoards('plans',{plans:board,models:defaultBoard()}),false);
    assert.equal(map.get(storageKeys.boards),'{another');
  } finally { delete globalThis.window; }
});

test('rendered recommendation exposes conditional candidates and no-match objective controls', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { decide } = await import('../build/lib/domain/decision.js');
  const { workloadFromScenario } = await import('../build/lib/domain/workload.js');
  const scenarios = JSON.parse(readFileSync(new URL('../data/scenarios.json',import.meta.url))).scenarios;
  const scenario = scenarios.find(s=>s.id==='code-medium');
  const catalog = {models, plans, scenarios, modelById:new Map(models.map(m=>[m.id,m]))};
  let component = ts.transpileModule(readFileSync(new URL('../features/recommend/best-path.tsx',import.meta.url),'utf8'), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  component = component.replaceAll('react/jsx-runtime',import.meta.resolve('react/jsx-runtime'))
    .replaceAll('@/lib/catalog',moduleUrl(`export const scenarioFor = () => (${JSON.stringify(scenario)});`))
    .replaceAll('@/lib/domain/eligibility',new URL('../build/lib/domain/eligibility.js',import.meta.url).href)
    .replaceAll('@/lib/format',new URL('../build/lib/format.js',import.meta.url).href)
    .replaceAll('@/components/icon',moduleUrl('export const Icon = () => null;'));
  const {BestPath} = await import('data:text/javascript;base64,'+Buffer.from(component).toString('base64'));
  const render = overrides => {
    const workload = {...workloadFromScenario(scenario),...overrides};
    return renderToStaticMarkup(createElement(BestPath,{workload,decision:decide(catalog,scenario,workload,'cost','either'),objective:'cost',onObjective(){},onInspect(){}}));
  };
  const chat = render({access:'chat-app',budget:10000});
  assert.match(chat,/Conditional plans to investigate/);
  assert.match(chat,/Provider source/);
  assert.doesNotMatch(chat,/<details|so this comparison is API-only/);
  const noBudget = render({budget:0});
  assert.match(noBudget,/aria-label="API priority"/);
  assert.match(noBudget,/exceed your budget/);
});
