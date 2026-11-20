// Optional browser regression: NODE_PATH pointing to Playwright, Chrome installed.
// Run with node tests/shared_orders.cjs. No request is sent to the live database.
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const {chromium} = require('playwright');

async function run(browser) {
  const url = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
  let state, revision = 1, race = false, waitingWriter, conflicts = 0;
  const version = () => new Date(Date.UTC(2026, 0, 1) + revision).toISOString();
  const errors = [];
  async function member(name) {
    const context = await browser.newContext({timezoneId:'Asia/Shanghai'});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push('Unexpected dialog: '+d.type()); await d.dismiss(); });
    await page.goto(url);
    if (!state) state = await page.evaluate(() => JSON.parse(MealPlanner.exportData()));
    await page.evaluate(name => localStorage.setItem('mealplanner_supabase_session_v1',JSON.stringify({
      user:{id:name}, access_token:'test-only',refresh_token:'test-only',expires_at:9999999999
    })), name);
    const device = {context, page, offline:false};
    await context.route('https://*.supabase.co/**', async route => {
      if (device.offline) return route.abort();
      const rpc = new URL(route.request().url()).pathname.split('/').pop();
      let json, status = 200;
      if (rpc === 'family_get') {
        json = {family_id:'test-family', role:'member', members:[], app_state:state, updated_at:version()};
      } else if (rpc === 'family_sync') {
        const body = route.request().postDataJSON();
        if (race) {
          if (waitingWriter) { race=false; waitingWriter(); }
          else await new Promise(resolve => { waitingWriter=resolve; });
        }
        if (body.p_expected_updated_at !== version()) {
          conflicts++; status=409; json={message:'SYNC_CONFLICT'};
        } else {
          state=body.p_state; revision++; json={updated_at:version()};
        }
      } else throw Error('Unexpected request: '+rpc);
      await route.fulfill({status,json});
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-order-sync]').textContent==='订单已同步到家庭');
    return device;
  }
  const A=await member('member-A'), B=await member('member-B');
  const friday=await A.page.evaluate(()=>MealPlanner.current.days[4].date);
  const order=(d,note,dishId,date=friday)=>d.page.evaluate(({note,dishId,date})=>
    MealPlanner.acceptOrder({note,requestedDate:date,items:[{dishId,quantity:2}]}),{note,dishId,date});
  const sync=d=>d.page.evaluate(()=>MealPlanner.syncNow());
  const notes=d=>d.page.evaluate(()=>MealPlanner.state.orders.map(o=>o.note).sort());
  const converge=async()=>{await sync(A);await sync(B);await sync(A)};
  assert(await A.page.evaluate(()=>MealPlanner.saveCurrentMenu()));
  await converge();
  assert(await order(A,'少盐','m001')); assert(await order(B,'少葱','m003'));
  race=true;
  await Promise.all([sync(A),sync(B)]);await converge();
  assert(conflicts>0);assert.equal(state.orders.length,2);
  assert.equal(new Set(state.orders.map(o=>o.id)).size,2);
  assert.deepEqual(await notes(A),['少盐','少葱']);assert.deepEqual(await notes(B),await notes(A));
  const grocery=await B.page.evaluate(()=>MealPlanner.groceryText([MealPlanner.current.days[4]]));
  for(const value of ['家人加点','少盐','少葱','× 2份','香菇'])assert(grocery.includes(value));
  assert((await B.page.locator('#groceryList').innerText()).includes('少盐'));
  // Offline restart, another member changes a different order, then network returns.
  B.offline=true;await B.context.setOffline(true);await B.page.reload();
  assert(await order(B,'离线加点','m001'));
  await B.page.reload();assert((await notes(B)).includes('离线加点'));
  assert(await order(A,'不要姜','m002'));await sync(A);
  B.offline=false;await B.context.setOffline(false);
  await B.page.waitForFunction(()=>MealPlanner.state.orders.length===4);
  await converge();assert.deepEqual(await notes(A),await notes(B));
  await B.page.reload();await converge();assert.equal(state.orders.length,4);
  // Edit the same order on both devices before either sees the other's write.
  const id=state.orders.find(o=>o.note==='少盐').id;
  async function edit(device,note) {
    await device.page.evaluate(id=>{MealPlanner.openOrderPage();MealPlanner.beginAddDishToOrder(id)},id);
    await device.page.locator('#orderNote').fill(note);
    await device.page.locator('#submitOrder').click();
  }
  await edit(B,'本机旧编辑');await edit(A,'云端已确认');
  await sync(A);await sync(B);await converge();
  assert.equal(state.orders.find(o=>o.id===id).note,'云端已确认');
  // The Friday list follows changed portions; a racing stale edit cannot revive a deletion.
  await A.page.locator('[data-order-card="'+id+'"] [data-order-qty="1"]').first().click();
  await converge();
  assert((await B.page.locator('#groceryList').innerText()).includes('× 3份'));
  await edit(B,'待重试修改');
  await A.page.locator('[data-delete-order="'+id+'"]').click();
  await A.page.locator('#confirmOrderDelete').click();
  await converge();assert(!state.orders.some(o=>o.id===id));
  assert(!(await B.page.locator('#groceryList').innerText()).includes('云端已确认'));
  assert(await order(A,'日期待定','m002',''));await converge();
  assert(!(await B.page.locator('#groceryList').innerText()).includes('日期待定'));
  const weekend=await A.page.evaluate(()=>{const d=new Date(MealPlanner.current.days[4].date+'T12:00:00');d.setDate(d.getDate()+1);return d.toLocaleDateString('sv-SE')});
  assert(await order(A,'周末加点','m003',weekend));await converge();
  assert((await B.page.locator('#groceryList').innerText()).includes('周末加点'));
  assert(!Object.hasOwn(state,'orderBase'));assert.deepEqual(errors,[]);
  await A.context.close();await B.context.close();
  console.log('PASS concurrent writes, independent orders, offline restart, retry, same-order conflict, deletion and daily groceries');
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try { await run(browser); } finally { await browser.close(); }
})().catch(e=>{console.error(e); process.exitCode=1});
