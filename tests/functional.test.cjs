const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

test('functional controls stay opt-in, export results, clean up, and cache offline shell', async () => {
  const root = path.join(__dirname, '..');
  const server = http.createServer((req,res) => {
    const file = req.url.split('?')[0] === '/functional-test-sw.js' ? 'functional-test-sw.js' : 'index.html';
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(fs.readFileSync(path.join(root,file)));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:484,height:706}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(() => {
      window.mockCalls = {watch:0,clear:0,mic:0,stop:0};
      Object.defineProperty(navigator,'geolocation',{value:{
        watchPosition(success){mockCalls.watch++;setTimeout(()=>success({timestamp:100,coords:{latitude:1,longitude:2,accuracy:3,speed:4,heading:5,altitude:null}}),0);return 1;},
        clearWatch(){mockCalls.clear++;}
      }});
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{mockCalls.mic++;return {getAudioTracks:()=>[{kind:'audio',enabled:true,readyState:'live'}],getTracks:()=>[{stop(){mockCalls.stop++;}}]};}}});
      window.WebSocket=class{constructor(){setTimeout(()=>this.onopen(),0);}send(token){setTimeout(()=>this.onmessage({data:token}),0);}close(){}};
    });
    const url='http://127.0.0.1:'+server.address().port+'/';
    await page.goto(url);
    assert.equal(await page.getByRole('button',{name:'Stop all',exact:true}).count(),1);
    assert.deepEqual(await page.evaluate(()=>mockCalls),{watch:0,clear:0,mic:0,stop:0});
    await page.getByRole('button',{name:'Save persistence marker',exact:true}).click();
    await page.reload();
    await page.getByRole('button',{name:'Check persistence marker',exact:true}).click();
    await page.getByRole('button',{name:'Continuous location',exact:true}).click();
    await page.getByRole('button',{name:'Microphone only',exact:true}).click();
    await page.getByRole('button',{name:'WebSocket echo',exact:true}).click();
    await page.waitForFunction(()=>mockCalls.stop===1);
    await page.getByRole('button',{name:'Stop all',exact:true}).click();
    await page.getByRole('button',{name:'Copy Full Report',exact:true}).click();
    let report=JSON.parse(await page.locator('#native-full-report').inputValue());
    assert.equal(report.tests['extended.persistence'].result.status,'marker found');
    assert.equal(report.tests['extended.location'].result.status,'stopped');
    assert.equal(report.tests['extended.location'].result.samples[0].speedMetersPerSecond,4);
    assert.equal(report.tests['extended.microphone'].result.status,'acquired and stopped');
    assert.equal(report.tests['extended.websocket'].result.status,'echo verified');
    assert.equal(await page.evaluate(()=>mockCalls.clear),1);
    await page.getByRole('button',{name:'Install offline cache',exact:true}).click();
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration())?.active);
    await page.reload();
    await page.context().setOffline(true);
    await page.reload();
    assert.equal(await page.title(),'XPeng Browser Capability Tester');
    await page.context().setOffline(false);
    await page.getByRole('button',{name:'Remove offline cache',exact:true}).click();
    await page.waitForFunction(async()=>!(await caches.has('xpeng-functional-v1')));
    assert.deepEqual(errors,[]);
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
});
