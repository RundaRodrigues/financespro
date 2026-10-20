const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'gestao-financeira.html'), 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

function app() {
  const elements = new Map();
  const context = vm.createContext({
    localStorage: { getItem: () => null },
    document: {
      querySelectorAll: () => [],
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', setAttribute() {}, focus() {}, classList: { add() {}, remove() {} } });
        return elements.get(id);
      }
    },
    Chart: function () { this.destroy = () => {}; }
  });
  vm.runInContext(script.slice(0, script.indexOf('(function init(){')), context);
  vm.runInContext("currentMonthStr = () => '2026-10'; todayStr = () => '2026-10-20';", context);
  return { run: code => vm.runInContext(code, context), elements };
}

test('future expenses paid now reduce current balance only once', () => {
  const { run } = app();
  run(`data.transactions = [
    {id:'income', type:'income', amount:1000, date:'2026-10-01'},
    {id:'advance', type:'expense', amount:1000, date:'2026-11-10', paid:true}
  ];`);
  assert.equal(run("balanceThroughMonth('2026-10')"), 0);
  assert.equal(run("balanceThroughMonth('2026-11')"), 0);
  run('data.transactions[1].paid = false');
  assert.equal(run("balanceThroughMonth('2026-10')"), 1000);
});

test('recurring advance payments agree across dashboard chips and annual projection', () => {
  const { run, elements } = app();
  run(`data.transactions = [{id:'income',type:'income',amount:1000,date:'2026-10-01'}];
    data.recurrings = [{id:'rent',type:'expense',amount:1000,startMonth:'2026-11',endMonth:'2026-11'}];
    data.paidVirtuals = {'rec_rent_2026-11':true};
    anchorMonth = '2026-11';
    renderDashboard(); projYear = 2026; renderProjections();`);
  assert.equal(run("balanceThroughMonth('2026-10')"), 0);
  assert.equal(run("balanceThroughMonth('2026-11')"), 0);
  // December opens at zero; the advance must not be subtracted again in November.
  assert.doesNotMatch(elements.get('dash-proj-balances').innerHTML, /-R\$/);
  const annualBalances = [...elements.get('proj-table').innerHTML.matchAll(/color:var\(--(success|danger)\);font-weight:700">([^<]+)<\/td>/g)];
  assert.equal(annualBalances.length, 12);
  assert.ok(annualBalances.every(([, color, value]) => color === 'success' && value.endsWith('0,00')));
});

test('actual value replaces only its own goal, preserving other planned investments', () => {
  const { run } = app();
  run(`data.transactions = [{id:'income',type:'income',amount:1000,date:'2026-10-01'}];
    data.investments = [
      {id:'a',month:'2026-10',startMonth:'2026-10',recurring:true,fixedAmount:200},
      {id:'b',month:'2026-10',startMonth:'2026-10',recurring:true,fixedAmount:300}
    ];
    data.investmentActuals = {'a_2026-10':100};`);
  assert.equal(run("getInvestmentOutflowForMonth('2026-10')"), 400);
  assert.equal(run("balanceThroughMonth('2026-10')"), 600);
  assert.equal(run("balanceThroughMonth('2026-11')"), 100);
  assert.equal(run("getInvestmentExpenseVirtualForMonth('2026-10').reduce((sum,t)=>sum+t.amount,0)"), 400);
  assert.equal(run("getInvestmentOutflowForMonth('2028-10')"), 500);
});

test('month selection jumps two years and annual statuses still follow real month', () => {
  const { run, elements } = app();
  run("refreshCurrentSection = () => {}; selectAnchorMonth('2028-10');");
  assert.equal(run('anchorMonth'), '2028-10');
  run("selectAnchorMonth('2028-13')");
  assert.equal(run('anchorMonth'), '2028-10');
  run("setMonthLabel('dash-month-lbl', anchorMonth); projYear=2028; renderProjections();");
  assert.match(elements.get('dash-month-lbl').innerHTML, /type="month".*value="2028-10"/);
  assert.doesNotMatch(elements.get('proj-table').innerHTML, /hoje/);
  assert.equal((elements.get('proj-table').innerHTML.match(/Projeção/g) || []).length, 12);
});

test('investment balance accumulates actual and planned contributions through the selected month', () => {
  const { run } = app();
  run(`data.investments = [
    {id:'a',month:'2026-10',startMonth:'2026-10',endMonth:'2026-12',recurring:true,fixedAmount:500},
    {id:'b',month:'2026-11',fixedAmount:200}
  ]; data.investmentActuals={'a_2026-10':400,'a_2026-11':600};`);
  assert.equal(run("getInvestmentBalanceThroughMonth('2026-09').total"), 0);
  assert.equal(run("getInvestmentBalanceThroughMonth('2026-10').total"), 400);
  assert.equal(run("getInvestmentBalanceThroughMonth('2026-11').total"), 1200);
  assert.equal(run("getInvestmentBalanceThroughMonth('2026-12').total"), 1700);
  assert.equal(run("getInvestmentBalanceThroughMonth('2027-01').total"), 1700);
  assert.equal(run("getInvestmentBalanceThroughMonth('2026-12').actual"), 1000);
  assert.equal(run("getInvestmentBalanceThroughMonth('2026-12').planned"), 700);
});

test('legacy recurring actual amount is counted in its original month only', () => {
  const { run } = app();
  run("data.investments=[{id:'legacy',month:'2026-10',startMonth:'2026-10',recurring:true,fixedAmount:500,actualAmount:400}];");
  assert.equal(run("getInvestmentBalanceThroughMonth('2026-11').actual"), 400);
  assert.equal(run("getInvestmentBalanceThroughMonth('2026-11').total"), 900);
});
