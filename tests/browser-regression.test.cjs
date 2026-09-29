const { chromium } = require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs = require('fs');
const path = require('path');
(async()=>{
const browser = await chromium.launch({headless:true, channel:process.env.BROWSER_CHANNEL||'chrome'});
const page=await browser.newPage();
await page.route('**/*', async route=>{
 if (new URL(route.request().url()).hostname !== 'hub.test') return route.abort();
 const file=path.resolve(__dirname,'..',new URL(route.request().url()).pathname.slice(1));
 try {await route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':'text/html'});} catch {await route.fulfill({status:404,body:''});}
});
page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
for(const file of ['vanessa.test.html','permissions.test.html','vanessa-workspace.test.html','operations.test.html']) {
 await page.goto('http://hub.test/tests/'+file, {waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#sum')?.textContent, {timeout:15000});
 console.log(file,await page.locator('#sum').textContent());
 const failures=await page.locator('li.bad').allTextContents();
 console.log(failures);if(failures.length)process.exitCode=1;
}
await browser.close();
})();
