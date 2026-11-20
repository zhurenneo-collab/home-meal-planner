// Run with Playwright available on NODE_PATH and Chrome installed.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const file = name => pathToFileURL(path.join(root, name)).href;

async function run(browser, width) {
  const mobile = width < 700;
  const context = await browser.newContext({viewport:{width,height:mobile?844:900}});
  await context.addInitScript(native => {
    Object.defineProperty(navigator, 'clipboard', {value:{writeText:async text=>window.copied=text}});
    Object.defineProperty(navigator, 'share', {value:native ? async data=>{window.sent=data} : undefined});
  }, mobile);
  const sender = await context.newPage();
  const errors = [];
  sender.on('pageerror', error=>errors.push(error.message));
  await sender.goto(file('index.html'));
  const stateBefore = () => sender.evaluate(()=>JSON.stringify(MealPlanner.state));
  const customName = '私房<番茄>炒蛋 & 🍅';
  await sender.evaluate(name=>{
    const id=MealPlanner.current.days[0].meat;
    MealPlanner.state.dishes.find(d=>d.id===id).name=name;
  },customName);
  const before = await stateBefore();
  if (mobile) {
    const share = sender.getByRole('button',{name:'分享菜单',exact:true});
    assert.equal(await share.innerText(),'');
    assert(await share.evaluate(el=>{
      const rect=el.getBoundingClientRect();
      return rect.width>=44 && rect.height>=44 && rect.right<=innerWidth &&
        el.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
    }));
  }
  await sender.locator('#shareMenu').click();
  const modal = sender.locator('#menuShare');
  assert.equal(await modal.locator('.share-day').count(), 5);
  assert(await modal.locator('[data-preview]').isVisible());
  const images=modal.locator('.share-thumbnail img');
  assert.equal(await images.count(),15);
  const photos=await images.evaluateAll(nodes=>nodes.map(img=>[img.getAttribute('src'),img.style.left,img.style.top]));
  const names = await modal.locator('dd').allTextContents();
  assert.equal(names[0],customName);
  const initialDate = await modal.locator('.share-day h3').first().innerText();
  await modal.locator('[data-send]').click();
  const link = await sender.evaluate(()=>window.sent?.url || window.copied);
  assert.equal(new URL(link).origin, 'https://zhurenneo-collab.github.io');
  assert.equal(new URL(link).pathname, '/home-meal-planner/share.html');
  await modal.locator('[data-text]').click();
  assert((await sender.evaluate(()=>window.copied)).includes(names[0]));
  await modal.locator('[value=day]').check();
  await modal.locator('[data-choice]').selectOption('4');
  assert.equal(await modal.locator('.share-day').count(), 1);
  assert.notEqual(await modal.locator('.share-day h3').innerText(), initialDate);
  await modal.locator(mobile?'[data-link]':'[data-send]').click();
  const single = await sender.evaluate(()=>window.copied);
  assert.notEqual(single,link);
  await modal.locator('[data-close]').click();
  assert.equal(await stateBefore(), before);
  await sender.locator('#regenerate').click();
  await sender.locator('#saveMenu').click();
  await sender.locator('#shareMenu').click();
  assert(!await modal.locator('[data-preview]').isVisible());

  await modal.locator('[data-close]').click();
  assert(await sender.evaluate(()=>MealPlanner.regenerate(20)));
  await sender.locator('#shareMenu').click();
  assert.equal(await modal.locator('[data-choice] option').count(),4);
  await modal.locator('[data-choice]').selectOption('15');
  assert.equal(await modal.locator('.share-day').count(),5);
  const fourthWeek=await modal.locator('.share-day h3').first().innerText();
  await modal.locator('[value=day]').check();
  assert.equal(await modal.locator('.share-day h3').innerText(),fourthWeek);

  const guest = await browser.newContext({viewport:{width,height:mobile?844:900}});
  const page = await guest.newPage(), remoteRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',req=>{if(req.url().startsWith('http'))remoteRequests.push(req.url())});
  const open = async url=>{await page.goto(file('share.html')+new URL(url).hash)};
  await open(link);
  assert.deepEqual(await page.locator('.share-day dd').allTextContents(),names);
  assert.deepEqual(await page.locator('.share-thumbnail img').evaluateAll(nodes=>nodes.map(img=>[img.getAttribute('src'),img.style.left,img.style.top])),photos);
  assert.equal(await page.evaluate(()=>localStorage.length),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
  await open(single);
  await page.waitForFunction(()=>document.querySelectorAll('.share-day').length===1);
  await page.reload();
  assert.deepEqual(await page.locator('dd').allTextContents(),names.slice(12));
  const legacy=Buffer.from(JSON.stringify([1,[['2026-11-20','老菜名','青菜','蛋花汤']]])).toString('base64url');
  await page.goto(file('share.html')+'#'+legacy);
  await page.getByText('老菜名').waitFor();
  assert.equal(await page.locator('.share-thumbnail').count(),0);
  await page.goto(file('share.html')+'#invalid');
  await page.locator('[data-actions]').waitFor({state:'hidden'});
  assert.equal(await page.locator('.share-day').count(),0);
  assert.deepEqual(remoteRequests,[]);
  assert.deepEqual(errors,[]);
  await guest.close();await context.close();
  console.log(width,'weekly and daily sharing, read-only snapshot, copy, invalid link and storage isolation passed');
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {for(const width of [320,390,1440])await run(browser,width)} finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
