"""End-to-end test of the share QR card in a real headless Chromium. Needs: pip install playwright opencv-python pillow numpy && playwright install chromium.
Run: python3 backend/scripts/e2e/share-qr.py   (all API calls are mocked; the QR in every downloaded PNG is decoded with OpenCV)."""
import json, re, sys, threading, http.server, socketserver, functools, os, base64, tempfile
from playwright.sync_api import sync_playwright
import cv2, numpy as np
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.join(HERE,'..','..','..','frontend'); TMP=tempfile.mkdtemp(prefix='phqr-')
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
    def translate_path(self,p):
        p=p.split('?')[0]; return os.path.join(ROOT, p.lstrip('/')) if p!='/' else ROOT+'/index.html'
from PIL import Image, ImageDraw
im=Image.new('RGB',(1200,800)); _d=ImageDraw.Draw(im)
for _y in range(800): _d.line([(0,_y),(1200,_y)],fill=(30+_y//8,60+_y//12,110+_y//10))
_d.ellipse((700,100,1100,500),fill=(240,190,120)); im.save(os.path.join(TMP,'preview.jpg'),quality=88); Image.new('RGB',(200,200),(190,120,80)).save(os.path.join(TMP,'avatar.jpg'))
srv=(setattr(socketserver.TCPServer,'allow_reuse_address',True) or socketserver.TCPServer(('127.0.0.1',8197),H)); threading.Thread(target=srv.serve_forever,daemon=True).start()
PID='a'*23+'1'; AID='b'*23+'2'
PRESET={'id':PID,'name':'Alone esit 😢 Golden Hour','description':'Letest upload presets..','category':'Portrait','tags':['alone','sad'],'price':0,'author':'PresetHub Admin','authorId':AID,'downloads':340,'avgRating':4.6,'reviews':[{'id':'r1','userName':'Ravi','rating':5,'comment':'Great','helpful':0},{'id':'r2','userName':'Asha','rating':4,'comment':'Nice','helpful':1}],'previewImage':'/media/preview','views':1250,'likesCount':77,'shares':5,'commentsCount':0,'createdAt':'2026-10-01T00:00:00Z','updatedAt':'2026-10-01T00:00:00Z'}
mode={'users':'ok','share':'ok','img':'ok'}
errors=[]; reqs=[]
def handle(route, request):
    url=request.url; path=url.split('127.0.0.1:8197')[-1].split('?')[0]
    if not url.startswith('http://127.0.0.1:8197'): return route.abort()
    if path.startswith('/media/'):
        if mode['img']=='fail': return route.fulfill(status=404,body='no')
        f=os.path.join(TMP,'avatar.jpg') if path.endswith('avatar') else os.path.join(TMP,'preview.jpg')
        return route.fulfill(status=200,content_type='image/jpeg',body=open(f,'rb').read())
    if path.startswith('/api/'):
        reqs.append((request.method,path))
        J=lambda o,s=200: route.fulfill(status=s,content_type='application/json',body=json.dumps(o))
        if path=='/api/auth/me': return J({'error':'no'},401)
        if path=='/api/presets': return J({'presets':[PRESET],'total':1,'page':1,'totalPages':1})
        if path==f'/api/presets/{PID}': return J(PRESET)
        if path==f'/api/users/{AID}':
            return J({'error':'x'},500) if mode['users']=='fail' else J({'id':AID,'name':'PresetHub Admin','username':'admin','avatar':'/media/avatar','followers':2480,'following':3,'achievements':[],'tick':'','isPro':False})
        if path=='/api/share/create':
            return J({'error':'x'},500) if mode['share']=='fail' else J({'success':True,'code':'AQhyzit','shortUrl':'https://presethub.site/s/AQhyzit'})
        if path.startswith('/api/presets/categories'): return J([['Portrait',1]])
        if re.match(r'/api/(reviews|comments)/',path): return J([])
        if request.method=='GET' and path in ('/api/presets/featured',): return J([PRESET])
        return J([] if request.method=='GET' else {'success':True})
    return route.continue_()
def decode(png_bytes):
    img=cv2.imdecode(np.frombuffer(png_bytes,np.uint8),cv2.IMREAD_GRAYSCALE)
    det=cv2.QRCodeDetector(); aru=cv2.QRCodeDetectorAruco()
    for im in (img, cv2.resize(img,None,fx=0.5,fy=0.5), cv2.resize(img,None,fx=0.7,fy=0.7)):
        for d in (det,aru):
            v=d.detectAndDecode(im)[0]
            if v: return v,img.shape
    return '',img.shape
results=[]
def check(name,ok,detail=''):
    results.append(ok); print(('PASS  ' if ok else 'FAIL  ')+name+(('  -> '+str(detail)) if (detail and not ok) else ''))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':430,'height':900},accept_downloads=True,device_scale_factor=2,service_workers='block')
    ctx.route('**/*',handle)
    ctx.add_init_script("try{localStorage.setItem('presethub_cookie_consent_v2', JSON.stringify({v:2,analytics:false,ads:false,marketing:false,at:'2026-11-04T00:00:00Z',version:'2026-11-03'}))}catch(e){}")
    def scenario(label,deeplink=True):
        pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
        pg.goto('http://127.0.0.1:8197/?preset='+PID+'&src=qr', wait_until='domcontentloaded')
        return pg,errs
    # 1) deep link opens the preset modal
    pg,errs=scenario('deep')
    pg.wait_for_selector('.preset-detail-image, .detail-layout, [data-action="share"]',timeout=15000)
    check('deep link ?preset=<id> opens the preset', 'Alone esit' in pg.content())
    check('deep link stays in the address bar (survives a reload)', 'preset=' in pg.url, pg.url)
    # 2) open share modal
    sel=pg.locator('button.btn[data-action="share"]').first
    sel.wait_for(timeout=15000)
    check('share button exists in the preset view', sel.count()>0)
    sel.click()
    pg.wait_for_selector('canvas.share-card-canvas',timeout=15000)
    pg.wait_for_function("document.querySelector('[data-share-card=download]') && !document.querySelector('[data-share-card=download]').disabled",timeout=15000)
    check('quickchart.io (third party) is no longer used', not any('quickchart' in r for r in [x[1] for x in reqs]))
    data=pg.evaluate("document.querySelector('canvas.share-card-canvas').toDataURL('image/png')")
    png=base64.b64decode(data.split(',')[1]); open(os.path.join(TMP,'card.png'),'wb').write(png)
    val,shape=decode(png)
    check('QR on the card decodes to the short link with ?src=qr', val=='https://presethub.site/s/AQhyzit?src=qr', val)
    check('card size is 1080x1660', shape==(1660,1080), shape)
    pg.screenshot(path=os.path.join(TMP,'modal.png'),full_page=False)
    # 3) downloads
    with pg.expect_download() as d: pg.click('[data-share-card="download"]')
    dl=d.value; path=dl.path(); raw=open(path,'rb').read()
    check('Download QR Card saves a PNG', raw[:8]==b'\x89PNG\r\n\x1a\n' and dl.suggested_filename.endswith('-qr-card.png'), dl.suggested_filename)
    check('downloaded card QR works', decode(raw)[0]=='https://presethub.site/s/AQhyzit?src=qr')
    with pg.expect_download() as d2: pg.click('[data-share-card="qr"]')
    raw2=open(d2.value.path(),'rb').read(); v2,sh2=decode(raw2)
    check('QR only download decodes', v2=='https://presethub.site/s/AQhyzit?src=qr', v2); open(os.path.join(TMP,'qr-only.png'),'wb').write(raw2)
    check('old "Copy Image + Link" button is gone', 'Copy Image' not in pg.content())
    check('Copy Short Link button still there', pg.query_selector('[data-share-copy]') is not None)
    check('no JavaScript errors in the happy path', not errs, errs[:3])
    pg.close()
    # 4) resilience
    for name,change in [('creator API fails',{'users':'fail'}),('preview image fails',{'img':'fail'}),('short link API fails',{'share':'fail'})]:
        mode.update({'users':'ok','share':'ok','img':'ok'}); mode.update(change)
        pg,errs=scenario(name); pg.locator('button.btn[data-action="share"]').first.wait_for(timeout=15000); pg.locator('button.btn[data-action="share"]').first.click()
        pg.wait_for_selector('canvas.share-card-canvas',timeout=15000)
        pg.wait_for_function("document.querySelector('[data-share-card=download]') && !document.querySelector('[data-share-card=download]').disabled",timeout=15000)
        data=pg.evaluate("document.querySelector('canvas.share-card-canvas').toDataURL('image/png')"); v,_=decode(base64.b64decode(data.split(',')[1]))
        exp='https://presethub.site/s/AQhyzit?src=qr' if change.get('share')!='fail' else None
        ok = (v==exp) if exp else v.startswith('http://127.0.0.1:8197/preset/') and v.endswith('?src=qr')
        check(f'{name}: card still builds and QR scans', ok, v)
        if name=='preview image fails': pg.screenshot(path=os.path.join(TMP,'modal-noimg.png'))
        pg.close()
    b.close()
srv.shutdown()
print(f'\n{sum(results)} passed, {len(results)-sum(results)} failed')
sys.exit(0 if all(results) else 1)
