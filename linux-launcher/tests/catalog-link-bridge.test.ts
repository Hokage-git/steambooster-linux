import { test, expect } from 'bun:test';
import { CATALOG_LINK_BRIDGE_SCRIPT } from '../src/catalog-link-bridge.js';

test('catalogue bridge is scoped to the catalogue origin and route', () => {
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain("location.hostname !== 'steambalance.cc'");
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain("location.pathname.startsWith('/booster/catalogue')");
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain("href.hostname !== 'store.steampowered.com'");
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('window.top.location.assign(href.href)');
});

test('catalogue bridge preserves modified and non-left clicks', () => {
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('event.button !== 0');
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('event.metaKey');
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('event.ctrlKey');
  expect(CATALOG_LINK_BRIDGE_SCRIPT).toContain('event.preventDefault()');
});

import {Window} from 'happy-dom';
test('catalog link bridge leaves nested purchase buttons to the official page',async()=>{
 const w=new Window({url:'https://steambalance.cc/booster/catalogue'});
 w.document.body.innerHTML='<a href="https://store.steampowered.com/app/123"><button>Buy</button></a>';
 new Function('window','location','document','Element',CATALOG_LINK_BRIDGE_SCRIPT)(w,w.location,w.document,w.Element);
 const event=new w.MouseEvent('click',{bubbles:true,cancelable:true,button:0});
 w.document.querySelector('button')!.dispatchEvent(event);
 expect(event.defaultPrevented).toBe(false);
 await w.happyDOM.close();
});
