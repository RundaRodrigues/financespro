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
    setTimeout: callback => { callback(); return 0; },
    document: {
      querySelectorAll: () => [],
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', style: {}, setAttribute() {}, focus() {}, classList: { add() {}, remove() {} } });
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

function prepareRecurringForm(instance, overrides = {}) {
  const values = {
    'tx-type': 'expense', 'tx-desc': 'Aluguel', 'tx-amount': '1000',
    'tx-date': '2026-11-04', 'tx-cat': 'Moradia', 'tx-payment': 'PIX',
    'tx-notes': '', 'tx-day': '10', 'tx-end-month': '2027-01', ...overrides
  };
  for (const [id, value] of Object.entries(values)) instance.elements.set(id, { value });
  instance.elements.set('tx-recurring', { checked: true });
  instance.run(`closeModal=()=>{}; scheduleSave=()=>{}; updateSidebarBalance=()=>{};
    refreshCurrentSection=()=>{}; showToast=()=>{}; openModal=()=>{}; selectTxType=()=>{};
    showFieldError=(id,message)=>{throw new Error(id+': '+message);};`);
}

test('new recurrence starts in the selected month without duplicating its first occurrence', () => {
  const instance = app();
  prepareRecurringForm(instance);
  const { run, elements } = instance;
  run('saveTx(); renderRecurrings();');
  assert.equal(run('data.recurrings[0].startMonth'), '2026-11');
  assert.equal(run("getEffectiveTxForMonth('2026-10').length"), 0);
  assert.equal(run("getEffectiveTxForMonth('2026-11').length"), 1);
  assert.equal(run("getEffectiveTxForMonth('2026-11')[0].date"), '2026-11-04');
  assert.equal(run("getEffectiveTxForMonth('2026-12')[0].date"), '2026-12-10');
  assert.equal(run("getEffectiveTxForMonth('2027-01').length"), 1);
  assert.equal(run("getEffectiveTxForMonth('2027-02').length"), 0);
  assert.match(elements.get('rec-expense-list').innerHTML, /Desde Novembro de 2026/);
});

test('legacy recurrence displays and edits the actual first month, preserving payment', () => {
  const instance = app();
  prepareRecurringForm(instance);
  const { run, elements } = instance;
  run(`data.transactions=[{id:'first',recurringId:'legacy',isRecurring:true,type:'expense',amount:1000,date:'2026-11-04',paid:true}];
    data.recurrings=[{id:'legacy',type:'expense',description:'Aluguel',category:'Moradia',amount:1000,startMonth:'2026-12',dayOfMonth:10}];
    renderRecurrings(); editRecurring('legacy');`);
  assert.match(elements.get('rec-expense-list').innerHTML, /Desde Novembro de 2026/);
  assert.equal(elements.get('tx-date').value, '2026-11-04');
  elements.get('tx-amount').value = '1200';
  run('saveTx();');
  assert.equal(run('data.recurrings[0].startMonth'), '2026-11');
  assert.equal(run('data.transactions[0].paid'), true);
  assert.equal(run("getEffectiveTxForMonth('2026-11').length"), 1);
  assert.equal(run("getMonthCashFlow('2026-11').expenses"), 1200);
  assert.equal(run("getMonthCashFlow('2026-12').expenses"), 1200);
});

test('single-month recurrence has one final charge and rejects an earlier end month', () => {
  const instance = app();
  prepareRecurringForm(instance, { 'tx-end-month': '2026-11' });
  const { run, elements } = instance;
  run('saveTx();');
  assert.equal(run("getEffectiveTxForMonth('2026-11').length"), 1);
  assert.equal(run("getEffectiveTxForMonth('2026-11')[0].isLastRecurringMonth"), true);
  assert.equal(run("getEffectiveTxForMonth('2026-12').length"), 0);
  elements.get('tx-end-month').value = '2026-10';
  assert.throws(() => run('saveTx();'), /tx-end-month/);
  assert.equal(run('data.recurrings.length'), 1);
});

test('moving the start month moves the first charge and preserves its paid status', () => {
  const instance = app();
  prepareRecurringForm(instance);
  const { run, elements } = instance;
  run('saveTx(); data.transactions[0].paid=true; editRecurring(data.recurrings[0].id);');
  elements.get('tx-date').value = '2026-12-04';
  run('saveTx(); renderRecurrings();');
  assert.equal(run("getEffectiveTxForMonth('2026-11').length"), 0);
  assert.equal(run("getEffectiveTxForMonth('2026-12').length"), 1);
  assert.equal(run("getEffectiveTxForMonth('2026-12')[0].paid"), true);
  assert.match(elements.get('rec-expense-list').innerHTML, /Desde Dezembro de 2026/);
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

test('recurring concentration groups active expenses and excludes income, future and ended recurrences', () => {
  const { run } = app();
  run(`data.recurrings=[
    {id:'rent',type:'expense',category:'Moradia',amount:2000,startMonth:'2026-10'},
    {id:'condo',type:'expense',category:'Moradia',amount:500,startMonth:'2026-11'},
    {id:'bills',type:'expense',category:'Contas',amount:500,startMonth:'2026-10',endMonth:'2026-11'},
    {id:'future',type:'expense',category:'Moradia',amount:900,startMonth:'2026-12'},
    {id:'ended',type:'expense',category:'Contas',amount:300,startMonth:'2026-09',endMonth:'2026-10'},
    {id:'salary',type:'income',category:'Salário',amount:10000,startMonth:'2026-09'}
  ];`);
  const summary = JSON.parse(run("JSON.stringify(getRecurringOverview('', '2026-11'))"));
  assert.equal(summary.monthlyExp, 3000);
  assert.equal(summary.monthlyIncome, 10000);
  assert.equal(summary.monthlyBal, 7000);
  assert.deepEqual(summary.categories.map(c=>[c.name,c.amount]), [['Moradia',2500],['Contas',500]]);
  assert.ok(Math.abs(summary.categories.reduce((sum,c)=>sum+c.percent,0)-100)<0.0001);
});

test('recurring category filter updates lists, chart and totals, and clearing restores them', () => {
  const { run, elements } = app();
  run(`currentMonthStr=()=> '2026-11';
    Chart=function(ctx,config){this.config=config;this.destroy=()=>{};};
    data.recurrings=[
      {id:'rent',type:'expense',description:'Aluguel',category:'Moradia',amount:2000,startMonth:'2026-10'},
      {id:'bills',type:'expense',description:'Energia',category:'Contas',amount:500,startMonth:'2026-10'},
      {id:'salary',type:'income',description:'Salário',category:'Salário',amount:10000,startMonth:'2026-09'}
    ];setRecurringCategory('Moradia');`);
  assert.match(elements.get('rec-expense-list').innerHTML, /Aluguel/);
  assert.doesNotMatch(elements.get('rec-expense-list').innerHTML, /Energia/);
  assert.equal(run("charts['chart-rec-categories'].config.data.datasets[0].data[0]"), 2000);
  assert.match(elements.get('rec-category-ranking').innerHTML, /100%/);
  run("setRecurringCategory('');");
  assert.match(elements.get('rec-expense-list').innerHTML, /Energia/);
  assert.equal(run("charts['chart-rec-categories'].config.data.labels.length"), 2);
  run("setRecurringCategory('Salário');");
  assert.equal(run('getRecurringOverview(\'Salário\').monthlyExp'), 0);
  assert.equal(run("charts['chart-rec-categories']===undefined"), true);
  assert.match(elements.get('rec-category-ranking').innerHTML, /Nenhuma despesa recorrente ativa/);
});

test('recurring filter includes all app categories even when only Pets and Contas have records', () => {
  const { run, elements } = app();
  run(`data.recurrings=[
    {id:'pets',type:'expense',category:'Pets',amount:100,startMonth:'2026-10'},
    {id:'bills',type:'expense',category:'Contas',amount:200,startMonth:'2026-10'}
  ]; renderRecurrings();`);
  const options = elements.get('rec-filter-category').innerHTML;
  const expected = JSON.parse(run('JSON.stringify([...new Set([...INCOME_CATS,...EXPENSE_CATS])])'));
  for (const category of expected) assert.ok(options.includes(`value="${category}"`), category);
  assert.equal((options.match(/value="Outros"/g) || []).length, 1);
  run("setRecurringCategory('Moradia');");
  assert.equal(elements.get('rec-filter-category').value, 'Moradia');
  assert.match(elements.get('rec-expense-list').innerHTML, /Nenhuma recorrência nesta categoria/);
  assert.match(elements.get('rec-chart-subtitle').textContent, /Moradia/);
});

test('recurring filter retains custom categories and remains complete with no records', () => {
  const { run, elements } = app();
  run("data.recurrings=[{id:'custom',type:'expense',description:'Aporte',category:'Projeto pessoal',amount:100,startMonth:'2026-10'}]; setRecurringCategory('Projeto pessoal');");
  assert.equal(elements.get('rec-filter-category').value, 'Projeto pessoal');
  assert.match(elements.get('rec-expense-list').innerHTML, /Aporte/);
  run('data.recurrings=[]; renderRecurrings();');
  assert.equal(elements.get('rec-filter-category').value, '');
  assert.match(elements.get('rec-filter-category').innerHTML, /value="Moradia"/);
  assert.match(elements.get('rec-filter-category').innerHTML, /value="Salário"/);
});

test('recurring month selector drives the graph, totals and status instead of the real month', () => {
  const { run, elements } = app();
  run(`Chart=function(ctx,config){this.config=config;this.destroy=()=>{};};
    data.recurrings=[
      {id:'oct',type:'expense',description:'Somente outubro',category:'Contas',amount:100,startMonth:'2026-10',endMonth:'2026-10'},
      {id:'nov',type:'expense',description:'Somente novembro',category:'Contas',amount:200,startMonth:'2026-11',endMonth:'2026-11'},
      {id:'ongoing',type:'expense',description:'Continuada',category:'Contas',amount:300,startMonth:'2026-11'}
    ]; anchorMonth='2026-11';setRecurringCategory('Contas');`);
  assert.equal(run('currentMonthStr()'), '2026-10');
  assert.equal(run("getRecurringOverview('Contas').monthlyExp"), 500);
  assert.equal(run("charts['chart-rec-categories'].config.data.datasets[0].data[0]"), 500);
  assert.match(elements.get('rec-month-lbl').innerHTML, /value="2026-11"/);
  assert.match(elements.get('rec-chart-subtitle').textContent, /Novembro de 2026/);
  assert.match(elements.get('rec-expense-list').innerHTML, /Última cobrança este mês/);
  assert.match(elements.get('rec-summary').innerHTML, /500,00/);
  run('changeRecurringMonth(1);');
  assert.equal(run('anchorMonth'), '2026-12');
  assert.equal(elements.get('rec-filter-category').value, 'Contas');
  assert.equal(run("getRecurringOverview('Contas').monthlyExp"), 300);
  assert.equal(run("charts['chart-rec-categories'].config.data.datasets[0].data[0]"), 300);
  assert.doesNotMatch(elements.get('rec-expense-list').innerHTML, /Última cobrança este mês/);
  assert.match(elements.get('rec-chart-subtitle').textContent, /Dezembro de 2026/);
});

test('direct recurring month selection and year rollover preserve the shared month', () => {
  const { run, elements } = app();
  run("currentSection='recurrings'; refreshCurrentSection=()=>renderRecurrings(); selectAnchorMonth('2028-12');");
  assert.equal(run('anchorMonth'), '2028-12');
  assert.match(elements.get('rec-month-lbl').innerHTML, /value="2028-12"/);
  run('changeRecurringMonth(1);');
  assert.equal(run('anchorMonth'), '2029-01');
  run('changeRecurringMonth(-1);');
  assert.equal(run('anchorMonth'), '2028-12');
  run('anchorMonth=currentMonthStr();renderRecurrings();');
  assert.match(elements.get('rec-month-lbl').innerHTML, /value="2026-10"/);
});
