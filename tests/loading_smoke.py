#!/usr/bin/env python3
"""Smoke tests in macOS JavaScriptCore; does not replace real-browser QA."""
from pathlib import Path
import re, tempfile, subprocess
root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text()
refs=set(re.findall(r'assets/[A-Za-z0-9_/.-]+',html))
assert all((root/x).is_file() for x in refs), 'Missing image asset'
assert 'data:image' not in html, 'Embedded image regression'
assert len(html.encode()) < 250000, 'HTML payload budget exceeded'
script=re.search(r'<script>([\s\S]*?)</script>',html).group(1)
pre="var window=globalThis; var navigator={onLine:true}; var location={protocol:'file:',hash:'',search:''};var history={replaceState:function(){}};var screen={};var localStorage={getItem:function(){return null},setItem:function(){},removeItem:function(){}};var setTimeout=function(){return 1},clearTimeout=function(){},setInterval=function(){return 1};var requestAnimationFrame=function(f){f()};var addEventListener=function(){};var matchMedia=function(){return {matches:false,addEventListener:function(){}}};function element(){return {style:{},dataset:{},value:'',innerHTML:'',textContent:'',hidden:false,classList:{add:function(){},remove:function(){},toggle:function(){},contains:function(){return false}},addEventListener:function(){},setAttribute:function(){},getAttribute:function(){return null},querySelector:function(){return element()},querySelectorAll:function(){return []},appendChild:function(){},remove:function(){},click:function(){},focus:function(){},scrollIntoView:function(){}}};var els={};var document={visibilityState:'visible',body:element(),documentElement:element(),getElementById:function(id){return els[id]||(els[id]=element())},querySelector:function(){return element()},querySelectorAll:function(){return []},addEventListener:function(){},createElement:element}; var console={log:print,warn:print,error:print};\n"
post='\nprint("STARTUP_OK"); print(Object.keys(MealPlanner)); print(JSON.stringify(MealPlanner.current).length);for(var n of [5,20]){for(var i=0;i<100;i++){var days=MealPlanner.generate(n);var check=MealPlanner.validateMenu(days,{count:n});if(!check.valid)throw Error(JSON.stringify(check.errors));}print(\'GENERATE_\'+n+\'_100_PASS\')}\nvar snapshot=JSON.stringify(MealPlanner.state); var validated=MealPlanner.validateImportedPayload(JSON.parse(snapshot)); if(!validated)throw Error(\'roundtrip failed\');print(\'STATE_ROUNDTRIP_PASS\');\n'
with tempfile.NamedTemporaryFile(mode='w',suffix='.js') as f:
    f.write(pre+script+post);f.flush()
    subprocess.run(['/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc',f.name],check=True)
print('ASSET_REFERENCES_AND_HTML_BUDGET_PASS')
