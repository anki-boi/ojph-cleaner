import json, time, sys, urllib.request
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import websocket
ts = json.load(urllib.request.urlopen('http://127.0.0.1:9333/json'))
ext = [t for t in ts if t['url'] == 'chrome://extensions/'][0]
ws = websocket.create_connection(ext['webSocketDebuggerUrl'])
ws.send(json.dumps({'id': 1, 'method': 'Page.bringToFront'}))
time.sleep(2)
ws.close()
from pywinauto import Desktop
for x in Desktop(backend='uia').windows():
    if x.window_text().endswith('Google Chrome'):
        x.capture_as_image().save(r'C:\Users\PC\repos\ojph-cleaner\tools\tmp_re.png')
        print('title:', x.window_text())
        break
